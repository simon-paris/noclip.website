import { mat4, ReadonlyMat4, vec3, vec4 } from "gl-matrix";
import { PaletteTexture } from "./level-builder";
import { GfxDevice, GfxFormat, GfxTexture, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { Color } from "../Color";

// rotate the whole world 90 degrees
const _noclipSpaceFromRatchetSpace = mat4.create();
mat4.rotateX(_noclipSpaceFromRatchetSpace, mat4.clone(_noclipSpaceFromRatchetSpace), -Math.PI / 2);
export const noclipSpaceFromRatchetSpace = _noclipSpaceFromRatchetSpace as ReadonlyMat4;

// turn an array of objects into a map of arrays, using their oClass field as the key
export function makeInstanceOClassMap<T extends { oClass: number }>(instances: T[]) {
    const map = new Map<number, T[]>();
    for (const inst of instances) {
        if (!map.has(inst.oClass)) {
            map.set(inst.oClass, []);
        }
        map.get(inst.oClass)!.push(inst);
    }
    return map;
}

export function getBit(value: number, bit: number) {
    return (value >> bit) & 1;
}

// get bits from startBit to endBit (inclusive)
export function getBits(value: number, startBit: number, endBit: number) {
    return (value >> startBit) & ((1 << (endBit - startBit + 1)) - 1);
}

export function makeTextureWithPalette(device: GfxDevice, texture: PaletteTexture): { pixelsTexture: GfxTexture } {
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


export function distanceToCamera(position: vec3, cameraPosition: vec3) {
    const toCamera = vec3.create();
    vec3.sub(toCamera, position, cameraPosition);
    return vec3.len(toCamera);
}

// divide count into batches of at most batchSize, returning an array of sizes
export function batches(count: number, batchSize: number) {
    if (batchSize <= 0) throw new Error('batchSize must be greater than 0');
    const result = [];
    while (count > 0) {
        result.push(Math.min(count, batchSize));
        count -= batchSize;
    }
    return result;
}

export function pathToDebugLines(points: { x: number, y: number, z: number }[], color: Color): { from: vec3, to: vec3, color: Color }[] {
    const lines: { from: vec3, to: vec3, color: Color }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i]!;
        const p1 = points[i + 1]!;
        const from = vec3.fromValues(p0.x, p0.y, p0.z);
        const to = vec3.fromValues(p1.x, p1.y, p1.z);
        vec3.transformMat4(from, from, noclipSpaceFromRatchetSpace);
        vec3.transformMat4(to, to, noclipSpaceFromRatchetSpace);
        lines.push({ from, to, color });
    }
    return lines;
}