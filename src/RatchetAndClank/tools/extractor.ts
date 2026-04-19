#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from "node:fs/promises";
import { decompressWad } from "./decompress.ts";
import { readLevelDataHeader, readLevelDescriptor, readTableOfContents } from "./structs-toc-and-level-headers.ts";
import { readFromDisk, readFromDiskWithSizeHeader, SECTOR_SIZE } from "./utils.ts";
import { DataViewExt, DataViewExtWithTracer } from "../DataViewExt.ts";
import { readLevelCoreHeader } from "../structs-core.ts";
import { assert } from '../../util.ts';

const gameNumber = 1;

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
            - GS memory snapshot *output as level_n.gs_ram*
            - Data file
                - Core index *output as level_n.core_index*
                    - Pointer tables, directory for core data
                - Core data (compressed) *output as level_n.core_data after decompression*
                    - Tfrag (a single world space mesh with 3 lods and lod tweening, used for terrain)
                    - Sky
                    - Classes (meshes with attached materials, lod config, bounding boxes, etc)
                        - Ties (static meshes with 3 lods, used for rocks, trees, buildings, etc)
                        - Mobys (meshes with skeletons and destructable parts, used for anything that moves)
                        - Shrubs (meshes with a billboard lod, used for decorations)
                    - Textures
            - Gameplay file (compressed) *output as level_n.gameplay after decompression*
                - Level config (fog, spawn point, etc)
                - Instances of classes from core file
                - Instances of collision shapes
                - Direction lights
                - Point lights
            - Music (not used)
            - Scenes (not used)
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
        if (buf instanceof DataViewExtWithTracer) {
            const filename2 = name.replace(/\{\}/g, String(levelNum));
            await fs.writeFile(path.join(outputDir, filename2 + ".tracer"), buf.tracer);
        }
        console.log(`Writing file ${filename}`);
        filesWritten.push(filename);
    }

    // level
    const levelDataSector = levelDescriptor.data;
    const levelDataBuffer = await readFromDisk(disk, levelDataSector.startSector, levelDataSector.sizeInSectors * SECTOR_SIZE);
    const levelData = new DataViewExt(levelDataBuffer, { littleEndian: true });
    const levelDataHeader = await readLevelDataHeader(levelData);

    // level/gs_ram
    const gsRam = levelData.subview(levelDataHeader.gsRam.offset, levelDataHeader.gsRam.size);

    // level/gameplay
    const gameplaySector = levelDescriptor.gameplayNtsc;
    const gameplayFileCompressed = await readFromDiskWithSizeHeader(disk, gameplaySector.startSector, 0x3);
    const gameplayFileBuffer = decompressWad(new DataViewExt(gameplayFileCompressed, { littleEndian: true }));
    const gameplayFile = new DataViewExtWithTracer(gameplayFileBuffer, { littleEndian: true });

    // level/core_index
    const levelCoreIndex = levelData.subview(levelDataHeader.coreIndex.offset, levelDataHeader.coreIndex.size);
    const levelCoreHeader = await readLevelCoreHeader(levelCoreIndex);

    // level/core_data
    const levelCoreDataWad = levelData.subview(levelDataHeader.coreData.offset, levelDataHeader.coreData.size);
    assert(levelCoreDataWad.byteLength === levelCoreHeader.assetsCompressedSize);
    const levelCoreDataBuffer = decompressWad(levelCoreDataWad);
    assert(levelCoreDataBuffer.byteLength === levelCoreHeader.assetsDecompressedSize);
    const levelCoreData = new DataViewExtWithTracer(levelCoreDataBuffer, { littleEndian: true });

    await extractLevelFile(`level_{}.gameplay`, gameplayFile);
    await extractLevelFile(`level_{}.core_index`, levelCoreIndex);
    await extractLevelFile(`level_{}.gs_ram`, gsRam);
    await extractLevelFile(`level_{}.core_data`, levelCoreData);

    // write metadata file
    await extractLevelFile(`level_{}.json`, JSON.stringify({
        filesReferenced: filesWritten,
        levelDataHeader,
        levelDescriptor,
    }));
}
