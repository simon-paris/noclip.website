import { readDirectionLightInstance, readGameplayHeader, readGrindPathBlock, readInstanceBlock, readLevelSettings, readPathBlock, readPointLightInstance, readShrubInstance, readTieInstance, ShrubInstance, SIZEOF_DIRECTION_LIGHT_INSTANCE, SIZEOF_POINT_LIGHT_INSTANCE, SIZEOF_SHRUB_INSTANCE, SIZEOF_TIE_INSTANCE, TieInstance } from "./structs-gameplay";
import { DataViewExt } from "../DataViewExt";
import { assert } from "../util";
import { readGsRamTableEntry, readLevelCoreHeader, readShrubClass, readShrubClassEntry, readTextureEntry, readTfrag, readTfragBlockHeader, readTfragHeader, readTieClass, readTieOrMobyClassEntryArray, ShrubClass, SIZEOF_GS_RAM_TABLE_ENTRY, SIZEOF_SHRUB_CLASS_ENTRY, SIZEOF_TEXTURE_ENTRY, SIZEOF_TFRAG_HEADER, TextureEntry, TieClass } from "./structs-core";
import { makeInstanceOClassMap } from "./utils";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ReadonlyVec3, vec3 } from "gl-matrix";
import { Color } from "../Color";

export type LevelFiles = {
    coreIndexBuffer: ArrayBufferSlice,
    coreIndex: DataViewExt,
    coreDataBuffer: ArrayBufferSlice,
    coreData: DataViewExt,
    gameplayBuffer: ArrayBufferSlice,
    gameplay: DataViewExt,
    gsRamBuffer: ArrayBufferSlice,
    gsRam: DataViewExt,
}

export type TieInstanceBatch = {
    oClass: number,
    tieClass: TieClass,
    textureIndices: number[],
    instances: TieInstance[],
}

export type ShrubInstanceBatch = {
    oClass: number,
    shrubClass: ShrubClass,
    textureIndices: number[],
    instances: ShrubInstance[],
}

type Locator = {
    position: ReadonlyVec3,
    color: Color,
}

export function buildLevelFromFiles(files: LevelFiles) {
    const locators: Locator[] = [];
    const lines = new Array<{ from: vec3, to: vec3, color: Color }>();

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

    // locations of textures in GS RAM
    const gsRamTable = files.coreIndex.subdivide(levelCoreHeader.gsRam.offset, levelCoreHeader.gsRam.count, SIZEOF_GS_RAM_TABLE_ENTRY).map(readGsRamTableEntry);

    // read tfrags
    const tfragBlockHeader = readTfragBlockHeader(files.coreData.subview(levelCoreHeader.tfrags));
    const tfragHeaders = files.coreData.subdivide(tfragBlockHeader.tableOffset, tfragBlockHeader.tfragCount, SIZEOF_TFRAG_HEADER).map(view => readTfragHeader(view));
    const tfragTexureEntries = files.coreIndex.subdivide(levelCoreHeader.tfragTextures.offset, levelCoreHeader.tfragTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tfragTextures = tfragTexureEntries.map((entry, i) => readTextureData(entry, textureData, files.gsRam, "Tfrag", i));
    const tfrags = tfragHeaders.map(tfragHeader => readTfrag(files.coreData.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader));

    // read tie classes and tie textures
    const tieClassEntries = readTieOrMobyClassEntryArray(files.coreIndex.subview(levelCoreHeader.tieClasses.offset), levelCoreHeader.tieClasses.count);
    const tieTextureEntries = files.coreIndex.subdivide(levelCoreHeader.tieTextures.offset, levelCoreHeader.tieTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tieTextures = tieTextureEntries.map((entry, i) => readTextureData(entry, textureData, files.gsRam, "Tie", i));
    const tieClassesAndTextures = tieClassEntries.map((entry, i) => {
        return {
            tieEntry: entry,
            tieClass: readTieClass(files.coreData.subview(entry.offsetInAssetWad), i),
            textureIndices: entry.textures,
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

    // read shrub classes
    const shrubClassEntries = files.coreIndex.subdivide(levelCoreHeader.shrubClasses.offset, levelCoreHeader.shrubClasses.count, SIZEOF_SHRUB_CLASS_ENTRY).map(readShrubClassEntry);
    const shrubTextureEntries = files.coreIndex.subdivide(levelCoreHeader.shrubTextures.offset, levelCoreHeader.shrubTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const shrubTextures = shrubTextureEntries.map((entry, i) => readTextureData(entry, textureData, files.gsRam, "Shrub", i));
    const shrubClassesAndTextures = shrubClassEntries.map(shrubEntry => {
        return {
            shrubEntry,
            shrubClass: readShrubClass(files.coreData.subview(shrubEntry.offsetInAssetWad)),
            textureIndices: shrubEntry.textures,
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

    return {
        ready: true,
        debug: {
            locators,
            lines,
        },

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
    };
}

export type PaletteTexture = ReturnType<typeof readTextureData>;
function readTextureData(textureEntry: TextureEntry, textureData: DataViewExt, gsRam: DataViewExt, ownerType: string, i: number) {
    const pixels = textureData.subview(textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = gsRam.subview(textureEntry.palette * 0x100, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    // const rgbaCss = rgbaPalette.map(c => `color: rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 255});`).join("\n");
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `${ownerType} Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
    }
}

/**
 * Shuffle some indices around then double all the alphas
 */
function fixPalette(palette: Color[]) {
    const newPalette = [...palette]

    for (let i = 0; i < palette.length; i++) {
        newPalette[i] = palette[mapPaletteIndices(i)];
        // newPalette[i] = palette[i]
    }

    for (let i = 0; i < newPalette.length; i++) {
        newPalette[i] = { ...newPalette[i], a: Math.min(newPalette[i].a * 2, 255) };
    }

    return newPalette;
}


function mapPaletteIndices(index: number) {
    // 00010000 -> 00001000.
    return (((index & 16) >> 1) != (index & 8)) ? (index ^ 0b00011000) : index;
}

