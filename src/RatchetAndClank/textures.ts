import { Color } from "../Color";
import { DataViewExt } from "../DataViewExt";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { SkyHeader, SkyTextureEntry, TextureEntry } from "./structs-core";

export type PaletteTexture = {
    name: string,
    textureEntry: { width: number, height: number },
    pixels: Uint8Array,
    palette: Color[],
    hasAlpha: boolean,
};

export function readPalette8TextureWithPaletteInGsRam(textureEntry: TextureEntry, textureData: DataViewExt, gsRam: DataViewExt, ownerType: string, i: number): PaletteTexture {
    const pixels = textureData.subview(textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = gsRam.subview(textureEntry.palette * 0x100, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `${ownerType} Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
    };
}

export function readPalette8TextureSky(skyView: DataViewExt, skyHeader: SkyHeader, textureEntry: SkyTextureEntry, i: number): PaletteTexture {
    const pixels = skyView.subview(skyHeader.textureData + textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = skyView.subview(skyHeader.textureData + textureEntry.palette, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `Sky Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
    };
}

// return true if any pixel is transparent
export function paletteHasAlpha(pixels: Uint8Array, palette: Color[]) {
    // we can't just check the palette because the texture might not use all the palette colors
    for (let i = 0; i < pixels.length; i++) {
        if (palette[pixels[i]].a < 255) {
            return true;
        }
    }
    return false;
}

// Shuffle some indices around then double all the alphas
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
    // swap the two middle bits for some reason
    return (((index & 0b00010000) >> 1) != (index & 0b00001000)) ? (index ^ 0b00011000) : index;
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

// scale up texture by 2x
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

/**
 * Pack many palette textures into a big texture array.
 * Scales up textures to match the largest in the list.
 */
export function createGfxTextureArrayForPaletteTextures(device: GfxDevice, name: string, textures: PaletteTexture[]) {
    const dim = Math.max(...textures.map(t => t.textureEntry.width));
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: dim,
        height: dim,
        depthOrArrayLayers: textures.length,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, name);

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

