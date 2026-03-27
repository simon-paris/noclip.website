#!/usr/bin/env node

import fs from "fs/promises";
import { decompressWad } from "./decompress.ts";
import { readLevelDataHeader, readLevelDescriptor, readTableOfContents } from "./structs-toc-and-level-headers.ts";
import { readFromDisk, readFromDiskWithSizeHeader, SECTOR_SIZE } from "./utils.ts";
import path from "path";
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataViewExt, DataViewExtWithTracer } from "./DataViewExt.ts";

const diskFile = process.argv[2];
if (!diskFile) {
    console.error(`Usage: node extract.ts myfile.iso`);
    process.exit(1);
}
const disk = await fs.open(diskFile);

const DATA_DIR = path.join(dirname(fileURLToPath(import.meta.url)), `../../../data/RatchetAndClank1`);
await fs.mkdir(DATA_DIR, { recursive: true });

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

// read table of contents
const RAC1_TOC_SECTOR = 1500;
const tableOfContentsBuffer = await readFromDiskWithSizeHeader(disk, RAC1_TOC_SECTOR, 0x4);
const tableOfContents = await readTableOfContents(new DataViewExt(tableOfContentsBuffer, { littleEndian: true }));
await fs.writeFile(path.join(DATA_DIR, `global.json`), JSON.stringify(tableOfContents, null, 2));

for (const levelSectors of tableOfContents.levelSectors) {
    if (!levelSectors) continue;

    const levelDescriptorBuffer = await readFromDiskWithSizeHeader(disk, levelSectors.startSector, 0x4);
    const levelDescriptor = await readLevelDescriptor(new DataViewExt(levelDescriptorBuffer, { littleEndian: true }));
    if (!levelDescriptor) continue;
    const levelNum = levelDescriptor.id;
    console.log(`Start level ${levelNum}`);

    const fileWritten: string[] = [];
    async function extractLevelFile(name: string, buf: string | Uint8Array | DataView) {
        const filename = name.replace(/\{\}/g, String(levelNum));
        await fs.writeFile(path.join(DATA_DIR, filename), buf);
        console.log(`Writing file ${filename}`);
        fileWritten.push(filename);
    }

    // read level data section
    const levelDataSector = levelDescriptor.data;
    const levelDataBuffer = await readFromDisk(disk, levelDataSector.startSector, levelDataSector.sizeInSectors * SECTOR_SIZE);
    const levelData = new DataViewExt(levelDataBuffer, { littleEndian: true });
    const levelDataHeader = await readLevelDataHeader(levelData);

    // read gameplay file
    const gameplaySector = levelDescriptor.gameplayNtsc;
    const gameplayFileCompressed = await readFromDiskWithSizeHeader(disk, gameplaySector.startSector, 0x3);
    await extractLevelFile(`level_{}.gameplay.wad`, new DataView(gameplayFileCompressed));
    const gameplayFileBuffer = decompressWad(new DataViewExt(gameplayFileCompressed, { littleEndian: true }));
    const gameplayFile = new DataViewExtWithTracer(gameplayFileBuffer, { littleEndian: true });
    await extractLevelFile(`level_{}.gameplay`, gameplayFile);
    await extractLevelFile(`level_{}.gameplay.tracer`, gameplayFile.tracer);

    // read core index
    const levelCoreIndex = levelData.subview(levelDataHeader.coreIndex.offset, levelDataHeader.coreIndex.size);
    await extractLevelFile(`level_{}.core_index`, levelCoreIndex);
    // const levelCoreHeader = await readLevelCoreHeader(levelCoreIndex);

    // read gs memory snapshot
    const gsRam = levelData.subview(levelDataHeader.gsRam.offset, levelDataHeader.gsRam.size);
    await extractLevelFile(`level_{}.gs_ram`, gsRam);

    // read core data
    const levelCoreDataWad = levelData.subview(levelDataHeader.coreData.offset, levelDataHeader.coreData.size);
    await extractLevelFile(`level_{}.core_data.wad`, levelCoreDataWad);
    // assert.equal(levelCoreDataWad.byteLength, levelCoreHeader.assetsCompressedSize);
    const levelCoreDataBuffer = decompressWad(levelCoreDataWad);
    // assert.equal(levelCoreData.length, levelCoreHeader.assetsDecompressedSize);
    const levelCoreData = new DataViewExtWithTracer(levelCoreDataBuffer, { littleEndian: true });
    await extractLevelFile(`level_{}.core_data.tracer`, levelCoreData.tracer);
    await extractLevelFile(`level_{}.core_data`, levelCoreData);

    // write metadata file
    await extractLevelFile(`level_{}.json`, JSON.stringify({
        filesReferenced: fileWritten,
        levelDataHeader,
        levelDescriptor,
    }));
}
