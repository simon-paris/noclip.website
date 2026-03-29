import { IS_DEVELOPMENT } from "../BuildVersion";
import { GsPrimitiveType } from "../Common/PS2/GS";
import { DataViewExt } from "../DataViewExt";
import { getBit, getBits } from "./utils";

export type LevelCoreHeader = ReturnType<typeof readLevelCoreHeader>;
export function readLevelCoreHeader(view: DataViewExt) {
    /*
      // size 0xbc
      packed_struct(LevelCoreHeader,
        // 0x00
        ArrayRange gs_ram;
        // 0x08
        s32 tfrags;
        // 0x0c
        s32 occlusion;
        // 0x10
        s32 sky;
        // 0x14
        s32 collision;
        // 0x18
        ArrayRange moby_classes;
        // 0x20
        ArrayRange tie_classes;
        // 0x28
        ArrayRange shrub_classes;
        // 0x30
        ArrayRange tfrag_textures;
        // 0x38
        ArrayRange moby_textures;
        // 0x40
        ArrayRange tie_textures;
        // 0x48
        ArrayRange shrub_textures;
        // 0x50
        ArrayRange part_textures;
        // 0x58
        ArrayRange fx_textures;
        // 0x60
        s32 textures_base_offset;
        // 0x64
        s32 part_bank_offset;
        // 0x68
        s32 fx_bank_offset;
        // 0x6c
        s32 part_defs_offset;
        // 0x70
        s32 sound_remap_offset;
        // 0x74
        s32 unknown_74;
        union(
          // 0x78
          s32 ratchet_seqs_rac123;
          // 0x78
          s32 light_cuboids_offset_dl;
        )
        // 0x7c
        s32 scene_view_size;
        union(
          // 0x80
          s32 gadget_count_rac1;
          // 0x80
          s32 index_into_some1_texs_rac2_maybe3;
        )
        union(
          // 0x84
          s32 gadget_offset_rac1;
          // 0x84
          s32 moby_gs_stash_count_rac23dl;
        )
        // 0x88
        s32 assets_compressed_size;
        // 0x8c
        s32 assets_decompressed_size;
        // 0x90
        s32 chrome_map_texture;
        // 0x94
        s32 chrome_map_palette;
        // 0x98
        s32 glass_map_texture;
        // 0x9c
        s32 glass_map_palette;
        // 0xa0
        s32 unknown_a0;
        // 0xa4
        s32 heightmap_offset;
        // 0xa8
        s32 occlusion_oct_offset;
        // 0xac
        s32 moby_gs_stash_list;
        // 0xb0
        s32 occlusion_rad_offset;
        // 0xb4
        s32 moby_sound_remap_offset;
        // 0xb8
        s32 occlusion_rad2_offset;
      )
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

export type GsRamTableEntry = ReturnType<typeof readGsRamTableEntry>;
export const SIZEOF_GS_RAM_TABLE_ENTRY = 0x10;
export function readGsRamTableEntry(view: DataViewExt) {
    /*    
        packed_struct(GsRamEntry,
            s32 psm; // 0 == palette RGBA32, 1 == palette RGBA16, 0x13 == IDTEX8
            s16 width;
            s16 height;
            s32 address;
            s32 offset; // For stashed moby textures, this is relative to the start of the stash.
        )
    */
    return {
        psm: view.getInt32(0x0),
        width: view.getInt16(0x4),
        height: view.getInt16(0x6),
        address: view.getInt32(0x8),
        offset: view.getInt32(0xc),
    }
}

const SIZEOF_MOBY_OR_TIE_CLASS_ENTRY = 0x20;
export function readTieOrMobyClassEntryArray(view: DataViewExt, count: number) {
    /*
        packed_struct(TieOrMobyClassEntry,
            // 0x00
            s32 offset_in_asset_wad;
            // 0x04
            s32 o_class;
            // 0x08
            s32 unknown_8;
            // 0x0c
            s32 unknown_c;
            // 0x10
            u8 textures[16];
        )
    */

    return view.subdivide(0, count, SIZEOF_MOBY_OR_TIE_CLASS_ENTRY).map(view => {
        return {
            offsetInAssetWad: view.getInt32(0x0),
            oClass: view.getInt32(0x4),
            textures: view.getArrayOfNumbers(0x10, 16, Uint8Array),
        }
    })
}

export function readTieOrMobyTextureEntryArray(view: DataViewExt, count: number) {
    return view.subdivide(0, count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry)
}

export const SIZEOF_TEXTURE_ENTRY = 0x10;
export type TextureEntry = ReturnType<typeof readTextureEntry>;
export function readTextureEntry(view: DataViewExt) {
    /*
      // size 0x10
      packed_struct(TextureEntry,
        // 0x0
        s32 data_offset;
        // 0x4
        s16 width;
        // 0x6
        s16 height;
        // 0x8
        s16 type;
        // 0xa
        s16 palette;
        // 0xc
        s16 mipmap = -1;
        // 0xe
        s16 pad = -1;
      )
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

export type TieClass = ReturnType<typeof readTieClass>;
export type TiePacket = { header: TiePacketHeader, body: TiePacketBody };
// tie classes are unsized objects, there is an unknown amount of additional data concatted onto the end of the tie class header
export function readTieClass(view: DataViewExt, tieIndex: number) {
    /*
      // header size is 0x80
      packed_struct(TieClassHeader,
        // 0x00
        s32 packets[3];
        // 0x0c
        u32 vert_normals;
        // 0x10
        f32 near_dist;
        // 0x14
        f32 mid_dist;
        // 0x18
        f32 far_dist;
        // 0x1c
        u32 unknown_1c;
        // 0x20 
        u8 packet_count[3];
        // 0x23
        u8 texture_count;
        // 0x24
        u32 unknown_24;
        // 0x28
        u32 unknown_28;
        // 0x2c
        u32 ad_gif_ofs;
        // 0x30
        Vec4f bsphere;
        // 0x40
        f32 scale;
        // 0x44
        u32 unknown_44;
        // 0x48
        u32 unknown_48;
        // 0x4c
        u32 unknown_4c;
        // 0x50
        u32 unknown_50;
        // 0x54
        u32 unknown_54;
        // 0x58
        u32 unknown_58;
        // 0x5c
        u32 unknown_5c;
        // 0x60
        u32 unknown_60;
        // 0x64
        u32 unknown_64;
        // 0x68
        u32 unknown_68;
        // 0x6c
        u32 unknown_6c;
      )
    */

    // these are pointers relative to this struct header, we'll treat them like part of this struct
    const packetOffsets = view.getArrayOfNumbers(0x0, 3, Uint32Array);
    const packetCounts = view.getArrayOfNumbers(0x20, 3, Uint8Array);

    const packets: TiePacket[][] = [];
    // loop 3 times because there are 3 lods
    for (let i = 0; i < 3; i++) {
        const packetOffset = packetOffsets[i];
        const packetCount = packetCounts[i];
        const packetHeaders = view.subdivide(packetOffset, packetCount, SIZEOF_TIE_PACKET_HEADER).map(readTiePacketHeader);

        const packetsInThisLod: TiePacket[] = [];
        for (let j = 0; j < packetCount; j++) {
            const packetDataOffset = packetOffset + packetHeaders[j].data;
            const packetBody = readTiePacketBody(view.subview(packetDataOffset), packetHeaders[j], tieIndex, i, j);
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

    return {
        vertNormals: view.getUint32(0xc),
        nearDist: view.getFloat32(0x10),
        midDist: view.getFloat32(0x14),
        farDist: view.getFloat32(0x18),
        textureCount,
        adGifsOffset,
        bsphere: view.getFloat32_Xyzw(0x30),
        scale: view.getFloat32(0x40),
        packetOffsets,
        packetCounts,
        packets,
        adGifs,
    }
}

export const SIZEOF_TIE_PACKET_HEADER = 0x10;
export type TiePacketHeader = ReturnType<typeof readTiePacketHeader>;
export function readTiePacketHeader(view: DataViewExt) {
    /*
        packed_struct(TiePacketHeader,
            // 0x0
            s32 data;
            // 0x4
            u8 shader_count;
            // 0x5
            u8 bfc_distance;
            // 0x6
            u8 control_count;
            // 0x7
            u8 control_size;
            // 0x8
            u8 vert_ofs;
            // 0x9
            u8 vert_size;
            // 0xa
            u8 rgba_count;
            // 0xb
            u8 multipass_ofs;
            // 0xc
            u8 scissor_ofs;
            // 0xd
            u8 scissor_size;
            // 0xe
            u8 nultipass_type;
            // 0xf
            u8 multipass_uv_size;
        )
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
    value: null
} | {
    type: typeof TiePacketCommandTypes.SET_MATERIAL,
    size: number,
    value: number
} | {
    type: typeof TiePacketCommandTypes.VERTEX,
    size: number,
    value: TieDinkyVertex
}

const TieCommandSizes = {
    [TiePacketCommandTypes.PRIMITIVE_RESET]: 1,
    [TiePacketCommandTypes.SET_MATERIAL]: 6,
    [TiePacketCommandTypes.VERTEX]: 3,
}

export type TiePacketBody = ReturnType<typeof readTiePacketBody>;
export function readTiePacketBody(view: DataViewExt, tiePacketHeader: TiePacketHeader, tieIndex: number, lod: number, packetIndex: number) {
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
        }
    */
    const AD_GIFS = 4;
    const adGifDestOffsets = view.getArrayOfNumbers(0x0, AD_GIFS, Int32Array);
    const adGifSrcOffsets = view.getArrayOfNumbers(0x10, AD_GIFS, Int32Array)

    const tieUnpackHeader = readTieUnpackHeader(view.subview(0x20));

    const tieStrips = view.subdivide(0x2c, tieUnpackHeader.stripCount, SIZEOF_TIE_STRIP).map(readTieStrip);

    const vertexBuffer = view.subview(tiePacketHeader.vertOffset * 0x10, tiePacketHeader.vertSize * 0x10);

    // read dinky verts
    const dinkyVertexCount = (tieUnpackHeader.dinkyVerticesSizePlusFour - 4) / 2; // ???
    const dinkyVerts = vertexBuffer.subdivide(0, dinkyVertexCount, SIZEOF_TIE_DINKY_VERTEX).map(readTieDinkyVertex);

    // read fat verts until the end of the buffer
    const fatVerts = vertexBuffer.subdivide(dinkyVertexCount * 0x10, 0xFFFF, SIZEOF_TIE_FAT_VERTEX).map(readTieFatVertex);

    /*
    The data we have is all out of order, but each item has an address for where it wants to be written
    into the GPU command buffer. We need to build the command buffer as it would have been built by the game
    to validate it and convert it into a usable mesh.
    */

    let bufferEnd = 0;
    const MAX_BUFFER_SIZE = 0x100; // the max size seems to be ~185 so I'll use 256 to be safe
    const imaginaryGpuCommandBuffer: (TiePacketCommand | null)[] = Array(MAX_BUFFER_SIZE).fill(null);

    function writeCommand(offset: number, type: typeof TiePacketCommandTypes.PRIMITIVE_RESET, value: null): void;
    function writeCommand(offset: number, type: typeof TiePacketCommandTypes.SET_MATERIAL, value: number): void;
    function writeCommand(offset: number, type: typeof TiePacketCommandTypes.VERTEX, value: TieDinkyVertex): void;
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

    // Write verts into command buffer. Both vert types are the same.
    // Some are written twice.
    for (const vertex of dinkyVerts) {
        writeCommand(vertex.gsPacketWriteOffset, TiePacketCommandTypes.VERTEX, vertex);
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            writeCommand(vertex.gsPacketWriteOffset2, TiePacketCommandTypes.VERTEX, vertex);
        }
    }
    for (const vertex of fatVerts) {
        writeCommand(vertex.gsPacketWriteOffset, TiePacketCommandTypes.VERTEX, vertex);
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            writeCommand(vertex.gsPacketWriteOffset2, TiePacketCommandTypes.VERTEX, vertex);
        }
    }

    // Write primative reset commands. There's always one before the first vert (address 7).
    for (const strip of tieStrips) {
        writeCommand(strip.gifTagOffset, TiePacketCommandTypes.PRIMITIVE_RESET, null);
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
            vertexBuffer,
            dinkyVertexCount,
            dinkyVerts,
            fatVerts,
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
            u8 dinky_vertices_size_plus_four;
            // 0x09
            u8 fat_vertices_size;
            // 0x0a
            u8 unknown_14;
            // 0x0b
            u8 unknown_16;
        )
    */

    return {
        stripCount: view.getUint8(0x3),
        dinkyVerticesSizePlusFour: view.getUint8(0x8),
        fatVerticesSize: view.getUint8(0x9),
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
    };
}

export const SIZEOF_TIE_DINKY_VERTEX = 0x10;
export type TieDinkyVertex = ReturnType<typeof readTieDinkyVertex>;
export function readTieDinkyVertex(view: DataViewExt) {
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
        gsPacketWriteOffset: view.getUint16(0x6), // fields out of order for consistency
        gsPacketWriteOffset2: view.getUint16(0xe),
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        s: view.getUint16(0x8),
        t: view.getUint16(0xa),
        q: view.getUint16(0xc),
    };
}

export const SIZEOF_TIE_FAT_VERTEX = 0x18;
export type TieFatVertex = ReturnType<typeof readTieFatVertex>;
export function readTieFatVertex(view: DataViewExt) {
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
        unknown0: view.getInt16(0x0),
        unknown2: view.getInt16(0x2),
        unknown4: view.getInt16(0x4),
        gsPacketWriteOffset: view.getUint16(0x6),
        gsPacketWriteOffset2: view.getUint16(0x16), // fields out of order for consistency
        x: view.getInt16(0x8),
        y: view.getInt16(0xa),
        z: view.getInt16(0xc),
        s: view.getUint16(0x10),
        t: view.getUint16(0x12),
        q: view.getUint16(0x14),
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
        intensity: view.getInt8(0x1),
        azimuth: view.getInt8(0x2),
        elevation: view.getInt8(0x3),
        color: view.getInt16(0x4),
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
    for (const index of lod2Indices.data) {
        if (lod2Indices.data[index] >= commonVertexInfo.data.length) {
            throw new Error(`LOD 2 index ${lod2Indices.data[index]} is out of bounds for info array of length ${commonPositions.data.length}`);
        } else {
            const vertexInfo = commonVertexInfo.data[lod2Indices.data[index]];
            if (vertexInfo.vertex / 2 > commonPositions.data.length) {
                throw new Error(`VertexInfo vertex ${vertexInfo.vertex} is out of bounds for positions array of length ${commonPositions.data.length}`);
            }
        }
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
        // TODO: check vnvl
        if (i < lod01CommandListUnpacks.length && lod01CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8 && commonVuHeader.data.positionsLod01Count > 0) {
            // TODO: load lod 01 parent indices
            i++;
        }

        // TODO: check vnvl
        if (i < lod01CommandListUnpacks.length && lod01CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8 && lod01CommandListUnpacks[i].unpack!.addr) {
            // TODO: load lod 01 unknown indices 2
            i++;
        }

        // TODO: check vnvl
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
            // TODO: load parent indices
            i++;
        }

        if (i < lod0CommandListUnpacks.length && lod0CommandListUnpacks[i].unpack!.vnvl === VifVnVl.V4_8) {
            // TODO: load unknown indices 2 if required
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

enum VifCmd {
    NOP = 0b0000000,
    STCYCL = 0b0000001,
    OFFSET = 0b0000010,
    BASE = 0b0000011,
    ITOP = 0b0000100,
    STMOD = 0b0000101,
    MSKPATH3 = 0b0000110,
    MARK = 0b0000111,
    FLUSHE = 0b0010000,
    FLUSH = 0b0010001,
    FLUSHA = 0b0010011,
    MSCAL = 0b0010100,
    MSCNT = 0b0010111,
    MSCALF = 0b0010101,
    STMASK = 0b0100000,
    STROW = 0b0110000,
    STCOL = 0b0110001,
    MPG = 0b1001010,
    DIRECT = 0b1010000,
    DIRECTHL = 0b1010001
};

enum VifVnVl {
    S_32 = 0b0000,
    S_16 = 0b0001,
    ERR_0010 = 0b0010,
    ERR_0011 = 0b0011,
    V2_32 = 0b0100,
    V2_16 = 0b0101,
    V2_8 = 0b0110,
    ERR_0111 = 0b0111,
    V3_32 = 0b1000,
    V3_16 = 0b1001,
    V3_8 = 0b1010,
    ERR_1011 = 0b1011,
    V4_32 = 0b1100,
    V4_16 = 0b1101,
    V4_8 = 0b1110,
    V4_5 = 0b1111
};

function readVifCommandList(view: DataViewExt) {
    const out: VifCommand[] = [];

    if (view.byteLength % 4 !== 0) {
        throw new Error(`VIF command list byte length must be a multiple of 4`);
    }

    // not sure what the initial values should be
    let wl = 1, cl = 1;

    while (view.byteLength) {
        const command = readVifCommand(view, wl, cl);
        const size = vifCommandSizeInBytes(command.cmd, command.num, command.immediate, wl, cl);
        if (size > view.byteLength) {
            throw new Error(`VIF command size exceeds remaining buffer size`);
        }
        out.push(command);

        switch (command.cmd) {
            case VifCmd.STCYCL: {
                const stcycl = readVifStcyclData(command);
                wl = stcycl.wl;
                cl = stcycl.cl;
                break;
            }
        }

        const align = size % 4 !== 0 ? 4 - (size % 4) : 0
        view = view.subview(size + align);
    }

    return out;
}

type VifCommand = ReturnType<typeof readVifCommand>;
function readVifCommand(view: DataViewExt, wl: number, cl: number) {
    /*
        struct VifCommand {
            u8 cmd;
            u8 num;
            u16 immediate;
            // data follows depending on command
        }
    */

    const code = view.getUint32(0x0);

    const cmd = getBits(code, 24, 30);
    const immediate = getBits(code, 0, 15);
    const num = getBits(code, 16, 23);

    const isUnpack = isUnpackCommand(cmd);
    const cmdString = VifCmd[cmd] ?? (isUnpack ? "UNPACK" : null);
    if (!cmdString) {
        throw new Error(`Unknown VIF command: 0b${cmd.toString(16).padStart(2, "0")}`);
    }

    const size = vifCommandSizeInBytes(cmd, num, immediate, wl, cl);
    if (size > view.byteLength) {
        throw new Error(`VIF command size exceeds remaining buffer size`);
    }

    return {
        view: view.subview(0, size),
        size,

        // main fields
        cmd,
        num,
        immediate,

        // computed fields
        cmdString,

        // command-specific fields
        unpack: isUnpack ? {
            vnvl: cmd & 0x0F,
            vnvlStr: VifVnVl[cmd & 0x0F] ?? `Unknown`,
            /** multiply by 16 to get an actual address */
            addr: getBits(immediate, 0, 9),
        } : null,
    };
}

export function vifCommandSizeInBytes(cmd: number, num: number, immediate: number, wl: number, cl: number) {
    switch (cmd) {
        case VifCmd.NOP:
        case VifCmd.STCYCL:
        case VifCmd.OFFSET:
        case VifCmd.BASE:
        case VifCmd.ITOP:
        case VifCmd.STMOD:
        case VifCmd.MSKPATH3:
        case VifCmd.MARK:
        case VifCmd.FLUSHE:
        case VifCmd.FLUSH:
        case VifCmd.FLUSHA:
        case VifCmd.MSCAL:
        case VifCmd.MSCNT:
        case VifCmd.MSCALF:
            return 0x4;
        case VifCmd.STMASK:
            // 20h STMASK
            // Sets the MASK register to the next 32-bit word in the stream. This is used for UNPACK write masking.
            return 0x4 + 0x4;
        case VifCmd.STROW:
        case VifCmd.STCOL:
            // 30h STROW
            // Sets the R0-R3 row registers to the next 4 32-bit words in the stream. This is used for UNPACK write filling.
            // 31h STCOL
            // Sets the C0-C3 column registers to the next 4 32-bit words in the stream. This is used for UNPACK write filling.
            return 0x4 + (0x4 * 4);
        case VifCmd.MPG:
            // 4Ah MPG
            // Loads NUM*8 bytes into VU micro memory, starting at the given address IMMEDIATE*8. If the VU is currently active, MPG stalls until the VU is finished before uploading data.
            // If NUM is 0, then 2048 bytes are loaded.
            return 0x4 + ((num * 8) || 2048);
        case VifCmd.DIRECT:
        case VifCmd.DIRECTHL:
            // 50h DIRECT (VIF1)
            // Transfers IMMEDIATE quadwords to the GIF through PATH2. If PATH2 cannot take control of the GIF, the VIF stalls until PATH2 is activated.
            // If IMMEDIATE is 0, 65,536 quadwords are transferred.
            return 0x4 + ((immediate || 65536) * 16);
        default: {
            // 60h-7Fh UNPACK
            // Decompresses data in various formats to the given address in bits 0-9 of IMMEDIATE multiplied by 16.
            // If bit 14 of IMMEDIATE is set, the decompressed data is zero-extended. Otherwise, it is sign-extended.
            // If bit 15 of IMMEDIATE is set, TOPS is added to the starting address. This is only applicable for VIF1.
            // Bits 0-3 of CMD determine the type of UNPACK that occurs. See VIF UNPACK for details.
            // Bit 4 of CMD performs UNPACK write masking if set.

            // https://github.com/PCSX2/pcsx2/blob/e14b4475ffbea0ecf184deb76ec6d4c8b3ee273b/pcsx2/Vif_Unpack.cpp#L219

            num = num || 0x100;
            wl = wl || 0x100;

            // these bits of the cmd determine the data type and vector size
            const vl = cmd & 0x03;
            const vn = (cmd >> 2) & 0x3;

            const bytesPerElement = (32 >> vl) / 8;
            const elementsPerVector = vn + 1;

            const gsize = elementsPerVector * bytesPerElement;

            let size = 0;
            if (wl <= cl) {
                // Skipping write
                // wl is the number of qwords written to the output per write cycle, and cl is the stride between write cycles in qwords.
                // if cl>wl, then all of the vector elements are written and no data is skipped, so we can just multiply to get the input size
                size = num * gsize;
            } else {
                // Filling write
                // if wl>cl, then only wl elements of the input vector are present, so the input will be smaller
                size = (cl * Math.trunc(num / wl) + (num % wl > cl ? cl : num % wl)) * gsize;
            }
            return 0x4 + size;
        }
    }
}

export function readVifUnpackData(vifCommand: VifCommand) {
    if (!isUnpackCommand(vifCommand.cmd)) {
        throw new Error(`Not an UNPACK command`);
    }
    return vifCommand.view.subview(0x4);
}

export function readVifStrowData(vifCommand: VifCommand) {
    if (vifCommand.cmd !== VifCmd.STROW) {
        throw new Error(`Not a STROW command`);
    }
    // STROW packets are followed by 128 bits of data
    return vifCommand.view.subview(0x4, 0x4 * 4).getTypedArrayView(Uint32Array);
}

export function readVifStcyclData(vifCommand: VifCommand) {
    if (vifCommand.cmd !== VifCmd.STCYCL) {
        throw new Error(`Not a STCYCL command`);
    }
    // Sets the CYCLE register to IMMEDIATE. In particular, CYCLE.CL is set to bits 0-7 and CYCLE.WL is set to bits 8-15.
    const imm = vifCommand.immediate;
    return {
        cl: getBits(imm, 0, 7),
        wl: getBits(imm, 8, 15),
    };
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
    return {
        s: view.getInt16(0x0),
        t: view.getInt16(0x2),
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

function isUnpackCommand(cmd: number) {
    return cmd >= 0x60 && cmd <= 0x7f;
}

export const SIZEOF_SHRUB_CLASS_ENTRY = 0x30;
export type ShrubClassEntry = ReturnType<typeof readShrubClassEntry>;
export function readShrubClassEntry(view: DataViewExt) {
    /*
        packed_struct(ShrubClassEntry,
            // 0x00
            s32 offset_in_asset_wad;
            // 0x04
            s32 o_class;
            // 0x08
            s32 pad_8;
            // 0x0c
            s32 pad_c;
            // 0x10
            u8 textures[16];
            // 0x20 (this has size 0x10)
            ShrubBillboardInfo billboard;
        )
    */
    return {
        offsetInAssetWad: view.getInt32(0x0),
        oClass: view.getInt32(0x4),
        textures: view.getArrayOfNumbers(0x10, 16, Uint8Array),
        // billboard: ...
    }
};

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
