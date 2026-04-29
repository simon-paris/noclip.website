#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from "node:fs/promises";
import { decompressWad } from "./decompress.ts";
import { readLevelDataHeader, readLevelDescriptor, readTableOfContents } from "../bin-toc.ts";
import { readFromDisk, readFromDiskWithSizeHeader, SECTOR_SIZE } from "./utils.ts";
import { DataViewExt } from "../DataViewExt.ts";
import { readLevelCoreHeader } from "../bin-index.ts";
import { assert } from '../../util.ts';

const gameNumber = Number(process.argv[2]);

if (gameNumber !== 1) {
    console.error(`Usage: pnpm build:RatchetAndClank <gameNumber>`);
    process.exit(1);
}

const baseDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), `../../../data`);

const outputDir = path.join(baseDataDir, `RatchetAndClank${gameNumber}`);
await fs.mkdir(outputDir, { recursive: true });

const diskFile = path.join(baseDataDir, `RatchetAndClank${gameNumber}_raw/game.iso`);
const disk = await fs.open(diskFile);

/*
    - Table of contents
        - Global data (not used)
            - cutscenes, tutorials, loading screens, etc
        - Array of levels
            - GS memory snapshot *output as level_n.gs*
                - Palettes, some textures
            - Core data index *output as level_n.index*
                - Pointer tables, directory for core data
            - Core data (compressed) *output as level_n.data after decompression*
                - Models, textures, collision, etc
            - Gameplay file (compressed) *output as level_n.gameplay after decompression*
                - Level config (fog, spawn point, etc)
                - Instances of classes from core file
                - Lights, paths, triggers, etc
*/

const ENTRY_POINTS = {
    1: 1500,
};

// read table of contents
const tableOfContentsBuffer = await readFromDiskWithSizeHeader(disk, ENTRY_POINTS[gameNumber], 0x4);
const tableOfContents = await readTableOfContents(new DataViewExt(tableOfContentsBuffer, { littleEndian: true }));
await fs.writeFile(path.join(outputDir, `global.json`), JSON.stringify(tableOfContents, null, 2));

for (const levelSectors of tableOfContents.levelSectors) {
    if (!levelSectors) continue;

    const levelDescriptorBuffer = await readFromDiskWithSizeHeader(disk, levelSectors.startSector, 0x4);
    const levelDescriptor = await readLevelDescriptor(new DataViewExt(levelDescriptorBuffer, { littleEndian: true }));
    if (!levelDescriptor) continue;
    const levelNum = levelDescriptor.id;
    console.log(`Start level ${levelNum}`);

    const filesWritten: string[] = [];
    async function extractLevelFile(name: string, buf: string | Uint8Array | DataViewExt) {
        const filename = name.replace(/\{\}/g, String(levelNum));
        await fs.writeFile(path.join(outputDir, filename), buf);
        console.log(`Writing file ${filename}`);
        filesWritten.push(filename);
    }

    // level
    const levelDataSector = levelDescriptor.data;
    const levelDataBuffer = await readFromDisk(disk, levelDataSector.startSector, levelDataSector.sizeInSectors * SECTOR_SIZE);
    const levelData = new DataViewExt(levelDataBuffer, { littleEndian: true });
    const levelDataHeader = await readLevelDataHeader(levelData);

    // level/gs
    const gsRam = levelData.subview(levelDataHeader.gsRam.offset, levelDataHeader.gsRam.size);

    // level/gameplay
    const gameplaySector = levelDescriptor.gameplayNtsc;
    const gameplayFileCompressed = await readFromDiskWithSizeHeader(disk, gameplaySector.startSector, 0x3);
    const gameplayFileBuffer = decompressWad(new DataViewExt(gameplayFileCompressed, { littleEndian: true }));
    const gameplayFile = new DataViewExt(gameplayFileBuffer, { littleEndian: true });

    // level/index
    const levelCoreIndex = levelData.subview(levelDataHeader.coreIndex.offset, levelDataHeader.coreIndex.size);
    const levelCoreHeader = await readLevelCoreHeader(levelCoreIndex);

    // level/core
    const levelCoreDataWad = levelData.subview(levelDataHeader.coreData.offset, levelDataHeader.coreData.size);
    assert(levelCoreDataWad.byteLength === levelCoreHeader.assetsCompressedSize);
    const levelCoreDataBuffer = decompressWad(levelCoreDataWad);
    assert(levelCoreDataBuffer.byteLength === levelCoreHeader.assetsDecompressedSize);
    const levelCoreData = new DataViewExt(levelCoreDataBuffer, { littleEndian: true });

    await extractLevelFile(`level_{}.gameplay`, gameplayFile);
    await extractLevelFile(`level_{}.index`, levelCoreIndex);
    await extractLevelFile(`level_{}.gs`, gsRam);
    await extractLevelFile(`level_{}.core`, levelCoreData);

    // write metadata file
    await extractLevelFile(`level_{}.json`, JSON.stringify({
        filesReferenced: filesWritten,
        levelDataHeader,
        levelDescriptor,
    }, null, 2));
}
