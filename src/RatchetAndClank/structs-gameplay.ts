import { DataViewExt } from "../DataViewExt";

export type GameplayHeader = ReturnType<typeof readGameplayHeader>;
export function readGameplayHeader(view: DataViewExt) {
    /*
        struct GameplayHeader {
            // 0x0 
            i32 levelSettings;
            // 0x4 - InstanceBlock<DirectionLightInstance>
            i32 directionLightInstances;
            // 0x8 - InstanceBlock<CameraInstance>
            i32 cameraInstances;
            // 0xc - InstanceBlock<SoundInstance>
            i32 soundInstances;
            // 0x10 - 0x2c
            // help message fields
            // 0x30
            i32 tieClasses; // <- not sure what this is since I already have tie classes from the core file
            // 0x34 - InstanceBlock<TieInstance>
            i32 tieInstances;
            // 0x38
            i32 shrubClasses;
            // 0x3c - InstanceBlock<ShrubInstance>
            i32 shrubInstances;
            // 0x40
            i32 mobyClasses;
            // 0x44 (not the same InstanceBlock structure as the other instance blocks)
            i32 mobyInstances;
            // 0x48
            i32 mobyGroupInstances;
            // 0x4c
            i32 sharedData;
            // 0x50
            i32 pvarMobyLinks;
            // 0x54
            i32 pvarTable;
            // 0x58
            i32 pvarData;
            // 0x5c
            i32 pvarRelativePointers;
            // 0x60
            i32 shapesCuboids;
            // 0x64
            i32 shapesSpheres;
            // 0x68
            i32 shapesCylinders;
            // 0x6c
            i32 shapesPills;
            // 0x70
            i32 paths;
            // 0x74
            i32 grindPaths;
            // 0x78
            i32 pointLightGrid;
            // 0x7c
            i32 pointLightInstances;
            // 0x80
            i32 envTransitions;
            // 0x84
            i32 camColGrid;
            // 0x88
            i32 envSamplePoints;
            // 0x8c
            i32 occlusionMappings;
        }
    */
    return {
        levelSettings: view.getInt32(0x0),
        tieInstances: view.getInt32(0x34),
        shrubInstances: view.getInt32(0x3c),
        mobyInstances: view.getInt32(0x44),
        directionLightInstances: view.getInt32(0x4),
        pointLightInstances: view.getInt32(0x7c),
        shapesCuboids: view.getInt32(0x60),
        shapesSpheres: view.getInt32(0x64),
        shapesCylinders: view.getInt32(0x68),
        shapesPills: view.getInt32(0x6c),
        paths: view.getInt32(0x70),
        grindPaths: view.getInt32(0x74),
    }
}

export const SIZEOF_LEVEL_SETTINGS_1 = 0x50;
export type LevelSettings = ReturnType<typeof readLevelSettings>;
export function readLevelSettings(view: DataViewExt) {
    /*
        packed_struct(RacLevelSettingsFirstPart,
            // 0x00
            Rgb96 background_colour;
            // 0x0c
            Rgb96 fog_colour;
            // 0x18
            f32 fog_near_distance;
            // 0x1c
            f32 fog_far_distance;
            // 0x20
            f32 fog_near_intensity;
            // 0x24
            f32 fog_far_intensity;
            // 0x28
            f32 death_height;
            // 0x2c
            Vec3f ship_position;
            // 0x38
            f32 ship_rotation_z;
            // 0x3c
            s32 ship_path;
            // 0x40
            s32 ship_camera_cuboid_start;
            // 0x44
            s32 ship_camera_cuboid_end;
            // 0x48
            u32 pad[2];
        )
    */
    return {
        backgroundColor: view.getInt32_Rgb(0),
        fogColor: view.getInt32_Rgb(0xc),
        fogNearDistance: view.getFloat32(0x18),
        fogFarDistance: view.getFloat32(0x1c),
        fogNearIntensity: view.getFloat32(0x20),
        fogFarIntensity: view.getFloat32(0x24),
        deathHeight: view.getFloat32(0x28),
        shipPosition: view.getFloat32_Xyz(0x2c),
        shipRotationZ: view.getFloat32(0x38),
        shipPath: view.getInt32(0x3c),
        shipCameraCuboidStart: view.getInt32(0x40),
        shipCameraCuboidEnd: view.getInt32(0x44),
    }
}

export const SIZEOF_TIE_INSTANCE = 0xe0;
export type TieInstance = ReturnType<typeof readTieInstance>;
export function readTieInstance(view: DataViewExt) {
    /*
        // size 0xe0
        packed_struct(RacTieInstance,
            // 0x00
            i32 o_class;
            // 0x04
            i32 draw_distance;
            // 0x08
            i32 pad_8;
            // 0x0c
            i32 occlusion_index;
            // 0x10
            Mat4 matrix;
            // 0x50
            u8 ambient_rgbas[0x80];
            // 0xd0
            i32 directional_lights;
            // 0xd4
            i32 uid;
            // 0xd8
            i32 pad[2];
        )
    */

    const matrix = view.getMat4Slice(0x10).slice();

    // TODO: no idea why this
    matrix[15] = 1;

    return {
        oClass: view.getInt32(0x0),
        drawDistance: view.getInt32(0x4),
        occlusionIndex: view.getInt32(0xc),
        matrix,
        ambientRgbas: view.getArrayOfNumbers(0x50, 0x80 / 2, Uint16Array),
        directionalLights: view.getInt32(0xd0),
        uid: view.getInt32(0xd4),
    }
}

export const SIZEOF_SHRUB_INSTANCE = 0x70;
export type ShrubInstance = ReturnType<typeof readShrubInstance>;
export function readShrubInstance(view: DataViewExt) {
    /*
        packed_struct(ShrubInstancePacked,
            // 0x00
            s32 o_class;
            // 0x04
            f32 draw_distance;
            // 0x08
            s32 unused_8;
            // 0x0c
            s32 unused_c;
            // 0x10
            Mat4 matrix;
            // 0x50
            Rgb96 colour;
            // 0x5c
            s32 unused_5c;
            // 0x60
            s32 dir_lights;
            // 0x64
            s32 unused_64;
            // 0x68
            s32 unused_68;
            // 0x6c
            s32 unused_6c;
        )
    */

    const matrix = view.getMat4Slice(0x10).slice();

    matrix[15] = 1;

    return {
        oClass: view.getInt32(0x0),
        drawDistance: view.getFloat32(0x4),
        matrix,
        color: view.getInt32_Rgb(0x50),
        directionalLights: view.getInt32(0x60),
    }
}


type InstanceBlock<T> = {
    count: number,
    instances: T[]
}
const SIZEOF_INSTANCE_BLOCK_HEADER = 0x10;
export function readInstanceBlock<T>(view: DataViewExt, instanceSize: number, readerFn: (buf: DataViewExt) => T): InstanceBlock<T> {
    /*
        struct InstanceBlockHeader<T> {
            // 0x0
            i32 count;
            i32 pad[3];
            // 0x10
            T instances[count];
        }
    */
    const count = view.getInt32(0);
    const instances = view.subdivide(SIZEOF_INSTANCE_BLOCK_HEADER, count, instanceSize).map(view => readerFn(view));
    return {
        count,
        instances,
    }
}

export const SIZEOF_DIRECTION_LIGHT_INSTANCE = 0x40;
export type DirectionLightInstance = ReturnType<typeof readDirectionLightInstance>;
export function readDirectionLightInstance(view: DataViewExt) {
    /*
        packed_struct(DirectionalLightPacked,
            // 0x00
            Vec4f colour_a;
            // 0x10
            Vec4f direction_a;
            // 0x20
            Vec4f colour_b;
            // 0x30
            Vec4f direction_b;
        )
    */
    return {
        colorA: view.getFloat32_Rgba(0x0),
        directionA: view.getFloat32_Xyzw(0x10),
        colorB: view.getFloat32_Rgba(0x20),
        directionB: view.getFloat32_Xyzw(0x30),
    }
}

export const SIZEOF_POINT_LIGHT_INSTANCE = 0x20;
export type PointLightInstance = ReturnType<typeof readPointLightInstance>;
export function readPointLightInstance(view: DataViewExt) {
    /*
        packed_struct(PointLightPacked,
            // 0x00
            Vec3f position;
            // 0x0c
            f32 radius;
            // 0x10
            Rgb32 colour;
            // 0x14
            u32 pad[3];
        )
    */
    return {
        position: view.getVec3Slice(0x0),
        radius: view.getFloat32(0xc),
        color: view.getUint8_Rgb(0x10),
    }
}

export const SIZEOF_PATH_BLOCK_HEADER = 0x10;
export type PathBlockHeader = ReturnType<typeof readPathBlockHeader>;
export function readPathBlockHeader(view: DataViewExt) {
    /*
        packed_struct(PathBlockHeader,
            // 0x0
            s32 spline_count;
            // 0x4
            s32 data_offset;
            // 0x8
            s32 data_size;
            // 0xc
            s32 pad;
        )
    */
    return {
        splineCount: view.getInt32(0x0),
        dataOffset: view.getInt32(0x4),
        dataSize: view.getInt32(0x8),
    };
}

export function readPathBlock(view: DataViewExt) {
    const header = readPathBlockHeader(view);
    return readSplines(view.subview(SIZEOF_PATH_BLOCK_HEADER), header.splineCount, header.dataOffset - 0x10);
}

export function readGrindPathBlock(view: DataViewExt) {
    const header = readPathBlockHeader(view);

    // skip grind path headers after the block header, header.splineCount*0x20 bytes
    const SIZEOF_GRIND_PATH_HEADER = 0x20;

    const totalHeaderSize = SIZEOF_PATH_BLOCK_HEADER + header.splineCount * SIZEOF_GRIND_PATH_HEADER;
    return readSplines(view.subview(totalHeaderSize), header.splineCount, header.dataOffset - totalHeaderSize);
}

export function readSplines(view: DataViewExt, count: number, offset: number) {
    // read an array of offsets at offset, then read splines at offsets[i]
    // both offsets are relative to the start of block not to the end of the header
    const offsets = view.getArrayOfNumbers(0, count, Int32Array);
    return offsets.map(offset2 => readSpline(view.subview(offset + offset2)));
}

export function readSpline(view: DataViewExt) {
    /*
        struct Spline {
            // 0x0
            i32 count;
            // 0x4
            i32 align[3];
            // 0x10
            vec4 points[count];
        }
    */
    const count = view.getInt32(0x0);
    const points = view.subdivide(0x10, count, 0x10).map(view => view.getFloat32_Xyzw(0));
    return {
        count,
        points,
    };
}
