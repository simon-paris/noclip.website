import { readDirectionLightInstance, readGameplayHeader, readGrindPathBlock, readInstanceBlock, readLevelSettings, readMobyInstance, readPathBlock, readPointLightInstance, readShrubInstance, readTieInstance, ShrubInstance, SIZEOF_DIRECTION_LIGHT_INSTANCE, SIZEOF_MOBY_INSTANCE, SIZEOF_POINT_LIGHT_INSTANCE, SIZEOF_SHRUB_INSTANCE, SIZEOF_TIE_INSTANCE, TieInstance } from "./structs-gameplay";
import { DataViewExt } from "../DataViewExt";
import { assert } from "../util";
import { readGsRamTableEntry, readLevelCoreHeader, readShrubClass, readShrubClassEntry, readSky, readSkyHeader, readSkyShell, readSkyShellHeader, readSkyTextureEntry, readTextureEntry, readTfrag, readTfragBlockHeader, readTfragHeader, readTieClass, readTieOrMobyClassEntryArray, ShrubClass, SIZEOF_GS_RAM_TABLE_ENTRY, SIZEOF_SHRUB_CLASS_ENTRY, SIZEOF_SKY_TEXTURE_ENTRY, SIZEOF_TEXTURE_ENTRY, SIZEOF_TFRAG_HEADER, SkyHeader, SkyTexture, TextureEntry, TieClass } from "./structs-core";
import { makeInstanceOClassMap } from "./utils";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color } from "../Color";
import { GfxDevice, GfxFormat, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform";

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

export function buildLevelFromFiles(files: LevelFiles) {
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
            tieClass: readTieClass(files.coreData.subview(entry.offsetInAssetWad), entry.oClass),
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

    // read moby instances
    const mobyInstances = readInstanceBlock(files.gameplay.subview(gameplayHeader.mobyInstances), SIZEOF_MOBY_INSTANCE, readMobyInstance);

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

    // read sky
    const sky = readSky(files.coreData.subview(levelCoreHeader.sky));
    const skyTextures = sky.textureEntries.map((textureEntry, i) => readSkyTextureData(files.coreData.subview(levelCoreHeader.sky), sky.header, textureEntry, i));

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

export type PaletteTexture = {
    name: string,
    textureEntry: { width: number, height: number },
    pixels: Uint8Array,
    palette: Color[],
}
function readTextureData(textureEntry: TextureEntry, textureData: DataViewExt, gsRam: DataViewExt, ownerType: string, i: number): PaletteTexture {
    const pixels = textureData.subview(textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = gsRam.subview(textureEntry.palette * 0x100, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `${ownerType} Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
    };
}

function readSkyTextureData(skyView: DataViewExt, skyHeader: SkyHeader, textureEntry: SkyTexture, i: number): PaletteTexture {
    const pixels = skyView.subview(skyHeader.textureData + textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = skyView.subview(skyHeader.textureData + textureEntry.palette, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `Sky Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
    };
}

/**
 * Shuffle some indices around then double all the alphas
 */
function fixPalette(palette: Color[]) {
    const newPalette = [...palette]

    for (let i = 0; i < palette.length; i++) {
        newPalette[i] = palette[mapPaletteIndices(i)];
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

function unpalettizeTexture(texture: PaletteTexture): Uint8Array {
    const palettedPixels = new Uint32Array(texture.textureEntry.width * texture.textureEntry.height);
    for (let i = 0; i < palettedPixels.length; i++) {
        const paletteIndex = texture.pixels[i];
        const rgba = texture.palette[paletteIndex];
        palettedPixels[i] = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24);
    }
    return new Uint8Array(palettedPixels.buffer, palettedPixels.byteOffset, palettedPixels.byteLength);
}

function upscale(textureData: Uint8Array): Uint8Array {
    const originalDim = Math.sqrt(textureData.length / 4);
    if (!Number.isInteger(originalDim)) {
        throw new Error(`Texture data is not a square`);
    }
    const dim = originalDim * 2;
    const upscaled = new Uint8Array(dim * dim * 4);
    for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
            const srcX = Math.floor(x / 2);
            const srcY = Math.floor(y / 2);
            const srcIndex = (srcY * originalDim + srcX) * 4;
            const dstIndex = (y * dim + x) * 4;
            upscaled[dstIndex] = textureData[srcIndex];
            upscaled[dstIndex + 1] = textureData[srcIndex + 1];
            upscaled[dstIndex + 2] = textureData[srcIndex + 2];
            upscaled[dstIndex + 3] = textureData[srcIndex + 3];
        }
    }
    return upscaled;
}

export function createTextureArray(device: GfxDevice, textures: PaletteTexture[], dim: number) {
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: dim,
        height: dim,
        depthOrArrayLayers: textures.length,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });

    const textureData = new Uint8Array(dim * dim * 4 * textures.length);
    let ptr = 0;
    for (const texture of textures) {
        let textureDim = texture.textureEntry.width;
        if (textureDim > dim) {
            throw new Error(`Texture is bigger than the texture array`);
        }
        if (textureDim !== texture.textureEntry.height) {
            throw new Error(`Texture is not square`);
        }
        let nextTextureData = unpalettizeTexture(texture);
        while (textureDim < dim) {
            textureDim *= 2;
            nextTextureData = upscale(nextTextureData);
        }
        textureData.set(nextTextureData, ptr);
        ptr += nextTextureData.byteLength;
    }
    device.uploadTextureData(gfxTexture, 0, [textureData]);
    return gfxTexture;
}
