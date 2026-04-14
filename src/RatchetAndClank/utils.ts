import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice } from "../gfx/platform/GfxPlatform";
import { Color } from "../Color";
import { assert, nArray } from "../util";
import { IS_DEVELOPMENT } from "../BuildVersion";

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

export function distanceToCamera(position: vec3, cameraPosition: vec3) {
    const toCamera = vec3.create();
    vec3.sub(toCamera, position, cameraPosition);
    return vec3.len(toCamera);
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

export function truncateTrailing0xFF(arr: number[]): number[] {
    const copy = arr.slice();
    while (copy.length > 0 && copy[copy.length - 1] === 0xFF) {
        copy.pop();
    }
    return copy;
}

export type MegaBuffer = {
    /**
     * Pointer in floats.
     */
    ptr: number,
    buffer: ArrayBuffer,
    f32View: Float32Array,
    u8View: Uint8Array,
    gfxBuffer: GfxBuffer,

    /**
     * Uploads the used portion of the buffer and resets the pointer to 0.
     */
    upload: () => void,

    destroy: () => void,
};

/**
 * Create a shared buffer for uploading instance data.
 */
export function createMegaBuffer(device: GfxDevice, name: string, initialSizeInBytes: number): MegaBuffer {
    let byteSize = initialSizeInBytes;
    const gfxBuffer = device.createBuffer(byteSize, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
    device.setResourceName(gfxBuffer, name);

    const arrayBuffer = new ArrayBuffer(byteSize);
    const f32View = new Float32Array(arrayBuffer);
    const u8View = new Uint8Array(arrayBuffer);

    const megaBuffer: MegaBuffer = {
        ptr: 0,
        buffer: arrayBuffer,
        f32View,
        u8View,
        gfxBuffer,

        upload() {
            if (this.ptr === 0) return;
            if (this.ptr * 4 > byteSize) {
                throw new Error(`Buffer overflow`);
            }
            device.uploadBufferData(this.gfxBuffer, 0, this.u8View, 0, this.ptr * 4);
            this.ptr = 0;
        },

        destroy() {
            device.destroyBuffer(this.gfxBuffer);
        }
    };
    return megaBuffer;
}

export enum ImaginaryGsCommandType {
    PRIMITIVE_RESET = 1,
    SET_MATERIAL = 2,
    VERTEX = 3,
}

export type ImaginaryGsCommand<PrimativeType, MaterialType, VertexType> =
    | {
        type: ImaginaryGsCommandType.PRIMITIVE_RESET,
        size: number,
        value: PrimativeType,
    }
    | {
        type: ImaginaryGsCommandType.SET_MATERIAL,
        size: number,
        value: MaterialType,
    }
    | {
        type: ImaginaryGsCommandType.VERTEX,
        size: number,
        value: VertexType,
    }

export class ImaginaryGsCommandBuffer<PrimativeType, MaterialType, VertexType> {
    public slots: (ImaginaryGsCommand<PrimativeType, MaterialType, VertexType> | null)[] = nArray(0x100, () => null);
    maxSlotUsed = 0;

    writePrimativeReset(address: number, size: number, primative: PrimativeType, allowOverwrite: boolean = false) {
        this.write(address, size, { type: ImaginaryGsCommandType.PRIMITIVE_RESET, size, value: primative }, allowOverwrite);
    }

    writeSetMaterial(address: number, size: number, material: MaterialType, allowOverwrite: boolean = false) {
        this.write(address, size, { type: ImaginaryGsCommandType.SET_MATERIAL, size, value: material }, allowOverwrite);
    }

    writeVertex(address: number, size: number, vertex: VertexType, allowOverwrite: boolean = false) {
        this.write(address, size, { type: ImaginaryGsCommandType.VERTEX, size, value: vertex }, allowOverwrite);
    }

    private write(address: number, size: number, command: any, allowOverwrite: boolean): void {
        assert(address >= 0 && address < 0x100);
        if (!allowOverwrite) {
            assert(this.slots[address] === null);
        }
        this.slots[address] = command;
        this.maxSlotUsed = Math.max(this.maxSlotUsed, address);
    }

    finish() {
        if (IS_DEVELOPMENT) {
            // validation
            let expectedEmptySlots = 0;
            let expectPrimativeRestart = true;
            for (let i = 0; i < this.maxSlotUsed; i++) {
                const command = this.slots[i];
                if (command) {
                    if (expectedEmptySlots !== 0) {
                        throw new Error(`Unexpected write to GS command buffer`);
                    }
                    if (command.type === ImaginaryGsCommandType.VERTEX && expectPrimativeRestart) {
                        throw new Error(`Expected a primative restart command before first vertex`);
                    }
                    if (command.type === ImaginaryGsCommandType.PRIMITIVE_RESET) {
                        expectPrimativeRestart = false;
                    }
                    if (command.type === ImaginaryGsCommandType.SET_MATERIAL) {
                        expectPrimativeRestart = true;
                    }
                    expectedEmptySlots += command.size;
                } else {
                    if (expectedEmptySlots === 0) {
                        throw new Error(`Expected a write to GS command buffer`);
                    }
                }
                expectedEmptySlots--;
            }
        }
        return this.slots.filter(cmd => cmd !== null);
    }
}
