import { mat3, vec3 } from "gl-matrix";
import { Color } from "../Color";
import { DataViewExt } from "./DataViewExt";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { RgbaRemapKind, SkyHeader, SkyTextureEntry, TieClass } from "./bin-core";
import { DirectionLightInstance, TieAmbientRgbaBlock, TieInstance } from "./bin-gameplay";
import { assert } from "../util";
import { TextureEntry } from "./bin-index";
import { GN } from "./utils";
import { clamp } from "../MathHelpers";

export interface PaletteTexture {
    name: string,
    textureEntry: { width: number, height: number },
    pixels: Uint8Array,
    palette: Color[],
    hasAlpha: boolean,
    unswizzled: boolean,
};

export function readPalette8TextureWithPaletteInGsRam(gn: GN, textureEntry: TextureEntry, textureData: DataViewExt, gsRam: DataViewExt, ownerType: string, i: number): PaletteTexture {
    let pixels = textureData.subview(textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    if (gn == 4) pixels = unswizzleTexture(pixels, textureEntry)

    let rgbaPalette = gsRam.subview(textureEntry.palette * 0x100, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = unswizzlePalette(rgbaPalette);

    return {
        name: `${ownerType} Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
        unswizzled: false,
    };
}

export function readPalette8TextureSky(gn: GN, skyView: DataViewExt, skyHeader: SkyHeader, textureEntry: SkyTextureEntry, i: number): PaletteTexture {
    let pixels = skyView.subview(skyHeader.textureData + textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    if (gn == 4) pixels = unswizzleTexture(pixels, textureEntry)

    let rgbaPalette = skyView.subview(skyHeader.textureData + textureEntry.palette, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = unswizzlePalette(rgbaPalette);

    return {
        name: `Sky Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
        unswizzled: false,
    };
}

// convert palette texture to regular RGBA texture
function unpalettizeTexture(texture: PaletteTexture): Uint8Array {
    const palettedPixels = new Uint32Array(texture.textureEntry.width * texture.textureEntry.height);
    for (let i = 0; i < palettedPixels.length; i++) {
        const paletteIndex = texture.pixels[i];
        const rgba = texture.palette[paletteIndex];
        palettedPixels[i] = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24);
    }
    return new Uint8Array(palettedPixels.buffer, palettedPixels.byteOffset, palettedPixels.byteLength);
}

// return true if any pixel is transparent
export function paletteHasAlpha(pixels: Uint8Array, palette: Color[]) {
    // we can't just check the palette because the texture might not use all the palette colors
    for (let i = 0; i < pixels.length; i++) {
        if (palette[pixels[i]].a < 0x80) {
            return true;
        }
    }
    return false;
}

// Shuffle some indices around then double all the alphas
function unswizzlePalette(palette: Color[]) {
    const newPalette: Color[] = new Array(palette.length);

    for (let i = 0; i < palette.length; i++) {
        newPalette[i] = palette[unswizzlePaletteMapIndex(i)];
    }

    return newPalette;
}

function unswizzlePaletteMapIndex(index: number) {
    return (((index & 0b00010000) >> 1) != (index & 0b00001000)) ? (index ^ 0b00011000) : index;
}

// Replaces the pixel array with an unswizzled copy. Idempotent.
export function unswizzleTexture(pixels: Uint8Array, entry: TextureEntry | SkyTextureEntry) {
    const width = entry.width;
    const height = entry.height;
    const dbw = Math.ceil(width / 64);
    const out = new Uint8Array(pixels.length);

    let i = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // const addr = getPixelAddressPSMT8(0, dbw, x, y);
            // out[i] = pixels[addr];
            const addr2 = unswizzleMapPixelIndex(y * width + x, width);
            out[addr2] = pixels[y * width + x];
            i++;
        }
    }

    return out;
}

/* Should use getPixelAddressPSMT8 but this is different, not sure why */
function unswizzleMapPixelIndex(i: number, width: number) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/core/texture.cpp#L467
    */
    let s = Math.trunc(i / (width * 2));
    let r = 0;
    if (s % 2 === 0)
        r = s * 2;
    else
        r = (s - 1) * 2 + 1;

    let q = Math.trunc((i % (width * 2)) / 32);

    let m = i % 4;
    let n = Math.trunc(i / 4) % 4;
    let o = i % 2;
    let p = Math.trunc(i / 16) % 2;

    if (Math.trunc(s / 2) % 2 == 1)
        p = 1 - p;

    if (o == 0)
        m = (m + p) % 4;
    else
        m = ((m - p) + 4) % 4;

    let x = n + ((m + q * 4) * 4);
    let y = r + (o * 2);

    return (x % width) + (y * width);
}

// scale down texture by 2x using box filter
function downscale(textureData: Uint8Array): Uint8Array {
    const originalDim = Math.sqrt(textureData.length / 4);
    if (!Number.isInteger(originalDim)) {
        throw new Error(`Texture data is not a square`);
    }
    const dim = originalDim / 2;
    assert(Number.isInteger(dim));
    assert(dim > 0);
    const downscaled = new Uint8Array(dim * dim * 4);
    for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
            const srcX = x * 2;
            const srcY = y * 2;
            const dstIndex = (y * dim + x) * 4;
            // Average 2x2 pixels
            for (let c = 0; c < 4; c++) {
                const p1 = textureData[((srcY + 0) * originalDim + (srcX + 0)) * 4 + c];
                const p2 = textureData[((srcY + 0) * originalDim + (srcX + 1)) * 4 + c];
                const p3 = textureData[((srcY + 1) * originalDim + (srcX + 0)) * 4 + c];
                const p4 = textureData[((srcY + 1) * originalDim + (srcX + 1)) * 4 + c];
                downscaled[dstIndex + c] = Math.floor((p1 + p2 + p3 + p4) / 4);
            }
        }
    }
    return downscaled;
}

export function createGfxTextureForPaletteTexture(device: GfxDevice, texture: PaletteTexture): { pixelsTexture: GfxTexture } {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.textureEntry.width, texture.textureEntry.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    const palettedPixels = new Uint32Array(texture.textureEntry.width * texture.textureEntry.height);
    for (let i = 0; i < palettedPixels.length; i++) {
        const paletteIndex = texture.pixels[i];
        const rgba = texture.palette[paletteIndex];
        palettedPixels[i] = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24);
    }
    const asUint8 = new Uint8Array(palettedPixels.buffer, palettedPixels.byteOffset, palettedPixels.byteLength);
    device.uploadTextureData(gfxTexture, 0, [asUint8]);
    return {
        pixelsTexture: gfxTexture
    };
}

export function create1x1x1ErrorArrayTexture(device: GfxDevice): GfxTexture {
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, 'Error Texture Array');
    const errorPixel = new Uint8Array([255, 0, 255, 255]);
    device.uploadTextureData(gfxTexture, 0, [errorPixel]);
    return gfxTexture;
}

/**
 * Pack many palette textures into a big texture array.
 */
export function createGfxTextureArrayForPaletteTextures(device: GfxDevice, name: string, textures: PaletteTexture[]) {
    if (textures.length === 0) {
        return create1x1x1ErrorArrayTexture(device);
    }

    const dim = Math.max(...textures.map(t => t.textureEntry.width));
    const numLevels = Math.log2(dim) + 1;
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: dim,
        height: dim,
        depthOrArrayLayers: textures.length,
        numLevels: numLevels,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, name);

    const mipLevels: Uint8Array[] = [];
    const ptrs = new Array(numLevels).fill(0);
    for (let level = 0; level < numLevels; level++) {
        const mipDim = dim >> level;
        mipLevels.push(new Uint8Array(mipDim * mipDim * 4 * textures.length));
    }

    for (const texture of textures) {
        assert(texture.textureEntry.width === texture.textureEntry.height);
        assert(texture.textureEntry.width === dim);

        let textureData = unpalettizeTexture(texture);

        // I'd really like to read the real mip data from the game
        // If I did that I also wouldn't need to unpalettize the textures on the cpu.
        for (let level = 0; level < numLevels; level++) {
            mipLevels[level].set(textureData, ptrs[level]);
            ptrs[level] += textureData.byteLength;
            if (level < numLevels - 1) {
                textureData = downscale(textureData);
            }
        }
    }
    device.uploadTextureData(gfxTexture, 0, mipLevels);
    return gfxTexture;
}

// create a 64xN texture, where each row contains the 64-wide vertex color lookup table for one tie instance
export function createTieRgbaTexture_Rac1(device: GfxDevice, tieInstances: (TieInstance | null)[]): GfxTexture {
    if (tieInstances.length === 0) {
        return create1x1x1ErrorArrayTexture(device);
    }

    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2D,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: 64,
        height: tieInstances.length,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, `Tie Ambient RGBAs`);

    const data = new Uint8Array(64 * tieInstances.length * 4);
    let ptr = 0;
    for (let i = 0; i < tieInstances.length; i++) {
        const instance = tieInstances[i];
        if (instance) {
            for (let j = 0; j < 64; j++) {
                const a1bgr5 = instance.ambientRgbas[j];
                data[ptr + 0] = ((a1bgr5 >> 0) & 0x1F) << 3;
                data[ptr + 1] = ((a1bgr5 >> 5) & 0x1F) << 3;
                data[ptr + 2] = ((a1bgr5 >> 10) & 0x1F) << 3;
                data[ptr + 3] = 255; // no alpha in this color format
                ptr += 4;
            }
        } else {
            ptr += 64 * 0x4;
        }
    }

    device.uploadTextureData(gfxTexture, 0, [data]);

    return gfxTexture;
}

const MAGIC_GLOW_IDX = 2044;

const tieNormalScratch = vec3.create();
const tieDirectionScratch = vec3.create();
const tieLightColorScratch = vec3.create();

function transformTieNormal(normal: { x: number, y: number, z: number }, inverseTransform: mat3, out: vec3): void {
    vec3.set(out, normal.x, normal.y, normal.z);
    vec3.transformMat3(out, out, inverseTransform);
    vec3.normalize(out, out);
}

function lightTieColor(
    color: { r: number, g: number, b: number },
    normal: { x: number, y: number, z: number },
    inverseTransform: mat3,
    tieInstance: TieInstance,
    directionLights: DirectionLightInstance[],
    out: vec3,
): void {
    transformTieNormal(normal, inverseTransform, tieNormalScratch);
    vec3.set(out, color.r * 2, color.g * 2, color.b * 2);

    for (let i = 0; i < 4; i++) {
        const lightIndex = tieInstance.directionalLights[i];
        if (lightIndex === 0xF || (i > 0 && lightIndex === 0)) break;
        const light = directionLights[lightIndex];
        if (!light) continue;

        vec3.set(tieDirectionScratch, light.directionA.x, light.directionA.z, -light.directionA.y);
        const dotA = vec3.dot(tieNormalScratch, tieDirectionScratch);
        if (dotA > 0) {
            vec3.set(tieLightColorScratch, light.colorA.r, light.colorA.g, light.colorA.b);
            vec3.scaleAndAdd(out, out, tieLightColorScratch, dotA * 255);
        }

        vec3.set(tieDirectionScratch, light.directionB.x, light.directionB.z, -light.directionB.y);
        const dotB = vec3.dot(tieNormalScratch, tieDirectionScratch);
        if (dotB > 0) {
            vec3.set(tieLightColorScratch, light.colorB.r, light.colorB.g, light.colorB.b);
            vec3.scaleAndAdd(out, out, tieLightColorScratch, dotB * 255);
        }
    }

    out[0] = clamp(Math.round(out[0]), 0, 255);
    out[1] = clamp(Math.round(out[1]), 0, 255);
    out[2] = clamp(Math.round(out[2]), 0, 255);
}

export function createTieRgbaTexture_Rac234(device: GfxDevice, tieInstances: (TieInstance | null)[], tieClasses: Map<number, TieClass>, tieRgbasBlock: TieAmbientRgbaBlock, directionLights: DirectionLightInstance[]): GfxTexture {
    const lods = 3;
    const width = 4096;
    const height = tieInstances.length;

    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width, // very wasteful
        height,
        depthOrArrayLayers: lods,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, `Tie Ambient RGBAs`);

    const data = new Uint8Array(width * height * 4 * lods);
    for (let i = 0; i < tieRgbasBlock.list.length; i++) {
        const row = tieRgbasBlock.list[i];

        const tieInst = tieInstances[row.tieIndex];
        if (!tieInst) continue;
        assert(row.tieIndex === tieInst._i);
        const tieClass = tieClasses.get(tieInst.oClass);
        assert(tieClass !== undefined);
        assert(row.ambientRgbas.length % 2 === 0);
        // assert(row.ambientRgbas.length >= tieClass.normalsData.length);
        assert(tieClass.rgbaRemaps !== null);
        const rgbaRemapsByLod = tieClass.rgbaRemaps;
        const transform = mat3.fromMat4(mat3.create(), tieInst._matrixPretransformed);
        const inverseTransform = mat3.invert(mat3.create(), transform);
        assert(inverseTransform !== null);
        const inputColors = new Uint8Array(4 * 4096);
        const litColor = vec3.create();

        const glowColor = tieClass.header.glowRgba;
        const inputGlowColor = glowColor;
        const scratch = [0, 0, 0];

        // Fill the input buffer with magenta so missing colors remain visible.
        for (let col = 0; col < 4096; col++) {
            inputColors[col * 4 + 0] = 255;
            inputColors[col * 4 + 1] = 0;
            inputColors[col * 4 + 2] = 255;
            inputColors[col * 4 + 3] = 255;
        }

        // decode and copy the initial buffer
        for (let col = 0; col < row.ambientRgbas.length; col++) {
            const color = row.ambientRgbas[col];
            const normal = tieClass.normalsData[col] ?? { x: 0, y: 0, z: 1 }; // its ok for ties to have missing normals, I think this happens when glow verts are at the end of the mesh
            lightTieColor(color, normal, inverseTransform, tieInst, directionLights, litColor);
            inputColors[col * 4 + 0] = litColor[0];
            inputColors[col * 4 + 1] = litColor[1];
            inputColors[col * 4 + 2] = litColor[2];
            inputColors[col * 4 + 3] = 255; // no alpha in this color format
        }

        for (let lod = 0; lod < lods; lod++) {
            const rgbaRemaps = rgbaRemapsByLod[lod];
            const outputColors = new Uint8Array(4 * 4096);

            // Fill each LOD output with magenta so missing remaps remain visible.
            for (let col = 0; col < 4096; col++) {
                outputColors[col * 4 + 0] = 255;
                outputColors[col * 4 + 1] = 0;
                outputColors[col * 4 + 2] = 255;
                outputColors[col * 4 + 3] = 255;
            }

            if (rgbaRemaps !== null) {
                // Evaluate each remap as the average of its four source colors.
                for (let packetIndex = 0; packetIndex < rgbaRemaps.packets.length; packetIndex++) {
                    const packet = rgbaRemaps.packets[packetIndex];
                    for (let remapIndex = 0; remapIndex < packet.remaps.length; remapIndex++) {
                        const remap = packet.remaps[remapIndex];
                        const dest = packet.outputBase + remap.dest;

                        if (remap.kind === RgbaRemapKind.Zero) {
                            assert(remap.src === 0);
                            outputColors[dest + 0] = 0;
                            outputColors[dest + 1] = 0;
                            outputColors[dest + 2] = 0;
                        } else {
                            assert(Array.isArray(remap.src));
                            assert(remap.src.length === 4);
                            scratch[0] = 0;
                            scratch[1] = 0;
                            scratch[2] = 0;

                            for (let remapSrcIndex = 0; remapSrcIndex < 4; remapSrcIndex++) {
                                const src = remap.src[remapSrcIndex];
                                for (let channel = 0; channel < 3; channel++) {
                                    if (src === MAGIC_GLOW_IDX) {
                                        scratch[channel] += channel === 0 ? inputGlowColor.r : channel === 1 ? inputGlowColor.g : inputGlowColor.b;
                                    } else {
                                        scratch[channel] += inputColors[src + channel];
                                    }
                                }
                            }

                            for (let channel = 0; channel < 3; channel++) {
                                outputColors[dest + channel] = Math.floor(scratch[channel] / 4);
                            }
                        }

                        outputColors[dest + 3] = 255;
                    }
                }
            }

            const ptr = (lod * height + tieInst._i) * width * 4;
            assert(ptr + outputColors.byteLength <= data.byteLength);
            data.set(outputColors, ptr);
        }
    }

    device.uploadTextureData(gfxTexture, 0, [data]);

    return gfxTexture;
}

type TexturesBySize = {
    16: PaletteTexture[],
    32: PaletteTexture[],
    64: PaletteTexture[],
    128: PaletteTexture[],
    256: PaletteTexture[],
};

function validateSize(size: number): size is 16 | 32 | 64 | 128 | 256 {
    const validSizes = [16, 32, 64, 128, 256];
    return validSizes.includes(size);
}

function assignTexturesToSizeBucket(buckets: TexturesBySize, textures: PaletteTexture[]) {
    const remap = textures.map((texture, i) => {
        const width = texture.textureEntry.width;
        assert(width === texture.textureEntry.height);
        assert(validateSize(width));
        buckets[width].push(texture);
        return {
            sizeBucket: width,
            index: buckets[width].length - 1,
        };
    });

    return remap;
}


export function packRemap(remap: { sizeBucket: number, index: number }) {
    const bucket = remap ? Math.log2(remap.sizeBucket) - 4 : 0;
    const slice = remap ? remap.index : 0;
    return (slice << 3) | (bucket & 0x07);
};

export interface TextureAtlases {
    gfxTextures: { [size in 16 | 32 | 64 | 128 | 256]: GfxTexture },
    tfragTextureRemap: { sizeBucket: number, index: number }[],
    tieTextureRemap: { sizeBucket: number, index: number }[],
    mobyTextureRemap: { sizeBucket: number, index: number }[],
    shrubTextureRemap: { sizeBucket: number, index: number }[],
};

export function createTextureAtlases(device: GfxDevice, tfragTextures: PaletteTexture[], tieTextures: PaletteTexture[], mobyTextures: PaletteTexture[], shrubTextures: PaletteTexture[]): TextureAtlases {
    const texturesBySize: TexturesBySize = {
        16: [],
        32: [],
        64: [],
        128: [],
        256: [],
    };

    const tfragTextureRemap = assignTexturesToSizeBucket(texturesBySize, tfragTextures);
    const tieTextureRemap = assignTexturesToSizeBucket(texturesBySize, tieTextures);
    const mobyTextureRemap = assignTexturesToSizeBucket(texturesBySize, mobyTextures);
    const shrubTextureRemap = assignTexturesToSizeBucket(texturesBySize, shrubTextures);

    const gfxTextures = {
        16: createGfxTextureArrayForPaletteTextures(device, '16x16 Texture Array', texturesBySize[16]),
        32: createGfxTextureArrayForPaletteTextures(device, '32x32 Texture Array', texturesBySize[32]),
        64: createGfxTextureArrayForPaletteTextures(device, '64x64 Texture Array', texturesBySize[64]),
        128: createGfxTextureArrayForPaletteTextures(device, '128x128 Texture Array', texturesBySize[128]),
        256: createGfxTextureArrayForPaletteTextures(device, '256x256 Texture Array', texturesBySize[256]),
    };

    return {
        gfxTextures,
        tfragTextureRemap,
        tieTextureRemap,
        mobyTextureRemap,
        shrubTextureRemap,
    };
}
