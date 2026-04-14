import { IS_DEVELOPMENT } from "../BuildVersion";
import { GsPrimitiveType } from "../Common/PS2/GS";
import { DataViewExt } from "../DataViewExt";
import { getBit, getBits, truncateTrailing0xFF } from "./utils";
import { isUnpackCommand, readVifCommandList, readVifStrowData, readVifUnpackData, VifVnVl } from "./vif";

export type LevelCoreHeader = ReturnType<typeof readLevelCoreHeader>;
export const SIZEOF_LEVEL_CORE_HEADER = 0xbc;
export function readLevelCoreHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_core.h#L27
    */

    return {
        gsRam: view.getInt32PairAs(0, "count", "offset"),
        tfrags: view.getInt32(0x8),
        occlusion: view.getInt32(0xc),
        sky: view.getInt32(0x10),
        collision: view.getInt32(0x14),
        mobyClasses: view.getInt32PairAs(0x18, "count", "offset"),
        tieClasses: view.getInt32PairAs(0x20, "count", "offset"),
        shrubClasses: view.getInt32PairAs(0x28, "count", "offset"),
        tfragTextures: view.getInt32PairAs(0x30, "count", "offset"),
        mobyTextures: view.getInt32PairAs(0x38, "count", "offset"),
        tieTextures: view.getInt32PairAs(0x40, "count", "offset"),
        shrubTextures: view.getInt32PairAs(0x48, "count", "offset"),
        partTextures: view.getInt32PairAs(0x50, "count", "offset"),
        fxTextures: view.getInt32PairAs(0x58, "count", "offset"),
        texturesBaseOffset: view.getInt32(0x60),
        partBankOffset: view.getInt32(0x64),
        fxBankOffset: view.getInt32(0x68),
        partDefsOffset: view.getInt32(0x6c),
        soundRemapOffset: view.getInt32(0x70),
        sceneViewSize: view.getInt32(0x7c),
        assetsCompressedSize: view.getInt32(0x88),
        assetsDecompressedSize: view.getInt32(0x8c),
        chromeMapTexture: view.getInt32(0x90),
        chromeMapPalette: view.getInt32(0x94),
        glassMapTexture: view.getInt32(0x98),
        glassMapPalette: view.getInt32(0x9c),
        heightmapOffset: view.getInt32(0xa4),
        occlusionOctOffset: view.getInt32(0xa8),
        mobyGsStashList: view.getInt32(0xac),
        occlusionRadOffset: view.getInt32(0xb0),
        mobySoundRemapOffset: view.getInt32(0xb4),
        occlusionRad2Offset: view.getInt32(0xb8),
    }
}

export type GsRamTableEntry = {
    psm: number,
    width: number,
    height: number,
    address: number,
    offset: number,
}
export const SIZEOF_GS_RAM_TABLE_ENTRY = 0x10;
export function readGsRamTableEntry(view: DataViewExt) {
    /*    
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_textures.h#L29
    */
    return {
        psm: view.getInt32(0x0),
        width: view.getInt16(0x4),
        height: view.getInt16(0x6),
        address: view.getInt32(0x8),
        offset: view.getInt32(0xc),
    }
}

// for ties, mobys, and shrubs
export type ClassEntry = {
    offsetInCoreData: number,
    oClass: number,
    textures: number[],
}
export const SIZEOF_TIE_CLASS_ENTRY = 0x20;
export const SIZEOF_MOBY_CLASS_ENTRY = 0x20;
export const SIZEOF_SHRUB_CLASS_ENTRY = 0x30;
export function readClassEntry(view: DataViewExt): ClassEntry {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_core.h#L81-L104
    Tie and moby class entries are the same. Shrubs have an extra field for billboard info that we don't need.
    */
    return {
        offsetInCoreData: view.getInt32(0x0),
        oClass: view.getInt32(0x4),
        textures: truncateTrailing0xFF(view.getArrayOfNumbers(0x10, 16, Uint8Array)),
    };
}

export type TextureEntry = {
    dataOffset: number,
    width: number,
    height: number,
    type: number,
    palette: number,
    mipmap: number,
    pad: number,
}
export const SIZEOF_TEXTURE_ENTRY = 0x10;
export function readTextureEntry(view: DataViewExt): TextureEntry {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_textures.h#L37
    */
    return {
        dataOffset: view.getInt32(0x0),
        width: view.getInt16(0x4),
        height: view.getInt16(0x6),
        type: view.getInt16(0x8),
        palette: view.getInt16(0xa),
        mipmap: view.getInt16(0xc),
        pad: view.getInt16(0xe),
    };
}

export type TieClass = {
    normalsData: { x: number, y: number, z: number }[],
    nearDist: number,
    midDist: number,
    farDist: number,
    bsphere: { x: number, y: number, z: number, w: number },
    scale: number,
    packets: TiePacket[][], // [lod][packet]
    adGifs: TieAdGifs[],
};
export type TiePacket = {
    header: TiePacketHeader,
    body: TiePacketBody,
};
export function readTieClass(view: DataViewExt, oClass: number): TieClass {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L37
    */

    // `packetOffsets[i]` points to `TiePacketHeader headers[packetCount[i]]`
    // (relative to this struct)
    const packetOffsets = view.getArrayOfNumbers(0x0, 3, Uint32Array);
    const packetCounts = view.getArrayOfNumbers(0x20, 3, Uint8Array);

    const packets: TiePacket[][] = [];

    // there are always 3 lods
    for (let i = 0; i < 3; i++) {
        const packetOffset = packetOffsets[i];
        const packetCount = packetCounts[i];
        const packetHeaders = view.subdivide(packetOffset, packetCount, SIZEOF_TIE_PACKET_HEADER).map(readTiePacketHeader);

        const packetsInThisLod: TiePacket[] = [];
        for (let j = 0; j < packetCount; j++) {
            const packetDataOffset = packetOffset + packetHeaders[j].data;
            const packetBody = readTiePacketBody(view.subview(packetDataOffset), packetHeaders[j], oClass, i, j);
            packetsInThisLod.push({
                header: packetHeaders[j],
                body: packetBody,
            })
        }

        packets.push(packetsInThisLod);
    }

    const textureCount = view.getUint8(0x23);
    const adGifsOffset = view.getUint32(0x2c);
    const adGifs = view.subdivide(adGifsOffset, textureCount, SIZEOF_TIE_AD_GIFS).map(readTieAdGifs);

    const normalsOffset = view.getUint32(0xc);
    const normalsData = view.subdivide(normalsOffset, 64, 8).map(view => view.getInt16_Xyzw(0));

    return {
        normalsData,
        nearDist: view.getFloat32(0x10),
        midDist: view.getFloat32(0x14),
        farDist: view.getFloat32(0x18),
        bsphere: view.getFloat32_Xyzw(0x30),
        scale: view.getFloat32(0x40),
        packets,
        adGifs,
    };
}

export type TiePacketHeader = {
    data: number,
    shaderCount: number,
    bfcDistance: number,
    controlCount: number,
    controlSize: number,
    vertOffset: number,
    vertSize: number,
    rgbaCount: number,
    multipassOffset: number,
    scissorOffset: number,
    scissorSize: number,
    multipassType: number,
    multipassUvSize: number,
}
export const SIZEOF_TIE_PACKET_HEADER = 0x10;
export function readTiePacketHeader(view: DataViewExt): TiePacketHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L92
    */

    return {
        data: view.getInt32(0x0),
        shaderCount: view.getUint8(0x4),
        bfcDistance: view.getUint8(0x5),
        controlCount: view.getUint8(0x6),
        controlSize: view.getUint8(0x7),
        vertOffset: view.getUint8(0x8),
        vertSize: view.getUint8(0x9),
        rgbaCount: view.getUint8(0xa),
        multipassOffset: view.getUint8(0xb),
        scissorOffset: view.getUint8(0xc),
        scissorSize: view.getUint8(0xd),
        multipassType: view.getUint8(0xe),
        multipassUvSize: view.getUint8(0xf),
    };
}

export const TiePacketCommandTypes = {
    PRIMITIVE_RESET: 1,
    SET_MATERIAL: 2,
    VERTEX: 3,
} as const;

export type TiePacketCommand = {
    type: typeof TiePacketCommandTypes.PRIMITIVE_RESET,
    size: number,
    value: TieStrip
} | {
    type: typeof TiePacketCommandTypes.SET_MATERIAL,
    size: number,
    value: number
} | {
    type: typeof TiePacketCommandTypes.VERTEX,
    size: number,
    value: { vertex: TieVertex, normalIndex: number }
}

const TieCommandSizes = {
    [TiePacketCommandTypes.PRIMITIVE_RESET]: 1,
    [TiePacketCommandTypes.SET_MATERIAL]: 6,
    [TiePacketCommandTypes.VERTEX]: 3,
}

export type TiePacketBody = ReturnType<typeof readTiePacketBody>;
export function readTiePacketBody(view: DataViewExt, tiePacketHeader: TiePacketHeader, oClass: number, lod: number, packetIndex: number) {
    /*
        // unsized
        packed struct TiePacketBody {
            // 0x0
            i32 adGifDestOffsets[4];
            // 0x10
            i32 adGifSrcOffsets[4];
            // 0x20
            TieUnpackHeader tieUnpackHeader;
            // 0x2c
            TieStrip tieStrips[tieUnpackHeader.stripCount];
            // align 0x10
            TieDinkyVertex dinkyVerts[tieUnpackHeader.dinkyVertexCount];
            TieFatVertex fatVerts[tieUnpackHeader.fatVertexCount];
            // align 0x10
            u8 dinkyNormalIndices[tieUnpackHeader.dinkyVertexCount];
            // align 0x4
            uint8vec4 fatNormalIndices[tieUnpackHeader.fatVertexCount];
            // align 0x10
            u8 dinkyNormalIndices[tieUnpackHeader.dinkyVertexCount];
            // align 0x4
            uint8vec4 fatNormalIndices[tieUnpackHeader.fatVertexCount];
            // align 0x10
            u8 unknown[?];
        }
    */

    let ptr = 0;
    function alignTo(size: number) {
        if (ptr % size !== 0) {
            ptr += size - (ptr % size);
        }
    }

    const AD_GIFS = 4;
    const adGifDestOffsets = view.getArrayOfNumbers(ptr, AD_GIFS, Int32Array);
    ptr += AD_GIFS * 0x4;
    const adGifSrcOffsets = view.getArrayOfNumbers(ptr, AD_GIFS, Int32Array)
    ptr += AD_GIFS * 0x4;

    const tieUnpackHeader = readTieUnpackHeader(view.subview(ptr));
    ptr += SIZEOF_TIE_UNPACK_HEADER;

    const tieStrips = view.subdivide(ptr, tieUnpackHeader.stripCount, SIZEOF_TIE_STRIP).map(readTieStrip);
    ptr += tieUnpackHeader.stripCount * SIZEOF_TIE_STRIP;

    // dinky verts
    alignTo(0x10);
    const dinkyVertexCount = tieUnpackHeader.dinkyVertexCount;
    const dinkyVerts = view.subdivide(ptr, dinkyVertexCount, SIZEOF_TIE_DINKY_VERTEX).map(readTieDinkyVertex);
    ptr += dinkyVertexCount * SIZEOF_TIE_DINKY_VERTEX;

    // fat verts
    const fatVertexCount = tieUnpackHeader.fatVertexCount;
    const fatVerts = view.subdivide(ptr, fatVertexCount, SIZEOF_TIE_FAT_VERTEX).map(readTieFatVertex);
    ptr += fatVertexCount * SIZEOF_TIE_FAT_VERTEX;

    // indices into the tie's normal array
    alignTo(0x10);
    const dinkyNormalIndices = view.subdivide(ptr, tieUnpackHeader.dinkyVertexCount, 0x1).map(view => view.getUint8(0));
    ptr += tieUnpackHeader.dinkyVertexCount * 0x1;
    alignTo(0x4);
    const fatNormalIndices = view.subdivide(ptr, tieUnpackHeader.fatVertexCount, 0x4).map(view => view.getUint8_Xyz(0));
    ptr += tieUnpackHeader.fatVertexCount * 0x4;

    // no idea what these are
    alignTo(0x10);
    const unknownBuffer2A = view.subdivide(ptr, tieUnpackHeader.dinkyVertexCount, 0x1).map(view => view.getUint8(0));
    ptr += tieUnpackHeader.dinkyVertexCount * 0x1;
    alignTo(0x4);
    const unknownBuffer2B = view.subdivide(ptr, tieUnpackHeader.fatVertexCount, 0x4).map(view => view.getUint8_Xyzw(0));
    ptr += tieUnpackHeader.fatVertexCount * 0x4;

    // there's one more array of bytes after this but not sure what it is or what its length is (usually 50-60 bytes)
    alignTo(0x10);

    // build command buffer
    let bufferEnd = 0;
    const MAX_BUFFER_SIZE = 0x100; // the max size seems to be ~185 so I'll use 256 to be safe
    const imaginaryGpuCommandBuffer: (TiePacketCommand | null)[] = Array(MAX_BUFFER_SIZE).fill(null);

    function writeCommand(offset: number, type: typeof TiePacketCommandTypes.PRIMITIVE_RESET, value: TieStrip): void;
    function writeCommand(offset: number, type: typeof TiePacketCommandTypes.SET_MATERIAL, value: number): void;
    function writeCommand(offset: number, type: typeof TiePacketCommandTypes.VERTEX, value: { vertex: TieVertex, normalIndex: number }): void;
    function writeCommand(offset: number, type: TiePacketCommand["type"], value: any) {
        if (offset >= MAX_BUFFER_SIZE) {
            throw new Error(`Command buffer exceeds max size`);
        }
        if (type !== TiePacketCommandTypes.VERTEX && imaginaryGpuCommandBuffer[offset]) {
            // vertex commands are allowed to be overwritten, other commands are not
            throw new Error(`Expected commnad buffer slot 0x${offset.toString(16)} to be empty`);
        }
        if (type === TiePacketCommandTypes.SET_MATERIAL && !Number.isInteger(value)) {
            throw new Error(`Material ID is not an integer`);
        }
        const size = TieCommandSizes[type];
        imaginaryGpuCommandBuffer[offset] = { type, size, value };
        bufferEnd = Math.max(bufferEnd, offset + size);
    }

    // first command always sets the material to the first material
    writeCommand(0, TiePacketCommandTypes.SET_MATERIAL, adGifSrcOffsets[0] / SIZEOF_TIE_AD_GIFS);

    // Write verts into command buffer
    // Some are written twice.
    for (let i = 0; i < dinkyVerts.length; i++) {
        const vertex = dinkyVerts[i];
        const normalIndex = dinkyNormalIndices[i];
        writeCommand(vertex.gsPacketWriteOffset, TiePacketCommandTypes.VERTEX, { vertex, normalIndex });
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            writeCommand(vertex.gsPacketWriteOffset2, TiePacketCommandTypes.VERTEX, { vertex, normalIndex });
        }
    }
    for (let i = 0; i < fatVerts.length; i++) {
        const vertex = fatVerts[i];
        const normalIndex = fatNormalIndices[i].x; // all 3 components are normal indices, not sure why there are 3, maybe to do with lod morphing
        writeCommand(vertex.gsPacketWriteOffset, TiePacketCommandTypes.VERTEX, { vertex, normalIndex });
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            writeCommand(vertex.gsPacketWriteOffset2, TiePacketCommandTypes.VERTEX, { vertex, normalIndex });
        }
    }

    // Write primative reset commands
    for (const strip of tieStrips) {
        writeCommand(strip.gifTagOffset, TiePacketCommandTypes.PRIMITIVE_RESET, strip);
    }

    // Write material change commands
    for (let i = 0; i < AD_GIFS - 1; i++) {
        const destAddr = adGifDestOffsets[i];
        if (destAddr === 0) continue; // unused slot
        // destOffset[i] corresponds to srcOffset[i+1] because the first destOffset is for the first material which is implicit
        const materialId = adGifSrcOffsets[i + 1] / SIZEOF_TIE_AD_GIFS;
        writeCommand(destAddr, TiePacketCommandTypes.SET_MATERIAL, materialId);
    }

    if (IS_DEVELOPMENT) {
        // validate
        let expectedEmptySlots = 0;
        let expectPrimativeRestart = true;
        imaginaryGpuCommandBuffer.length = bufferEnd;
        for (let i = 0; i < imaginaryGpuCommandBuffer.length; i++) {
            const command = imaginaryGpuCommandBuffer[i];
            if (command) {
                if (expectedEmptySlots !== 0) {
                    throw new Error(`Didn't expect a write to GPU command buffer at offset 0x${i.toString(16)}`);
                }
                if (command.type === TiePacketCommandTypes.VERTEX && expectPrimativeRestart) {
                    throw new Error(`Expected a primative restart command before first vertex`);
                }
                if (command.type === TiePacketCommandTypes.PRIMITIVE_RESET) {
                    expectPrimativeRestart = false;
                }
                if (command.type === TiePacketCommandTypes.SET_MATERIAL) {
                    expectPrimativeRestart = true;
                }
                expectedEmptySlots += command.size;
            } else {
                if (expectedEmptySlots === 0) {
                    throw new Error(`Expected a write to GPU command buffer at offset 0x${i.toString(16)}`);
                }
            }
            expectedEmptySlots--;
        }
    }

    const filteredCommandBuffer = imaginaryGpuCommandBuffer.filter((c) => !!c);

    return {
        debugData: {
            adGifDestOffsets,
            adGifSrcOffsets,
            tieUnpackHeader,
            tieStrips,
            dinkyVertexCount,
            dinkyVerts,
            fatVerts,
            dinkyNormalIndices,
            fatNormalIndices,
            unknownBuffer2A,
            unknownBuffer2B,
        },
        commandBuffer: filteredCommandBuffer,
    }
}

export const SIZEOF_TIE_UNPACK_HEADER = 0xc;
export type TieUnpackHeader = ReturnType<typeof readTieUnpackHeader>;
export function readTieUnpackHeader(view: DataViewExt) {
    /*
        packed_struct(TieUnpackHeader,
            // 0x00
            u8 unknown_0;
            // 0x01
            u8 unknown_2;
            // 0x02
            u8 unknown_4;
            // 0x03
            u8 strip_count;
            // 0x04
            u8 unknown_8;
            // 0x05
            u8 unknown_a;
            // 0x06
            u8 unknown_c;
            // 0x07
            u8 unknown_e;
            // 0x08
            u8 dinky_vertices_size_plus_four_over_two;
            // 0x09
            u8 fat_vertices_size_plus_four_over_two;
            // 0x0a
            u8 dinky_vertex_count;
            // 0x0b
            u8 fat_vertex_count;
        )
    */

    return {
        unknown0: view.getUint8(0x0),
        unknown1: view.getUint8(0x1),
        unknown2: view.getUint8(0x2),
        stripCount: view.getUint8(0x3),
        unknown4: view.getUint8(0x4),
        unknown5: view.getUint8(0x5),
        unknown6: view.getUint8(0x6),
        unknown7: view.getUint8(0x7),
        dinkyVerticesSizePlusFourOverTwo: view.getUint8(0x8),
        fatVerticesSizePlusFourOverTwo: view.getUint8(0x9),
        dinkyVertexCount: view.getUint8(0xa),
        fatVertexCount: view.getUint8(0xb),
    };
}

export const SIZEOF_TIE_STRIP = 0x4;
export type TieStrip = ReturnType<typeof readTieStrip>;
export function readTieStrip(view: DataViewExt) {
    /*
        packed_struct(TieStrip,
            // 0x00
            u8 vertex_count;
            // 0x01
            u8 pad_1;
            // 0x02
            u8 gif_tag_offset;
            // 0x03
            u8 rc34_winding_order;
        )
    */

    return {
        vertexCount: view.getUint8(0x0),
        gifTagOffset: view.getUint8(0x2),
        windingOrder: view.getUint8(0x1),
    };
}

export type TieVertex = {
    gsPacketWriteOffset: number,
    gsPacketWriteOffset2: number,
    x: number,
    y: number,
    z: number,
    s: number,
    t: number,
    q: number,
    lodMorphOffsetX: number,
    lodMorphOffsetY: number,
    lodMorphOffsetZ: number,
}

export const SIZEOF_TIE_DINKY_VERTEX = 0x10;
export function readTieDinkyVertex(view: DataViewExt): TieVertex {
    /*
        packed_struct(TieDinkyVertex,
            // 0x00
            s16 x;
            // 0x02
            s16 y;
            // 0x04
            s16 z;
            // 0x06
            u16 gs_packet_write_ofs;
            // 0x08
            u16 s;
            // 0x0a
            u16 t;
            // 0x0c
            u16 q;
            // 0x0e
            u16 gs_packet_write_ofs_2;
        )
    */

    return {
        gsPacketWriteOffset: view.getUint16(0x6), // fields out of order for consistency with other vertex type
        gsPacketWriteOffset2: view.getUint16(0xe),
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        s: view.getUint16(0x8),
        t: view.getUint16(0xa),
        q: view.getUint16(0xc),
        lodMorphOffsetX: 0,
        lodMorphOffsetY: 0,
        lodMorphOffsetZ: 0,
    };
}

export const SIZEOF_TIE_FAT_VERTEX = 0x18;
export function readTieFatVertex(view: DataViewExt): TieVertex {
    /*
        packed_struct(TieFatVertex,
            // 0x00
            u16 unknown_0;
            // 0x02
            u16 unknown_2;
            // 0x04
            u16 unknown_4;
            // 0x06
            u16 gs_packet_write_ofs;
            // 0x08
            s16 x;
            // 0x0a
            s16 y;
            // 0x0c
            s16 z;
            // 0x0e
            u16 pad_e;
            // 0x10
            u16 s;
            // 0x12
            u16 t;
            // 0x14
            u16 q;
            // 0x16
            u16 gs_packet_write_ofs_2;
        )
    */

    return {
        gsPacketWriteOffset: view.getUint16(0x6), // fields out of order for consistency with other vertex type
        gsPacketWriteOffset2: view.getUint16(0x16),
        x: view.getInt16(0x8),
        y: view.getInt16(0xa),
        z: view.getInt16(0xc),
        s: view.getUint16(0x10),
        t: view.getUint16(0x12),
        q: view.getUint16(0x14),
        lodMorphOffsetX: view.getInt16(0x0),
        lodMorphOffsetY: view.getInt16(0x2),
        lodMorphOffsetZ: view.getInt16(0x4),
    };
}

export type GifAdData = ReturnType<typeof readGifAdData12>;
export function readGifAdData12(view: DataViewExt) {
    /*  
        packed_struct(GifAdData12,
            // 0x0
            s32 data_lo;
            // 0x4
            s32 data_hi;
            // 0x8
            u8 address;
            // 0x9
            u8 pad[3];
        )
    */
    return {
        low: view.getInt32(0x0),
        high: view.getInt32(0x4),
        address: view.getUint8(0x8),
    }
}

export function readGifAdData16(view: DataViewExt) {
    /*
        // size 0x10
        packed_struct(GifAdData16,
            // 0x0
            s32 data_lo;
            // 0x4
            s32 data_hi;
            // 0x8
            u8 address;
            // 0x9
            u8 pad[7];
        )
    */
    return readGifAdData12(view);
}

export type TieAdGifs = ReturnType<typeof readTieAdGifs>;
export const SIZEOF_TIE_AD_GIFS = 0x50;
export function readTieAdGifs(view: DataViewExt) {
    /*
        // size 0x50
        packed_struct(TieAdGifs,
            // 0x00
            GifAdData16 d1_tex0_1;
            // 0x10
            GifAdData16 d2_tex1_1;
            // 0x20
            GifAdData16 d3_miptbp1_1;
            // 0x30
            GifAdData16 d4_clamp_1;
            // 0x40
            GifAdData16 d5_miptbp2_1;
        )
    */
    return {
        tex0: readGifAdData16(view.subview(0x0)),
        tex1: readGifAdData16(view.subview(0x10)),
        miptbp1: readGifAdData16(view.subview(0x20)),
        clamp: readGifAdData16(view.subview(0x30)),
        miptbp2: readGifAdData16(view.subview(0x40)),
    }
}

export const SIZEOF_TFRAG_BLOCK_HEADER = 0x10;
export type TfragBlockHeader = ReturnType<typeof readTfragBlockHeader>;
export function readTfragBlockHeader(view: DataViewExt) {
    /*
        packed_struct(TfragBlockHeader,
            // 0x0
            s32 table_offset;
            // 0x4
            s32 tfrag_count;
            // 0x8
            f32 thingy;
            // 0xc
            u32 mysterious_second_thingy;
        )
    */

    return {
        tableOffset: view.getInt32(0x0),
        tfragCount: view.getInt32(0x4),
    }
}

export const SIZEOF_TFRAG_HEADER = 0x40;
export type TfragHeader = ReturnType<typeof readTfragHeader>;
export function readTfragHeader(view: DataViewExt) {
    /*
        packed_struct(TfragHeader,
            // 0x00
            Vec4f bsphere;
            // 0x10
            s32 data;
            // 0x14
            u16 lod_2_ofs;
            // 0x16
            u16 shared_ofs;
            // 0x18
            u16 lod_1_ofs;
            // 0x1a
            u16 lod_0_ofs;
            // 0x1c
            u16 tex_ofs;
            // 0x1e
            u16 rgba_ofs;
            // 0x20
            u8 common_size;
            // 0x21
            u8 lod_2_size;
            // 0x22
            u8 lod_1_size;
            // 0x23
            u8 lod_0_size;
            // 0x24
            u8 lod_2_rgba_count;
            // 0x25
            u8 lod_1_rgba_count;
            // 0x26
            u8 lod_0_rgba_count;
            // 0x27
            u8 base_only;
            // 0x28
            u8 texture_count;
            // 0x29
            u8 rgba_size;
            // 0x2a
            u8 rgba_verts_loc;
            // 0x2b
            u8 occl_index_stash;
            // 0x2c
            u8 msphere_count;
            // 0x2d
            u8 flags;
            // 0x2e
            u16 msphere_ofs;
            // 0x30
            u16 light_ofs;
            union(
                // 0x32
                u16 light_end_ofs_rac_gc_uya;
                // 0x32
                u16 light_vert_start_ofs_dl;
            )
            // 0x34
            u8 dir_lights_one;
            // 0x35
            u8 dir_lights_upd;
            // 0x36
            u16 point_lights;
            // 0x38
            u16 cube_ofs;
            // 0x3a
            u16 occl_index;
            // 0x3c
            u8 vert_count;
            // 0x3d
            u8 tri_count;
            // 0x3e
            u16 mip_dist;
        )
    */

    return {
        bsphere: view.getFloat32_Xyzw(0x0),
        data: view.getInt32(0x10),
        lod2Offset: view.getUint16(0x14),
        sharedOffset: view.getUint16(0x16),
        lod1Offset: view.getUint16(0x18),
        lod0Offset: view.getUint16(0x1a),
        texOffset: view.getUint16(0x1c),
        rgbaOffset: view.getUint16(0x1e),
        commonSize: view.getUint8(0x20),
        lod2Size: view.getUint8(0x21),
        lod1Size: view.getUint8(0x22),
        lod0Size: view.getUint8(0x23),
        lod2RgbaCount: view.getUint8(0x24),
        lod1RgbaCount: view.getUint8(0x25),
        lod0RgbaCount: view.getUint8(0x26),
        baseOnly: view.getUint8(0x27),
        textureCount: view.getUint8(0x28),
        rgbaSize: view.getUint8(0x29),
        rgbaVertsLoc: view.getUint8(0x2a),
        occlIndexStash: view.getUint8(0x2b),
        msphereCount: view.getUint8(0x2c),
        flags: view.getUint8(0x2d),
        msphereOfs: view.getUint16(0x2e),
        lightOfs: view.getUint16(0x30),
        lightEndOffset: view.getUint16(0x32), // different in rac4
        dirLightsOne: view.getUint8(0x34),
        dirLightsUpd: view.getUint8(0x35),
        pointLights: view.getUint16(0x36),
        cubeOffset: view.getUint16(0x38),
        occlIndex: view.getUint16(0x3a),
        vertCount: view.getUint8(0x3c),
        triCount: view.getUint8(0x3d),
        mipDist: view.getUint16(0x3e),
    }
}

export const SIZEOF_TFRAG_LIGHT = 0x8;
export type TfragLight = ReturnType<typeof readTfragLight>;
export function readTfragLight(view: DataViewExt) {
    /*
        packed_struct(TfragLight,
            // 0x0
            s8 unknown_0;
            // 0x1
            s8 intensity;
            // 0x2
            s8 azimuth;
            // 0x3
            s8 elevation;
            // 0x4
            s16 color;
            // 0x6
            s16 pad;
        )
    */

    return {
        unknown0: view.getUint16(0x0), // looks like a write address. Between 300 and 1400, always increases, usually by 6 at a time, always divisible by 2.
        azimuth: view.getInt8(0x2),
        elevation: view.getInt8(0x3),
        brightness: view.getUint16(0x4), // this looks like light intensity but I don't know why I'd need it
        directionalLights: view.getNibbleArray(0x6, 2), // this is list of indices into the directional light array
    }
}

export type Tfrag = ReturnType<typeof readTfrag>;
export function readTfrag(view: DataViewExt, header: TfragHeader) {
    const rgbas = view.subdivide(header.rgbaOffset, header.rgbaSize * 4, 0x4).map(view => view.getUint8_Rgba(0));
    const lights = view.subdivide(header.lightOfs + 0x10, header.vertCount, SIZEOF_TFRAG_LIGHT).map(readTfragLight);

    /*
    Lod2
    */

    const lod2Buffer = view.subview(header.lod2Offset, header.sharedOffset - header.lod2Offset);
    const lod2CommandList = readVifCommandList(lod2Buffer);
    const lod2CommandListUnpacks = lod2CommandList.filter(cmd => isUnpackCommand(cmd.cmd));
    if (lod2CommandListUnpacks.length !== 2) {
        throw new Error(`Incorrect number of LOD 2 VIF unpacks`);
    }
    const lod2Indices = {
        data: readVifUnpackData(lod2CommandListUnpacks[0]).getTypedArrayView(Uint8Array),
        addr: lod2CommandListUnpacks[0].unpack!.addr,
    };
    const lod2Strips = {
        data: readVifUnpackData(lod2CommandListUnpacks[1]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_STRIP).map(readTfragStrip),
        addr: lod2CommandListUnpacks[1].unpack!.addr,
    };


    /*
    Common
    */

    const commonBuffer = view.subview(header.sharedOffset, header.lod1Offset - header.sharedOffset);
    const commonCommandList = readVifCommandList(commonBuffer);
    if (commonCommandList.length <= 5) {
        throw new Error(`Too few shared VIF commands`);
    }
    const basePosition = readVifStrowData(commonCommandList[5]);
    const commonCommandListUnpacks = commonCommandList.filter(cmd => isUnpackCommand(cmd.cmd));
    if (commonCommandListUnpacks.length !== 4) {
        throw new Error(`Incorrect number of shared VIF unpacks`);
    }
    const commonVuHeader = {
        data: readTfragHeaderUnpack(readVifUnpackData(commonCommandListUnpacks[0])),
        addr: commonCommandListUnpacks[0].unpack!.addr,
    };
    const commonTextures = {
        data: readVifUnpackData(commonCommandListUnpacks[1]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_AD_GIFS).map(readTfragAdGifs),
        addr: commonCommandListUnpacks[1].unpack!.addr,
    };
    const commonVertexInfo = {
        data: readVifUnpackData(commonCommandListUnpacks[2]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_VERTEX_INFO).map(readTfragVertexInfo),
        addr: commonCommandListUnpacks[2].unpack!.addr,
    };
    const commonPositions = {
        data: readVifUnpackData(commonCommandListUnpacks[3]).subdivide(0, 0xFFFF, 0x6).map(view => view.getInt16_Xyz(0)),
        addr: commonCommandListUnpacks[3].unpack!.addr,
    };
    if (commonVuHeader.data.positionsCommonCount !== commonPositions.data.length) {
        throw new Error(`Positions count doesn't match header`);
    }

    /*
    Lod1
    */

    const lod1Buffer = view.subview(header.lod1Offset, header.lod0Offset - header.lod1Offset);
    const lod1CommandList = readVifCommandList(lod1Buffer);
    const lod1CommandListUnpacks = lod1CommandList.filter(cmd => isUnpackCommand(cmd.cmd));

    if (lod1CommandListUnpacks.length !== 2) {
        throw new Error(`Incorrect number of LOD 1 VIF unpacks`);
    }

    const lod1Strips = {
        data: readVifUnpackData(lod1CommandListUnpacks[0]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_STRIP).map(readTfragStrip),
        addr: lod1CommandListUnpacks[0].unpack!.addr,
    };
    const lod1Indices = {
        data: readVifUnpackData(lod1CommandListUnpacks[1]).getTypedArrayView(Uint8Array),
        addr: lod1CommandListUnpacks[1].unpack!.addr,
    };

    /*
    Lod 1 and 0 shared
    */

    const lod01Buffer = view.subview(header.lod0Offset, header.sharedOffset + header.lod1Size * 0x10 - header.lod0Offset);
    const lod01CommandList = readVifCommandList(lod01Buffer);
    const lod01CommandListUnpacks = lod01CommandList.filter(cmd => isUnpackCommand(cmd.cmd));

    let lod01Positions: { data: { x: number, y: number, z: number }[]; addr: number } | null = null;
    let lod01VertexInfo: { data: TfragVertexInfo[]; addr: number } | null = null;
    {
        let i = 0;
        if (i < lod01CommandListUnpacks.length && lod01CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8 && commonVuHeader.data.positionsLod01Count > 0) {
            // don't care
            i++;
        }

        if (i < lod01CommandListUnpacks.length && lod01CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8 && lod01CommandListUnpacks[i].unpack!.addr) {
            // don't care
            i++;
        }

        if (i < lod01CommandListUnpacks.length && lod01CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_16) {
            lod01VertexInfo = {
                data: readVifUnpackData(lod01CommandListUnpacks[i]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_VERTEX_INFO).map(readTfragVertexInfo),
                addr: lod01CommandListUnpacks[i].unpack!.addr,
            };
            i++;
        }

        if (i < lod01CommandListUnpacks.length && lod01CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V3_16) {
            lod01Positions = {
                data: readVifUnpackData(lod01CommandListUnpacks[i]).subdivide(0, 0xFFFF, 0x6).map(view => view.getInt16_Xyz(0)),
                addr: lod01CommandListUnpacks[i].unpack!.addr,
            };
            if (lod01Positions.data.length !== commonVuHeader.data.positionsLod01Count) {
                throw new Error(`LOD 01 positions count doesn't match expected count`);
            }
            i++;
        }
    }

    /*
    Lod0
    */

    const lod0Buffer = view.subview(
        header.sharedOffset + header.lod1Size * 0x10,
        header.rgbaOffset - (header.lod1Size + header.lod2Size - header.commonSize) * 0x10
    );
    const lod0CommandList = readVifCommandList(lod0Buffer);
    const lod0CommandListUnpacks = lod0CommandList.filter(cmd => isUnpackCommand(cmd.cmd));

    let i = 0;
    let lod0Positions: { data: { x: number, y: number, z: number }[]; addr: number } | null = null;
    let lod0Strips: { data: TfragStrip[]; addr: number } | null = null;
    let lod0Indices: { data: Uint8Array; addr: number } | null = null;
    let lod0VertexInfo: { data: TfragVertexInfo[]; addr: number } | null = null;
    {
        if (i < lod0CommandListUnpacks.length && lod0CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V3_16) {
            lod0Positions = {
                data: readVifUnpackData(lod0CommandListUnpacks[i]).subdivide(0, 0xFFFF, 0x6).map(view => view.getInt16_Xyz(0)),
                addr: lod0CommandListUnpacks[i].unpack!.addr,
            };
            if (lod0Positions.data.length !== commonVuHeader.data.positionsLod0Count) {
                throw new Error(`LOD 0 positions count doesn't match expected count`);
            }
            i++;
        }

        if (i >= lod0CommandListUnpacks.length) {
            throw new Error(`Too few LOD 0 VIF unpacks`);
        }

        lod0Strips = {
            data: readVifUnpackData(lod0CommandListUnpacks[i]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_STRIP).map(readTfragStrip),
            addr: lod0CommandListUnpacks[i].unpack!.addr,
        };
        i++;

        if (i >= lod0CommandListUnpacks.length) {
            throw new Error(`Too few LOD 0 VIF unpacks`);
        }

        lod0Indices = {
            data: readVifUnpackData(lod0CommandListUnpacks[i]).getTypedArrayView(Uint8Array),
            addr: lod0CommandListUnpacks[i].unpack!.addr,
        };
        i++;

        if (i < lod0CommandListUnpacks.length && lod0CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8 && commonVuHeader.data.positionsLod0Count > 0) {
            // don't care
            i++;
        }

        if (i < lod0CommandListUnpacks.length && lod0CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8) {
            // don't care
            i++;
        }

        if (i < lod0CommandListUnpacks.length && lod0CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_16) {
            lod0VertexInfo = {
                data: readVifUnpackData(lod0CommandListUnpacks[i]).subdivide(0, 0xFFFF, SIZEOF_TFRAG_VERTEX_INFO).map(readTfragVertexInfo),
                addr: lod0CommandListUnpacks[i].unpack!.addr,
            };
            i++;
        }

    }

    validateTfrag(lod2Indices.data, lod2Strips.data, commonVertexInfo.data, commonPositions.data);
    validateTfrag(lod1Indices.data, lod1Strips.data, [...commonVertexInfo.data, ...(lod01VertexInfo?.data ?? [])], [...commonPositions.data, ...(lod01Positions?.data ?? [])]);
    validateTfrag(lod0Indices.data, lod0Strips.data, [...commonVertexInfo.data, ...(lod01VertexInfo?.data ?? []), ...(lod0VertexInfo?.data ?? [])], [...commonPositions.data, ...(lod01Positions?.data ?? []), ...(lod0Positions?.data ?? [])]);

    return {
        lights,
        rgbas,
        lod2Indices,
        lod2Strips,
        basePosition,
        commonVuHeader,
        commonTextures,
        commonVertexInfo,
        commonPositions,
        lod1Indices,
        lod1Strips,
        lod01Positions,
        lod01VertexInfo,
        lod0Positions,
        lod0Strips,
        lod0Indices,
        lod0VertexInfo,
    };
}

function validateTfrag(indices: Uint8Array, strips: TfragStrip[], vertexInfo: TfragVertexInfo[], positions: { x: number, y: number, z: number }[]) {
    let stripPtr = 0;
    let vertexPtr = 0;

    outer: while (true) {
        const strip = strips[stripPtr];
        if (!strip) {
            throw new Error(`Overran strip list`);
        }
        switch (strip.endOfPacketFlag) {
            case -128:
                // last strip of packet
                break;
            case -1:
                // end
                break outer;
            case 0:
                // normal strip
                break;
            default:
                throw new Error(`Invalid strip flags`);
        }
        let vertexCount = strip.vertexCountAndFlag; // flag means change material
        if (vertexCount <= 0) {
            if (strip.adGifOffset >= 0) {
                // this would update the material
            }
            vertexCount += 128;
        }

        if (vertexCount) {
            for (let i = 0; i < vertexCount; i++) {
                const index = indices[vertexPtr];
                const info = vertexInfo[index];
                if (!info) {
                    throw new Error(`Overran vertex info list`);
                }
                if (info.vertex % 2 !== 0) {
                    throw new Error(`Vertex index not divisible by 2`);
                }
                if (info.parent % 2 !== 0) {
                    throw new Error(`Vertex index not divisible by 2`);
                }
                const position = positions[info.vertex / 2];
                if (!position) {
                    throw new Error(`Overran vertex positions list`);
                }
                if (info.parent !== 4096) {
                    const parent = positions[info.parent / 2];
                    if (!parent) {
                        throw new Error(`Overran vertex positions list for parent`);
                    }
                }
                vertexPtr++;
            }
        }

        stripPtr++;
    }
}

export const SIZEOF_TFRAG_HEADER_UNPACK = 0x28;
export type TfragHeaderUnpack = ReturnType<typeof readTfragHeaderUnpack>;
export function readTfragHeaderUnpack(view: DataViewExt) {
    /* 
        packed struct TfragHeaderUnpack {
            // 0x00
            u16 positions_common_count;
            // 0x02
            u16 unknown_2;
            // 0x04
            u16 positions_lod_01_count;
            // 0x06
            u16 unknown_6;
            // 0x08
            u16 positions_lod_0_count;
            // 0x0a
            u16 unknown_a;
            // 0x0c
            u16 positions_common_addr;
            // 0x0e
            u16 vertex_info_common_addr;
            // 0x10
            u16 unknown_10;
            // 0x12
            u16 vertex_info_lod_01_addr; // Only the LOD 01 and LOD 0 entries have vertex_data_offsets[0] populated.
            // 0x14
            u16 unknown_14;
            // 0x16
            u16 vertex_info_lod_0_addr;
            // 0x18
            u16 unknown_18;
            // 0x1a
            u16 indices_addr;
            // 0x1c
            u16 parent_indices_lod_01_addr;
            // 0x1e
            u16 unk_indices_2_lod_01_addr;
            // 0x20
            u16 parent_indices_lod_0_addr;
            // 0x22
            u16 unk_indices_2_lod_0_addr;
            // 0x24
            u16 strips_addr;
            // 0x26
            u16 texture_ad_gifs_addr;
        }
    */

    return {
        positionsCommonCount: view.getUint16(0x0),
        positionsLod01Count: view.getUint16(0x4),
        positionsLod0Count: view.getUint16(0x8),
        positionsCommonAddr: view.getUint16(0xc),
        vertexInfoCommonAddr: view.getUint16(0xe),
        vertexInfoLod01Addr: view.getUint16(0x12),
        vertexInfoLod0Addr: view.getUint16(0x16),
        indicesAddr: view.getUint16(0x1a),
        parentIndicesLod01Addr: view.getUint16(0x1c),
        parentIndicesLod0Addr: view.getUint16(0x20),
        stripsAddr: view.getUint16(0x24),
        textureAdGifsAddr: view.getUint16(0x26),
    }
}

export const SIZEOF_TFRAG_AD_GIFS = 0x50;
export type TfragAdGifs = ReturnType<typeof readTfragAdGifs>;
export function readTfragAdGifs(view: DataViewExt) {
    /*
        // this is the same as the TieAdGifs version, except the order of the fields is different
        // size 0x50
        packed_struct(TfragAdGifs,
            // 0x00
            GifAdData16 d1_tex0_1;
            // 0x10
            GifAdData16 d2_tex1_1;
            // 0x20
            GifAdData16 d3_clamp_1;
            // 0x30
            GifAdData16 d4_miptbp1_1;
            // 0x40
            GifAdData16 d5_miptbp2_1;
        )
    */
    return {
        tex0: readGifAdData16(view.subview(0x0)),
        tex1: readGifAdData16(view.subview(0x10)),
        clamp: readGifAdData16(view.subview(0x20)),
        miptbp1: readGifAdData16(view.subview(0x30)),
        miptbp2: readGifAdData16(view.subview(0x40)),
    }
}

export type TfragVertexInfo = ReturnType<typeof readTfragVertexInfo>;
export const SIZEOF_TFRAG_VERTEX_INFO = 0x8;
export function readTfragVertexInfo(view: DataViewExt) {
    /*
        packed_struct(TfragVertexInfo,
            // 0x00
            s16 s;
            // 0x02
            s16 t;
            // 0x04
            s16 parent;
            // 0x04
            s16 vertex;
        )
    */

    // divide negative texcoords by 2 for reasons that I cannot possibly imagine
    function fixTexcoord(value: number) {
        return value < 0 ? value / 2 : value;
    }

    return {
        s: fixTexcoord(view.getInt16(0x0)),
        t: fixTexcoord(view.getInt16(0x2)),
        parent: view.getInt16(0x4),
        vertex: view.getInt16(0x6),
    };
}

export type TfragStrip = ReturnType<typeof readTfragStrip>;
export const SIZEOF_TFRAG_STRIP = 0x4;
export function readTfragStrip(view: DataViewExt) {
    /*
        packed_struct(TfragStrip,
            // 0x00
            s8 vertex_count_and_flag;
            // 0x01
            s8 end_of_packet_flag;
            // 0x02
            s8 ad_gif_offset;
            // 0x03
            s8 pad;
        )
    */
    return {
        vertexCount: view.getInt8(0x0) & 0x7f,
        flag: getBit(view.getInt8(0x0), 7),
        vertexCountAndFlag: view.getInt8(0x0),
        endOfPacketFlag: view.getInt8(0x1),
        adGifOffset: view.getInt8(0x2),
    }
}

export const SIZEOF_SHRUB_CLASS_HEADER = 0x40;
export function readShrubClassHeader(view: DataViewExt) {
    /*
    packed_struct(ShrubClassHeader,
        // 0x00
        Vec4f bounding_sphere;
        // 0x10
        f32 mip_distance;
        // 0x14
        u16 mode_bits;
        // 0x16
        s16 instance_count;
        // 0x18
        s32 instances_pointer;
        // 0x1c
        s32 billboard_offset;
        // 0x20
        f32 scale;
        // 0x24
        s16 o_class;
        // 0x26
        s16 s_class;
        // 0x28
        s16 packet_count;
        // 0x2a
        s16 pad_2a;
        // 0x2c
        s32 normals_offset;
        // 0x30
        s32 pad_30;
        // 0x34
        s16 drawn_count;
        // 0x36
        s16 scis_count;
        // 0x38
        s16 billboard_count;
        // 0x3a
        s16 pad_3a[3];
    )
    */
    return {
        boundingSphere: view.getFloat32_Xyzw(0x0),
        mipDistance: view.getFloat32(0x10),
        modeBits: view.getUint16(0x14),
        instanceCount: view.getInt16(0x16),
        instancesPointer: view.getInt32(0x18),
        billboardOffset: view.getInt32(0x1c),
        scale: view.getFloat32(0x20),
        oClass: view.getInt16(0x24),
        sClass: view.getInt16(0x26),
        packetCount: view.getInt16(0x28),
        normalsOffset: view.getInt32(0x2c),
        drawnCount: view.getInt16(0x34),
        scisCount: view.getInt16(0x36),
        billboardCount: view.getInt16(0x38),
    }
}

export const SIZEOF_SHRUB_VERTEX_PART1 = 0x8;
export type ShrubVertexPart1 = ReturnType<typeof readShrubVertexPart1>;
export function readShrubVertexPart1(view: DataViewExt) {
    /*
        packed_struct(ShrubVertexPart1,
            // 0x00
            s16 x;
            // 0x02
            s16 y;
            // 0x04
            s16 z;
            // 0x06
            s16 gs_packet_offset;
        )
    */
    return {
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        gsPacketOffset: view.getInt16(0x6),
    };
}

export const SIZEOF_SHRUB_VERTEX_PART2 = 0x8;
export type ShrubVertexPart2 = ReturnType<typeof readShrubVertexPart2>;
export function readShrubVertexPart2(view: DataViewExt) {
    /*
        packed_struct(ShrubVertexPart2,
            // 0x00
            s16 s;
            // 0x02
            s16 t;
            // 0x04
            s16 h;
            // 0x06
            s16 n_and_stop_cond; // If this is negative the strip ends.
        )
    */
    return {
        s: view.getInt16(0x0),
        t: view.getInt16(0x2),
        h: view.getInt16(0x4),
        nAndStopCond: view.getInt16(0x6),
    };
}

export function readShrubPacketHeader(view: DataViewExt) {
    /*
        packed_struct(ShrubPacketHeader,
            // 0x0
            s32 texture_count;
            // 0x4
            s32 gif_tag_count;
            // 0x8
            s32 vertex_count;
            // 0xc
            s32 vertex_offset;
        )
    */
    return {
        textureCount: view.getInt32(0x0),
        gifTagCount: view.getInt32(0x4),
        vertexCount: view.getInt32(0x8),
        vertexOffset: view.getInt32(0xc),
    }
}

export function readShrubVertexGifTag(view: DataViewExt) {
    /*
        packed_struct(ShrubVertexGifTag,
            // 0x0
            GifTag12 tag;
            // 0xc
            s32 gs_packet_offset;
        )
    */
    return {
        tag: readShrubGifTag12(view.subview(0x0)),
        gsPacketOffset: view.getInt32(0xc),
    }
}

export function readShrubGifTag12(view: DataViewExt) {
    /*
        packed_struct(GifTag12,
            // 0x0
            u64 low;
            // 0x8
            u32 regs;
        )
    */
    return {
        low: view.getUint32(0x0),
        high: view.getUint32(0x4),
        regs: view.getUint32(0x8),
    }
}

export type ShrubTexturePrimitive = ReturnType<typeof readShrubTexturePrimitive>;
export const SIZEOF_SHRUB_TEXTURE_PRIMITIVE = 0x40;
export function readShrubTexturePrimitive(view: DataViewExt) {
    /*
        packed_struct(ShrubTexturePrimitive,
            // 0x00
            GifAdData12 d1_tex1_1;
            // 0x0c
            s32 gs_packet_offset;
            // 0x10
            GifAdData16 d2_clamp_1;
            // 0x20
            GifAdData16 d3_miptbp1_1;
            // 0x30
            GifAdData16 d4_tex0_1;
        )
    */
    return {
        tex1: readGifAdData12(view.subview(0x0)),
        gsPacketOffset: view.getInt32(0xc),
        clamp: readGifAdData16(view.subview(0x10)),
        miptbp1: readGifAdData16(view.subview(0x20)),
        tex0: readGifAdData16(view.subview(0x30)),
    }
}

export type ShrubVertex = {
    x: number;
    y: number;
    z: number;
    s: number;
    t: number;
    h: number; // not sure what h is
    n: number;
    stop: number;
}

export enum ShrubPacketCommandTypes {
    PRIMITIVE = 1,
    SET_MATERIAL = 2,
    VERTEX = 3,
}

export type ShrubPacketCommand = {
    type: typeof ShrubPacketCommandTypes.PRIMITIVE,
    size: number,
    value: {
        type: GsPrimitiveType,
    }
} | {
    type: typeof ShrubPacketCommandTypes.SET_MATERIAL,
    size: number,
    value: { adGif: ShrubTexturePrimitive },
} | {
    type: typeof ShrubPacketCommandTypes.VERTEX,
    size: number,
    value: ShrubVertex
};

const ShrubCommandSize = {
    [ShrubPacketCommandTypes.PRIMITIVE]: 1,
    [ShrubPacketCommandTypes.SET_MATERIAL]: 5,
    [ShrubPacketCommandTypes.VERTEX]: 3,
}

export function readShrubPacket(view: DataViewExt) {
    const commands = readVifCommandList(view);
    const unpackCommands = commands.filter(cmd => isUnpackCommand(cmd.cmd));
    if (unpackCommands.length !== 3) {
        throw new Error(`Expected 3 UNPACK commands in a shrub packet`);
    }

    const unpack0 = readVifUnpackData(unpackCommands[0]);
    const packetHeader = readShrubPacketHeader(unpack0);
    const gifTags = unpack0.subdivide(0x10, packetHeader.gifTagCount, 0x10).map(readShrubVertexGifTag);
    const adGifs = unpack0.subdivide(0x10 + packetHeader.gifTagCount * 0x10, packetHeader.textureCount, SIZEOF_SHRUB_TEXTURE_PRIMITIVE).map(readShrubTexturePrimitive);

    const unpack1 = readVifUnpackData(unpackCommands[1]);
    const part1 = unpack1.subdivide(0, 0xFFFF, SIZEOF_SHRUB_VERTEX_PART1).map(readShrubVertexPart1);

    const unpack2 = readVifUnpackData(unpackCommands[2]);
    const part2 = unpack2.subdivide(0, 0xFFFF, SIZEOF_SHRUB_VERTEX_PART2).map(readShrubVertexPart2);

    let bufferEnd = 0;
    const MAX_BUFFER_SIZE = 0x100;
    const imaginaryGpuCommandBuffer: ShrubPacketCommand[] = new Array(256).fill(null);
    function writeCommand(offset: number, type: typeof ShrubPacketCommandTypes.PRIMITIVE, value: { type: GsPrimitiveType }): void;
    function writeCommand(offset: number, type: typeof ShrubPacketCommandTypes.SET_MATERIAL, value: { adGif: ShrubTexturePrimitive }): void;
    function writeCommand(offset: number, type: typeof ShrubPacketCommandTypes.VERTEX, value: ShrubVertex): void;
    function writeCommand(offset: number, type: ShrubPacketCommand["type"], value: any) {
        if (offset >= MAX_BUFFER_SIZE) {
            throw new Error(`Command buffer exceeds max size`);
        }
        if (type !== ShrubPacketCommandTypes.VERTEX && imaginaryGpuCommandBuffer[offset]) {
            // vertex commands are allowed to be overwritten, other commands are not
            throw new Error(`Expected commnad buffer slot 0x${offset.toString(16)} to be empty`);
        }
        const size = ShrubCommandSize[type];
        imaginaryGpuCommandBuffer[offset] = { type, size, value };
        bufferEnd = Math.max(bufferEnd, offset + size);
    }

    for (const gifTag of gifTags) {
        const primRegister = getBits(gifTag.tag.high, 15, 25);
        const primativeType = getBits(primRegister, 0, 2);
        if (primativeType !== GsPrimitiveType.TRIANGLE && primativeType !== GsPrimitiveType.TRIANGLE_STRIP) {
            throw new Error(`Unsupported primitive type ${primativeType} in shrub packet`);
        }
        writeCommand(gifTag.gsPacketOffset, ShrubPacketCommandTypes.PRIMITIVE, { type: primativeType });
    }

    for (const adGif of adGifs) {
        writeCommand(adGif.gsPacketOffset, ShrubPacketCommandTypes.SET_MATERIAL, { adGif });
    }

    for (let i = 0; i < part1.length; i++) {
        writeCommand(part1[i].gsPacketOffset, ShrubPacketCommandTypes.VERTEX, {
            x: part1[i].x,
            y: part1[i].y,
            z: part1[i].z,
            s: part2[i].s,
            t: part2[i].t,
            h: part2[i].h,
            n: part2[i].nAndStopCond & 0x7fff,
            stop: part2[i].nAndStopCond & 0x8000 ? 1 : 0,
        });
    }

    if (IS_DEVELOPMENT) {
        // validate
        let expectedEmptySlots = 0;
        let expectPrimativeRestart = false;
        imaginaryGpuCommandBuffer.length = bufferEnd;
        for (let i = 0; i < imaginaryGpuCommandBuffer.length; i++) {
            const command = imaginaryGpuCommandBuffer[i];
            if (command) {
                if (expectedEmptySlots !== 0) {
                    throw new Error(`Didn't expect a write to GPU command buffer at offset 0x${i.toString(16)}`);
                }
                if (command.type === ShrubPacketCommandTypes.VERTEX && expectPrimativeRestart) {
                    throw new Error(`Expected a primative restart command before first vertex`);
                }
                if (command.type === ShrubPacketCommandTypes.PRIMITIVE) {
                    expectPrimativeRestart = false;
                }
                if (command.type === ShrubPacketCommandTypes.SET_MATERIAL) {
                    expectPrimativeRestart = true;
                }
                expectedEmptySlots += command.size;
            } else {
                if (expectedEmptySlots === 0) {
                    throw new Error(`Expected a write to GPU command buffer at offset 0x${i.toString(16)}`);
                }
            }
            expectedEmptySlots--;
        }
    }

    const filteredCommandBuffer = imaginaryGpuCommandBuffer.filter((c) => !!c);
    return filteredCommandBuffer;
}

export type ShrubClass = ReturnType<typeof readShrubClass>;
export function readShrubClass(view: DataViewExt) {
    const header = readShrubClassHeader(view);

    const packetEntries = view.subdivide(SIZEOF_SHRUB_CLASS_HEADER, header.packetCount, 0x8).map(view => view.getInt32PairAs(0, "offset", "size"));
    const packets = packetEntries.map(entry => view.subview(entry.offset, entry.size)).map(readShrubPacket);
    const normals = view.subdivide(header.normalsOffset, 24, 0x8).map(view => view.getInt16_Xyz(0));

    return {
        header,
        body: {
            packets,
            normals,
        },
    }
}

export type Sky = ReturnType<typeof readSky>;
export function readSky(skyView: DataViewExt) {
    const header = readSkyHeader(skyView);
    const textureEntries = skyView.subdivide(header.textureDefs, header.textureCount, SIZEOF_SKY_TEXTURE_ENTRY).map(readSkyTextureEntry);
    const shells = header.shells.slice(0, header.shellCount).map(offset => readSkyShell(skyView, skyView.subview(offset)));
    return {
        header,
        textureEntries,
        shells,
    }
}

export type SkyShell = {
    header: SkyShellHeader,
    clusters: {
        vertices: SkyVertex[],
        texcoords: SkyTexcoord[],
        rgbas: SkyRgba[],
        triangles: SkyFace[],
    }[],
};
export function readSkyShell(skyView: DataViewExt, skyShellView: DataViewExt) {
    const shellHeader = readSkyShellHeader(skyShellView);
    const skyShells: SkyShell = {
        header: shellHeader,
        clusters: [],
    };

    // skip to 0x10
    const clusterHeaders = skyShellView.subdivide(0x10, shellHeader.clusterCount, SIZEOF_SKY_CLUSTER_HEADER).map(readSkyClusterHeader);
    for (const clusterHeader of clusterHeaders) {
        const dataView = skyView.subview(clusterHeader.data);
        const vertexBuffer = dataView.subview(clusterHeader.vertexOffset);
        const vertices = vertexBuffer.subdivide(0, clusterHeader.vertexCount, SIZEOF_SKY_VERTEX).map(readSkyVertex);
        const texcoordsOrRgbaBuffer = dataView.subview(clusterHeader.stOffset);
        let texcoords: SkyTexcoord[] = [];
        let rgbas: SkyRgba[] = [];
        if (shellHeader.flags.textured) {
            texcoords = texcoordsOrRgbaBuffer.subdivide(0, clusterHeader.stOffset, SIZEOF_SKY_TEXCOORD).map(readSkyTexcoord);
        } else {
            rgbas = texcoordsOrRgbaBuffer.subdivide(0, clusterHeader.stOffset, 4).map(view => view.getUint8_Rgba(0));
        }
        const indicesBuffer = dataView.subview(clusterHeader.triOffset);
        const triangles = indicesBuffer.subdivide(0, clusterHeader.triCount, SIZEOF_SKY_FACE).map(readSkyFace);
        skyShells.clusters.push({
            vertices,
            texcoords,
            rgbas,
            triangles,
        });
    }
    return skyShells;
}

export const SIZEOF_SKY_HEADER = 0x40;
export type SkyHeader = ReturnType<typeof readSkyHeader>;
export function readSkyHeader(view: DataViewExt) {
    /*
        packed_struct(SkyHeader,
            // 0x00
            SkyColour colour;
            // 0x04
            s16 clear_screen;
            // 0x06
            s16 shell_count;
            // 0x08
            s16 sprite_count;
            // 0x0a
            s16 maximum_sprite_count;
            // 0x0c
            s16 texture_count;
            // 0x0e
            s16 fx_count;
            // 0x10
            s32 texture_defs;
            // 0x14
            s32 texture_data;
            // 0x18
            s32 fx_list;
            // 0x1c
            s32 sprites;
            // 0x20
            s32 shells[8];
        )
    */
    return {
        skyColor: view.getUint8_Rgba(0x0),
        clearScreen: view.getInt16(0x04),
        shellCount: view.getInt16(0x06),
        spriteCount: view.getInt16(0x08),
        maximumSpriteCount: view.getInt16(0x0a),
        textureCount: view.getInt16(0x0c),
        fxCount: view.getInt16(0x0e),
        textureDefs: view.getInt32(0x10),
        textureData: view.getInt32(0x14),
        fxList: view.getInt32(0x18),
        sprites: view.getInt32(0x1c),
        shells: view.getArrayOfNumbers(0x20, 8, Int32Array),
    };
}

export const SIZEOF_SKY_TEXTURE_ENTRY = 0x10;
export type SkyTexture = ReturnType<typeof readSkyTextureEntry>;
export function readSkyTextureEntry(view: DataViewExt) {
    /*
        packed_struct(SkyTexture,
            // 0x0
            s32 palette_offset;
            // 0x4
            s32 texture_offset;
            // 0x8
            s32 width;
            // 0xc
            s32 height;
        )
    */
    return {
        palette: view.getInt32(0x0),
        dataOffset: view.getInt32(0x4),
        width: view.getInt32(0x8),
        height: view.getInt32(0xc),
    };
}

export const SIZEOF_SKY_SHELL_HEADER = 0x8;
export type SkyShellHeader = ReturnType<typeof readSkyShellHeader>;
export function readSkyShellHeader(view: DataViewExt) {
    /*
        packed_struct(SkyShellHeader,
            // 0x0
            s32 cluster_count;
            // 0x4
            s32 flags;
            // maybe rotation data here? actual size of this is 0x10
        )
    */

    const flags = view.getInt32(0x4);

    return {
        clusterCount: view.getInt32(0x0),
        flags: {
            textured: flags & 0x1 ? false : true,
        },
        unknown8: view.getUint32(0x8),
        unknownc: view.getUint32(0xc),
    };
}

export const SIZEOF_SKY_CLUSTER_HEADER = 0x20;
export type SkyClusterHeader = ReturnType<typeof readSkyClusterHeader>;
export function readSkyClusterHeader(view: DataViewExt) {
    /*
        packed_struct(SkyClusterHeader,
            // 0x00
            Vec4f bounding_sphere;
            // 0x10
            s32 data;
            // 0x14
            s16 vertex_count;
            // 0x16
            s16 tri_count;
            // 0x18
            s16 vertex_offset;
            // 0x1a
            s16 st_offset;
            // 0x1c
            s16 tri_offset;
            // 0x1e
            s16 data_size;
        )
    */
    return {
        boundingSphere: view.getFloat32_Xyzw(0x00),
        data: view.getInt32(0x10),
        vertexCount: view.getInt16(0x14),
        triCount: view.getInt16(0x16),
        vertexOffset: view.getInt16(0x18),
        stOffset: view.getInt16(0x1a),
        triOffset: view.getInt16(0x1c),
        dataSize: view.getInt16(0x1e),
    };
}

export const SIZEOF_SKY_VERTEX = 0x8;
export type SkyVertex = ReturnType<typeof readSkyVertex>;
export function readSkyVertex(view: DataViewExt) {
    /*
        packed_struct(SkyVertex,
            // 0x0
            s16 x;
            // 0x2
            s16 y;
            // 0x4
            s16 z;
            // 0x6
            s16 alpha;
        )
    */
    return {
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        alpha: view.getInt16(0x6),
    };
}

// uint8[4]
export type SkyRgba = {
    r: number;
    g: number;
    b: number;
    a: number;
}

export const SIZEOF_SKY_TEXCOORD = 0x4;
export type SkyTexcoord = ReturnType<typeof readSkyTexcoord>;
export function readSkyTexcoord(view: DataViewExt) {
    /*
        packed_struct(SkyTexcoord,
            // 0x0
            s16 s;
            // 0x2
            s16 t;
        )
    */
    return {
        s: view.getUint16(0x0),
        t: view.getUint16(0x2),
    };
}

export const SIZEOF_SKY_FACE = 0x4;
export type SkyFace = ReturnType<typeof readSkyFace>;
export function readSkyFace(view: DataViewExt) {
    /*
        packed_struct(SkyFace,
            // 0x0
            u8 indices[3];
            // 0x3
            u8 texture;
        )
    */
    return {
        indices: view.getArrayOfNumbers(0x0, 3, Uint8Array),
        texture: view.getUint8(0x3),
    };
}



