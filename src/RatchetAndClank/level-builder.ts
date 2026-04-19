import { readDirectionLightInstance, readGameplayHeader, readGrindPathBlock, readInstanceBlock, readLevelSettings, readMobyInstance, readPathBlock, readPointLightInstance, readShrubInstance, readTieInstance, ShrubInstance, SIZEOF_DIRECTION_LIGHT_INSTANCE, SIZEOF_MOBY_INSTANCE, SIZEOF_POINT_LIGHT_INSTANCE, SIZEOF_SHRUB_INSTANCE, SIZEOF_TIE_INSTANCE, TieInstance } from "./structs-gameplay";
import { DataViewExt } from "./DataViewExt";
import { assert } from "../util";
import { readClassEntry, readLevelCoreHeader, readShrubClass, readSky, readTextureEntry, readTfrag, readTfragBlockHeader, readTfragHeader, readTieClass, ShrubClass, SIZEOF_SHRUB_CLASS_ENTRY, SIZEOF_TEXTURE_ENTRY, SIZEOF_TFRAG_HEADER, SIZEOF_TIE_CLASS_ENTRY, TieClass } from "./structs-core";
import { makeInstanceOClassMap, truncateTrailing0xFF } from "./utils";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readPalette8TextureSky, readPalette8TextureWithPaletteInGsRam } from "./textures";

export type LevelFiles = {
    coreIndexBuffer: ArrayBufferSlice,
    coreDataBuffer: ArrayBufferSlice,
    gameplayBuffer: ArrayBufferSlice,
    gsRamBuffer: ArrayBufferSlice,
};

export type TieInstanceBatch = {
    oClass: number,
    tieClass: TieClass,
    textureIndices: number[],
    instances: TieInstance[],
};

export type ShrubInstanceBatch = {
    oClass: number,
    shrubClass: ShrubClass,
    textureIndices: number[],
    instances: ShrubInstance[],
};

export function buildLevelFromFiles(filesAsSlices: LevelFiles) {
    const files = {
        gameplay: new DataViewExt(filesAsSlices.gameplayBuffer.arrayBuffer, { littleEndian: true }, filesAsSlices.gameplayBuffer.byteOffset, filesAsSlices.gameplayBuffer.byteLength),
        coreIndex: new DataViewExt(filesAsSlices.coreIndexBuffer.arrayBuffer, { littleEndian: true }, filesAsSlices.coreIndexBuffer.byteOffset, filesAsSlices.coreIndexBuffer.byteLength),
        coreData: new DataViewExt(filesAsSlices.coreDataBuffer.arrayBuffer, { littleEndian: true }, filesAsSlices.coreDataBuffer.byteOffset, filesAsSlices.coreDataBuffer.byteLength),
        gsRam: new DataViewExt(filesAsSlices.gsRamBuffer.arrayBuffer, { littleEndian: true }, filesAsSlices.gsRamBuffer.byteOffset, filesAsSlices.gsRamBuffer.byteLength),
    };

    // read gameplay data
    const gameplayHeader = readGameplayHeader(files.gameplay);
    console.log(gameplayHeader);
    const levelSettings = readLevelSettings(files.gameplay.subview(gameplayHeader.levelSettings));
    const grindPaths = readGrindPathBlock(files.gameplay.subview(gameplayHeader.grindPaths));
    const paths = readPathBlock(files.gameplay.subview(gameplayHeader.paths));
    const directionLights = readInstanceBlock(files.gameplay.subview(gameplayHeader.directionLightInstances), SIZEOF_DIRECTION_LIGHT_INSTANCE, readDirectionLightInstance);
    const pointLights = readInstanceBlock(files.gameplay.subview(gameplayHeader.pointLightInstances), SIZEOF_POINT_LIGHT_INSTANCE, readPointLightInstance);

    // read core header
    const levelCoreHeader = readLevelCoreHeader(files.coreIndex);
    assert(files.coreData.byteLength === levelCoreHeader.assetsDecompressedSize);
    const textureData = files.coreData.subview(levelCoreHeader.texturesBaseOffset);

    // read tfrags
    const tfragBlockHeader = readTfragBlockHeader(files.coreData.subview(levelCoreHeader.tfrags));
    const tfragHeaders = files.coreData.subdivide(tfragBlockHeader.tableOffset, tfragBlockHeader.tfragCount, SIZEOF_TFRAG_HEADER).map(view => readTfragHeader(view));
    const tfragTexureEntries = files.coreIndex.subdivide(levelCoreHeader.tfragTextures.offset, levelCoreHeader.tfragTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tfragTextures = tfragTexureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, files.gsRam, "Tfrag", i));
    const tfrags = tfragHeaders.map(tfragHeader => readTfrag(files.coreData.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader));

    // read tie classes and tie textures
    const tieClassEntries = files.coreIndex.subdivide(levelCoreHeader.tieClasses.offset, levelCoreHeader.tieClasses.count, SIZEOF_TIE_CLASS_ENTRY).map(readClassEntry);
    const tieTextureEntries = files.coreIndex.subdivide(levelCoreHeader.tieTextures.offset, levelCoreHeader.tieTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tieTextures = tieTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, files.gsRam, "Tie", i));
    const tieClassesAndTextures = tieClassEntries.map((entry, i) => {
        return {
            tieEntry: entry,
            tieClass: readTieClass(files.coreData.subview(entry.offsetInCoreData), entry.oClass),
            textureIndices: truncateTrailing0xFF(entry.textures),
        };
    });

    // read tie instances
    const tieInstances = readInstanceBlock(files.gameplay.subview(gameplayHeader.tieInstances), SIZEOF_TIE_INSTANCE, readTieInstance);
    const tiesInstancesGroupedByClass = makeInstanceOClassMap(tieInstances.instances);

    // assemble into batches
    const ties = tieClassesAndTextures.map<TieInstanceBatch>(classAndTexture => {
        const { tieEntry, tieClass, textureIndices } = classAndTexture;
        const oClass = tieEntry.oClass;
        const instances = tiesInstancesGroupedByClass.get(oClass)!;
        return {
            oClass,
            tieClass,
            textureIndices,
            instances,
        };
    });

    // read moby instances
    const mobyInstances = readInstanceBlock(files.gameplay.subview(gameplayHeader.mobyInstances), SIZEOF_MOBY_INSTANCE, readMobyInstance);

    // read shrub classes
    const shrubClassEntries = files.coreIndex.subdivide(levelCoreHeader.shrubClasses.offset, levelCoreHeader.shrubClasses.count, SIZEOF_SHRUB_CLASS_ENTRY).map(readClassEntry);
    const shrubTextureEntries = files.coreIndex.subdivide(levelCoreHeader.shrubTextures.offset, levelCoreHeader.shrubTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const shrubTextures = shrubTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, files.gsRam, "Shrub", i));
    const shrubClassesAndTextures = shrubClassEntries.map(shrubEntry => {
        return {
            shrubEntry,
            shrubClass: readShrubClass(files.coreData.subview(shrubEntry.offsetInCoreData)),
            textureIndices: truncateTrailing0xFF(shrubEntry.textures),
        };
    });

    // read shrub instances
    const shrubInstances = readInstanceBlock(files.gameplay.subview(gameplayHeader.shrubInstances), SIZEOF_SHRUB_INSTANCE, readShrubInstance);
    const shrubInstancesGroupedByClass = makeInstanceOClassMap(shrubInstances.instances);

    // assemble into batches
    const shrubs = shrubClassesAndTextures.map<ShrubInstanceBatch>((classAndTexture) => {
        const { shrubClass, textureIndices } = classAndTexture;
        const oClass = classAndTexture.shrubClass.header.oClass;
        const instances = shrubInstancesGroupedByClass.get(oClass)!;
        return {
            oClass,
            shrubClass,
            textureIndices,
            instances,
        };
    });

    // read sky
    const sky = readSky(files.coreData.subview(levelCoreHeader.sky));
    const skyTextures = sky.textureEntries.map((textureEntry, i) => readPalette8TextureSky(files.coreData.subview(levelCoreHeader.sky), sky.header, textureEntry, i));

    return {
        ready: true,

        levelCoreHeader,

        levelSettings,
        paths,
        grindPaths,
        directionLights: directionLights.instances,
        pointLights: pointLights.instances,

        tfrags,
        tfragTextures,
        ties,
        tieTextures,
        shrubs,
        shrubTextures,
        sky,
        skyTextures,

        mobyInstances,
    };
}
