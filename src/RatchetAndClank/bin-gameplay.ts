import { mat4, quat, vec3 } from "gl-matrix";
import { DataViewExt } from "./DataViewExt";
import { GN, matrixToNoclipSpace, noclipSpaceFromRatchetSpace } from "./utils";
import { assert } from "../util";

export type GameplayHeader = {
    levelSettings: number,
    directionLightInstances: number,
    tieClasses: number,
    tieInstances: number,
    shrubClasses: number,
    shrubInstances: number,
    mobyClasses: number,
    mobyInstances: number,
    shapesCuboids: number,
    shapesSpheres: number,
    shapesCylinders: number,
    shapesPills: number,
    paths: number,
    grindPaths: number,
    pointLightInstances: number,
    occlusionMappings: number,
    tieAmbientRgbas: number, // rac2+ only
}
export function readGameplayHeader(gn: GN, view: DataViewExt, artFileView_rac4: DataViewExt | null): GameplayHeader {
    switch (gn) {
        case 1: {
            /*
            // https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay.cpp#L113
            struct GameplayHeader {
                // 0x0 
                int32 levelSettings;
                int32 directionLightInstances;
                int32 cameraInstances;
                int32 soundInstances;
                // 0x10
                int32 helpMessagesByLanguage[8];
                // 0x30
                int32 tieClasses;
                int32 tieInstances;
                int32 shrubClasses;
                int32 shrubInstances;
                // 0x40
                int32 mobyClasses;
                int32 mobyInstances;
                int32 mobyGroupInstances;
                int32 sharedData;
                // 0x50
                int32 pvarMobyLinks;
                int32 pvarTable;
                int32 pvarData;
                int32 pvarRelativePointers;
                // 0x60
                int32 shapesCuboids;
                int32 shapesSpheres;
                int32 shapesCylinders;
                int32 shapesPills;
                // 0x70
                int32 paths;
                int32 grindPaths;
                int32 pointLightGrid;
                int32 pointLightInstances;
                // 0x80
                int32 envTransitions;
                int32 camColGrid;
                int32 envSamplePoints;
                int32 occlusionMappings;
            }
            */
            return {
                levelSettings: view.getInt32(0x0),
                directionLightInstances: view.getInt32(0x4),
                tieClasses: view.getInt32(0x30),
                tieInstances: view.getInt32(0x34),
                shrubClasses: view.getInt32(0x38),
                shrubInstances: view.getInt32(0x3c),
                mobyClasses: view.getInt32(0x40),
                mobyInstances: view.getInt32(0x44),
                shapesCuboids: view.getInt32(0x60),
                shapesSpheres: view.getInt32(0x64),
                shapesCylinders: view.getInt32(0x68),
                shapesPills: view.getInt32(0x6c),
                paths: view.getInt32(0x70),
                grindPaths: view.getInt32(0x74),
                pointLightInstances: view.getInt32(0x7c),
                occlusionMappings: view.getInt32(0x8c),
                tieAmbientRgbas: 0, // not in rac1
            };
        }
        case 2:
        case 3: {
            /*
            // https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay.cpp#L113
            struct GameplayHeader {
                // 0x0
                int32 levelSettings;
                int32 directionLightInstances;
                int32 cameraInstances;
                int32 soundInstances;
                // 0x10
                int32 helpMessagesByLanguage[8];
                // 0x30
                int32 tieClasses;
                int32 tieInstances;
                int32 tieGroups;
                int32 shrubClasses;
                // 0x40
                int32 shrubInstances;
                int32 shrubGroups;
                int32 mobyClasses;
                int32 mobyInstances;
                // 0x50
                int32 mobyGroups;
                int32 sharedData;
                int32 pvarMobyLinks;
                int32 pvarTable;
                // 0x60
                int32 pvarData;
                int32 pvarRelativePointers;
                int32 cuboids;
                int32 spheres;
                // 0x70
                int32 cylinders;
                int32 pills;
                int32 paths;
                int32 grindPaths;
                // 0x80
                int32 pointLights;
                int32 envTransitions;
                int32 camCollGrid;
                int32 envSamplePoints;
                // 0x90
                int32 occlusionMappings;
                int32 tieAmbientRgbas;
                int32 areas;
            }
            */

            return {
                levelSettings: view.getInt32(0x0),
                directionLightInstances: view.getInt32(0x4),
                tieClasses: view.getInt32(0x30),
                tieInstances: view.getInt32(0x34),
                shrubClasses: view.getInt32(0x3c),
                shrubInstances: view.getInt32(0x40),
                mobyClasses: view.getInt32(0x48),
                mobyInstances: view.getInt32(0x4c),
                shapesCuboids: view.getInt32(0x68),
                shapesSpheres: view.getInt32(0x6c),
                shapesCylinders: view.getInt32(0x70),
                shapesPills: view.getInt32(0x64),
                paths: view.getInt32(0x78),
                grindPaths: view.getInt32(0x7c),
                pointLightInstances: view.getInt32(0x80),
                occlusionMappings: view.getInt32(0x90),
                tieAmbientRgbas: view.getInt32(0x94),
            };
        }
        case 4: {
            /*
            struct GameplayHeader {
                // 0x0
                int32 levelSettings;
                int32 cameraInstances;
                int32 soundInstances;
                // 0xc
                int32 helpMessagesByLanguage[8];
                // 0x2c
                int32 mobyClasses;
                // 0x30
                int32 mobyInstances;
                int32 mobyGroups;
                int32 sharedData;
                int32 mobyLinkFixupTable;
                // 0x40
                int32 pvarTable;
                int32 pvarData;
                int32 pvarRelativePointers;
                int32 cuboids;
                // 0x50
                int32 spheres;
                int32 cylinders;
                int32 pills;
                int32 paths;
                // 0x60
                int32 grindPaths;
                int32 pointLights;
                int32 unused;
                int32 camColGrid;
                // 0x70
                int32 envSamplePoints;
                int32 areas;
            }

            struct ArtInstancesFileHeader {
                // 0x0
                int32 directionLightInstances;
                int32 tieClasses;
                int32 tieInstances;
                int32 tieGroups;
                // 0x10
                int32 shrubClasses;
                int32 shrubInstances;
                int32 shrubGroups;
                int32 occlusionMappings;
                // 0x20
                int32 tieAmbientRgbas;
            }
            */

            assert(artFileView_rac4 !== null);

            return {
                levelSettings: view.getInt32(0x0),
                mobyClasses: view.getInt32(0x2c),
                mobyInstances: view.getInt32(0x30),
                shapesCuboids: view.getInt32(0x4c),
                shapesSpheres: view.getInt32(0x50),
                shapesCylinders: view.getInt32(0x54),
                shapesPills: view.getInt32(0x58),
                paths: view.getInt32(0x5c),
                grindPaths: view.getInt32(0x60),
                pointLightInstances: view.getInt32(0x80),

                // in rac4, these belong to the art file instead of gameplay
                directionLightInstances: artFileView_rac4.getInt32(0x0),
                tieClasses: artFileView_rac4.getInt32(0x4),
                tieInstances: artFileView_rac4.getInt32(0x8),
                shrubClasses: artFileView_rac4.getInt32(0x10),
                shrubInstances: artFileView_rac4.getInt32(0x14),
                occlusionMappings: view.getInt32(0x1c),
                tieAmbientRgbas: artFileView_rac4.getInt32(0x20),
            }
        }
        default: {
            throw new Error("not implemented");
        }
    }
}

export interface MissionGameplayHeader {
    mobyClasses: number,
    mobyInstances: number,
}
export function readMissionGameplayHeader(view: DataViewExt) {
    /*
    struct MissionInstancesFileHeader {
        // 0x0
        int32 mobyClasses
        int32 mobyInstances;
        int32 mobyGroups;
        int32 globalPvar;
        // 0x10
        int32 mobyLinkFixupTable;
        int32 pvarTable;
        int32 pvarData;
        int32 relativePvarPointers;
    }
    */
    return {
        mobyClasses: view.getInt32(0x0),
        mobyInstances: view.getInt32(0x4),
    }
}

export interface LevelSettings {
    backgroundColor: { r: number, g: number, b: number },
    fogColor: { r: number, g: number, b: number },
    fogNearDistance: number,
    fogFarDistance: number,
    fogNearIntensity: number,
    fogFarIntensity: number,
    deathHeight: number,
    chunkPlanes: ChunkPlane[],
    [unknown: string]: unknown,
}
export const SIZEOF_LEVEL_SETTINGS_1 = 0x50;
export function readLevelSettings(gn: GN, view: DataViewExt): LevelSettings {
    switch (gn) {
        case 1: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L24
            */
            return {
                backgroundColor: view.getInt32_Rgb(0),
                fogColor: view.getInt32_Rgb(0xc),
                fogNearDistance: view.getFloat32(0x18), // distance in world space multiplied by 1024
                fogFarDistance: view.getFloat32(0x1c),
                fogNearIntensity: view.getFloat32(0x20), // 255 means zero fog, 0 means full fog
                fogFarIntensity: view.getFloat32(0x24),
                deathHeight: view.getFloat32(0x28),
                shipPosition: view.getFloat32_Xyz(0x2c),
                shipRotationZ: view.getFloat32(0x38),
                shipPath: view.getInt32(0x3c),
                shipCameraCuboidStart: view.getInt32(0x40),
                shipCameraCuboidEnd: view.getInt32(0x44),
                chunkPlanes: [],
            }
        }
        case 2:
        case 3:
        case 4: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L41
            */
            return {
                backgroundColor: view.getInt32_Rgb(0),
                fogColor: view.getInt32_Rgb(0xc),
                fogNearDistance: view.getFloat32(0x18),
                fogFarDistance: view.getFloat32(0x1c),
                fogNearIntensity: view.getFloat32(0x20),
                fogFarIntensity: view.getFloat32(0x24),
                deathHeight: view.getFloat32(0x28),
                isSphericalWorld: view.getInt32(0x2c),
                sphericalWorldCenter: view.getFloat32_Xyz(0x30),
                shipPosition: view.getFloat32_Xyz(0x3c),
                shipRotationZ: view.getFloat32(0x48),
                shipPath: view.getInt32(0x4c),
                shipCameraCuboidStart: view.getInt32(0x50),
                shipCameraCuboidEnd: view.getInt32(0x54),
                chunkPlanes: readChunkPlanes(view.subview(0x5c)),
            };
        }
    }
}

export function readChunkPlanes(view: DataViewExt): ChunkPlane[] {
    const planes = [readChunkPlane(view)];
    let count = planes[0].count; // the number of planes is stored inside the first plane
    for (let i = 1; i < count; i++) {
        planes.push(readChunkPlane(view.subview(i * SIZEOF_CHUNK_PLANE)));
    }
    return planes;
}

export type ChunkPlane = {
    count: number,
    point: vec3,
    normal: vec3,

    // cached pre-transformed data
    _pointInNoclipSpace: vec3,
    _normalInNoclipSpace: vec3,
}
export const SIZEOF_CHUNK_PLANE = 0x20;
export function readChunkPlane(view: DataViewExt): ChunkPlane {
    /*
    https://github.com/chaoticgd/wrench/blob/ba12611f5e5b54733fd807f17b3210fd0248f996/src/instancemgr/gameplay_impl_misc.inl#L60
    */
    const point = view.getFloat32_Vec3(0);
    const normal = view.getFloat32_Vec3(0x10);
    return {
        count: view.getInt32(0xc),
        point,
        normal,

        _pointInNoclipSpace: vec3.transformMat4(vec3.create(), point, noclipSpaceFromRatchetSpace),
        _normalInNoclipSpace: vec3.transformMat4(vec3.create(), normal, noclipSpaceFromRatchetSpace),
    }
}

export function readClassPositionBlock(view: DataViewExt) {
    /*
    struct ClassPositionBlock {
        int32 oClassCount;
        int32 oClasses[oClassCount];
    }
    */
    const oClassCount = view.getInt32(0);
    const oClasses = view.subdivide(4, oClassCount, 4).map(view => view.getInt32(0));
    return oClasses;
}

export interface TieInstance {
    oClass: number,
    drawDistance: number,
    occlusionIndex: number,
    matrix: mat4,
    ambientRgbas: Uint16Array,
    directionalLights: number[],
    uid: number,

    // the position within the original instance array
    _i: number,
    // the bit to use for the occlusion check (-1 means disable precomputed occlusion)
    _occlusionBit: number,
    // cached pre-transformed matrix
    _matrixPretransformed: mat4,
    // translation of pre-transformed matrix
    _positionPretransformed: vec3,
    // instance scale
    _scalePretransformed: number,
}
export const SIZEOF_TIE_INSTANCE = (gn: GN,) => gn === 1 ? 0xe0 : 0x60;
export function readTieInstance(gn: GN, view: DataViewExt, instanceIndex: number): TieInstance {
    switch (gn) {
        case 1: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L611
            */
            const matrix = view.getMat4Slice(0x10).slice();
            const _matrixPretransformed = matrixToNoclipSpace(matrix);
            const _positionPretransformed = mat4.getTranslation(vec3.create(), _matrixPretransformed);
            const _scalePretransformed = vec3.length(vec3.fromValues(_matrixPretransformed[0], _matrixPretransformed[1], _matrixPretransformed[2]));

            return {
                oClass: view.getInt32(0x0),
                drawDistance: view.getInt32(0x4),
                occlusionIndex: view.getInt32(0xc),
                matrix,
                ambientRgbas: view.subview(0x50, 0x80).getTypedArrayView(Uint16Array), // array of 64 A1BGR5 colors
                directionalLights: view.getNibbleArray(0xd0, 2),
                uid: view.getInt32(0xd4),

                _i: instanceIndex,
                _occlusionBit: -1, // populated elsewhere
                _matrixPretransformed,
                _positionPretransformed,
                _scalePretransformed
            }
        }
        case 2:
        case 3:
        case 4: {
            const matrix = view.getMat4Slice(0x10).slice();
            const _matrixPretransformed = matrixToNoclipSpace(matrix);
            const _positionPretransformed = mat4.getTranslation(vec3.create(), _matrixPretransformed);
            const _scalePretransformed = vec3.length(vec3.fromValues(_matrixPretransformed[0], _matrixPretransformed[1], _matrixPretransformed[2]));

            return {
                oClass: view.getInt32(0x0),
                drawDistance: view.getInt32(0x4),
                occlusionIndex: view.getInt32(0xc),
                matrix,
                ambientRgbas: new Uint16Array(0x80).fill(0xFFFF), // TODO: remove this
                directionalLights: view.getNibbleArray(0x50, 2),
                uid: view.getInt32(0x54),

                _i: instanceIndex,
                _occlusionBit: -1, // populated elsewhere
                _matrixPretransformed,
                _positionPretransformed,
                _scalePretransformed
            }
        }
        default: {
            assert(false);
        }
    }
}

export interface MobyInstance {
    size: number,
    mission: number,
    uid: number,
    oClass: number,
    scale: number,
    drawDistance: number,
    updateDistance: number,
    position: { x: number, y: number, z: number },
    rotation: { x: number, y: number, z: number },
    color: { r: number, g: number, b: number },
    directionalLights: number[],
    skipOcclusionCheck: number,

    // the position within the original instance array
    _i: number,
    // the bit to use for the occlusion check (if skipOcclusionCheck=1 then occlusion checks are disabled)
    _occlusionBit: number,
    // pre-transformed matrix
    _matrixPretransformed: mat4,
    // translation of pre-transformed matrix
    _positionPretransformed: vec3,
    // instance scale
    _scalePretransformed: number,

    [unknown: string]: unknown,
};

export const SIZEOF_MOBY_INSTANCE = (gn: GN) => {
    switch (gn) {
        case 1: return 0x78;
        case 2:
        case 3: return 0x88;
        case 4: return 0x70;
    };
}
export function readMobyInstance(gn: GN, view: DataViewExt, i: number): MobyInstance {
    switch (gn) {
        case 1: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L58
            (drawDistance is incorrectly a float in the linked code)
            */
            const scale = view.getFloat32(0x1c);
            const position = view.getFloat32_Xyz(0x30);
            const rotation = view.getFloat32_Xyz(0x3c);
            const _matrixPretransformed = mat4.create();
            mat4.fromRotationTranslationScale(_matrixPretransformed,
                quat.fromEuler(quat.create(), rotation.x * (180 / Math.PI), rotation.y * (180 / Math.PI), rotation.z * (180 / Math.PI)),
                vec3.fromValues(position.x, position.y, position.z),
                vec3.fromValues(scale, scale, scale),
            );
            mat4.mul(_matrixPretransformed, noclipSpaceFromRatchetSpace, _matrixPretransformed);
            const _positionPretransformed = mat4.getTranslation(vec3.create(), _matrixPretransformed);
            const _scalePretransformed = vec3.length(vec3.fromValues(_matrixPretransformed[0], _matrixPretransformed[1], _matrixPretransformed[2]));

            return {
                size: view.getInt32(0x0),
                mission: view.getInt32(0x4),
                uid: view.getInt32(0xc),
                oClass: view.getInt32(0x18),
                scale,
                drawDistance: view.getInt32(0x20),
                updateDistance: view.getInt32(0x24),
                position,
                rotation,
                group: view.getInt32(0x48),
                isRooted: view.getInt32(0x4c),
                rootedDistance: view.getFloat32(0x50),
                pvarIndex: view.getInt32(0x58),
                skipOcclusionCheck: view.getInt32(0x5c),
                modeBits: view.getInt32(0x60),
                color: view.getInt32_Rgb(0x64),
                directionalLights: view.getNibbleArray(0x70, 2),

                _i: i,
                _occlusionBit: 0, // populated elsewhere
                _matrixPretransformed,
                _positionPretransformed,
                _scalePretransformed,
            }
        }
        case 2:
        case 3: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L157
            */
            const scale = view.getFloat32(0x2c);
            const position = view.getFloat32_Xyz(0x40);
            const rotation = view.getFloat32_Xyz(0x4c);
            const _matrixPretransformed = mat4.create();
            mat4.fromRotationTranslationScale(_matrixPretransformed,
                quat.fromEuler(quat.create(), rotation.x * (180 / Math.PI), rotation.y * (180 / Math.PI), rotation.z * (180 / Math.PI)),
                vec3.fromValues(position.x, position.y, position.z),
                vec3.fromValues(scale, scale, scale),
            );
            mat4.mul(_matrixPretransformed, noclipSpaceFromRatchetSpace, _matrixPretransformed);
            const _positionPretransformed = mat4.getTranslation(vec3.create(), _matrixPretransformed);
            const _scalePretransformed = vec3.length(vec3.fromValues(_matrixPretransformed[0], _matrixPretransformed[1], _matrixPretransformed[2]));

            return {
                size: view.getInt32(0x0),
                mission: view.getInt32(0x4),
                uid: view.getInt32(0x10),
                bolts: view.getInt32(0x14),
                oClass: view.getInt32(0x28),
                scale,
                drawDistance: view.getInt32(0x30),
                updateDistance: view.getInt32(0x34),
                position,
                rotation,
                group: view.getInt32(0x58),
                isRooted: view.getInt32(0x5c),
                rootedDistance: view.getFloat32(0x60),
                pvarIndex: view.getInt32(0x68),
                skipOcclusionCheck: view.getInt32(0x6c),
                modeBits: view.getInt32(0x70),
                color: view.getInt32_Rgb(0x74), // wrench calls this lightColor, not sure if different from the color field in rac1
                directionalLights: view.getNibbleArray(0x80, 2),

                _i: i,
                _occlusionBit: 0, // populated elsewhere
                _matrixPretransformed,
                _positionPretransformed,
                _scalePretransformed,
            };
        }
        case 4: {
            const scale = view.getFloat32(0x14);
            const position = view.getFloat32_Xyz(0x28);
            const rotation = view.getFloat32_Xyz(0x34);
            const _matrixPretransformed = mat4.create();
            mat4.fromRotationTranslationScale(_matrixPretransformed,
                quat.fromEuler(quat.create(), rotation.x * (180 / Math.PI), rotation.y * (180 / Math.PI), rotation.z * (180 / Math.PI)),
                vec3.fromValues(position.x, position.y, position.z),
                vec3.fromValues(scale, scale, scale),
            );
            mat4.mul(_matrixPretransformed, noclipSpaceFromRatchetSpace, _matrixPretransformed);
            const _positionPretransformed = mat4.getTranslation(vec3.create(), _matrixPretransformed);
            const _scalePretransformed = vec3.length(vec3.fromValues(_matrixPretransformed[0], _matrixPretransformed[1], _matrixPretransformed[2]));

            return {
                size: view.getInt32(0x0),
                mission: view.getInt32(0x4),
                uid: view.getInt32(0x8),
                bolts: view.getInt32(0xc),
                oClass: view.getInt32(0x10),
                scale,
                drawDistance: view.getInt32(0x18),
                updateDistance: view.getInt32(0x1c),
                position,
                rotation,
                group: view.getInt32(0x40),
                isRooted: view.getInt32(0x44),
                rootedDistance: view.getFloat32(0x48),
                pvarIndex: view.getInt32(0x50),
                skipOcclusionCheck: view.getInt32(0x54),
                modeBits: view.getInt32(0x58),
                color: view.getInt32_Rgb(0x5c),
                directionalLights: view.getNibbleArray(0x68, 2),

                _i: i,
                _occlusionBit: 0, // populated elsewhere
                _matrixPretransformed,
                _positionPretransformed,
                _scalePretransformed,
            };
        }
        default: {
            throw new Error("not implemented");
        }
    }
}

export interface ShrubInstance {
    oClass: number,
    drawDistance: number,
    matrix: mat4,
    color: { r: number, g: number, b: number },
    directionalLights: number[],

    // pre-transformed matrix
    _matrixPretransformed: mat4,
    // translation of pre-transformed matrix
    _positionPretransformed: vec3,
    // instance scale
    _scalePretransformed: number,
}
export const SIZEOF_SHRUB_INSTANCE = 0x70;
export function readShrubInstance(view: DataViewExt): ShrubInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L673
    */

    const matrix = view.getMat4Slice(0x10).slice();
    const _matrixPretransformed = matrixToNoclipSpace(matrix);
    const _positionPretransformed = mat4.getTranslation(vec3.create(), _matrixPretransformed);
    const _scalePretransformed = vec3.length(vec3.fromValues(_matrixPretransformed[0], _matrixPretransformed[1], _matrixPretransformed[2]));

    return {
        oClass: view.getInt32(0x0),
        drawDistance: view.getFloat32(0x4),
        matrix,
        color: view.getInt32_Rgb(0x50),
        directionalLights: view.getNibbleArray(0x60, 2),

        _matrixPretransformed,
        _positionPretransformed,
        _scalePretransformed,
    }
}


type InstanceBlock<T> = {
    count: number,
    instances: T[]
}
const SIZEOF_INSTANCE_BLOCK_HEADER = 0x10;
export function readInstanceBlock<T>(view: DataViewExt, instanceSize: number, readerFn: (buf: DataViewExt, i: number) => T): InstanceBlock<T> {
    /*
    struct InstanceBlockHeader<T> {
        // 0x0
        int32 count;
        int32 unknown4;
        int32 pad[2];
        // 0x10
        T instances[count];
    }
    */
    const count = view.getInt32(0);
    const instances = view.subdivide(SIZEOF_INSTANCE_BLOCK_HEADER, count, instanceSize).map((view, i) => readerFn(view, i));
    return {
        count,
        instances,
    }
}

export interface DirectionLightInstance {
    colorA: { r: number, g: number, b: number, a: number },
    directionA: { x: number, y: number, z: number, w: number },
    colorB: { r: number, g: number, b: number, a: number },
    directionB: { x: number, y: number, z: number, w: number },
};
export const SIZEOF_DIRECTION_LIGHT_INSTANCE = 0x40;
export function readDirectionLightInstance(view: DataViewExt): DirectionLightInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_env.inl#L628
    */
    return {
        colorA: view.getFloat32_Rgba(0x0),
        directionA: view.getFloat32_Xyzw(0x10),
        colorB: view.getFloat32_Rgba(0x20),
        directionB: view.getFloat32_Xyzw(0x30),
    }
}

export interface PointLightInstance {
    position: Float32Array,
    radius: number,
    color: { r: number, g: number, b: number },
}
export const SIZEOF_POINT_LIGHT_INSTANCE = 0x20;
export function readPointLightInstance(view: DataViewExt): PointLightInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_env.inl#L628
    */
    return {
        position: view.getVec3Slice(0x0),
        radius: view.getFloat32(0xc),
        color: view.getUint8_Rgb(0x10),
    }
}

export interface PathBlockHeader {
    splineCount: number,
    dataOffset: number,
    dataSize: number,
    pointers: number[],
}
export function readPathBlockHeader(view: DataViewExt): PathBlockHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L357
    struct PathBlock {
        int32 splineCount;
        int32 dataOffset;
        int32 dataSize;
        int32 pad;
        int32 pointers[header.splineCount]; // path data is relative to PathBlock, at dataOffset + pointers[i]
    }
    */
    const splineCount = view.getInt32(0x0);
    return {
        splineCount,
        dataOffset: view.getInt32(0x4),
        dataSize: view.getInt32(0x8),
        pointers: view.getArrayOfNumbers(0x10, splineCount, Uint32Array),
    };
}
export function readGrindPathBlockHeader(view: DataViewExt): PathBlockHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L402
    struct GrindPathBlock {
        int32 splineCount;
        int32 dataOffset;
        int32 dataSize;
        int32 pad;
        struct {
            f32vec4 boundingSphere;
            int32 unknown;
            int32 wrap;
            int32 inactive;
            int32 pad;
        } grindPathData[header.splineCount];
        int32 pointers[header.splineCount];
    }
    */
    const splineCount = view.getInt32(0x0);
    return {
        splineCount,
        dataOffset: view.getInt32(0x4),
        dataSize: view.getInt32(0x8),
        pointers: view.getArrayOfNumbers(0x10 + splineCount * 0x20, splineCount, Uint32Array),
    };
}

export function readPathBlock(view: DataViewExt) {
    const header = readPathBlockHeader(view);
    return header.pointers.map(offset => readSpline(view.subview(header.dataOffset + offset)));
}

export function readGrindPathBlock(view: DataViewExt) {
    const header = readGrindPathBlockHeader(view);
    return header.pointers.map(offset => readSpline(view.subview(header.dataOffset + offset)));
}

export interface Spline {
    count: number,
    points: { x: number, y: number, z: number, w: number }[],
}
export function readSpline(view: DataViewExt): Spline {
    /*
    struct Spline {
        // 0x0
        int32 count;
        // 0x4
        int32 pad[3];
        // 0x10
        f32vec4 points[count];
    }
    */
    const count = view.getInt32(0x0);
    const points = view.subdivide(0x10, count, 0x10).map(view => view.getFloat32_Xyzw(0));
    return {
        count,
        points,
    };
}

export type TieAmbientRgbaBlock = {
    maxCount: number,
    list: {
        tieIndex: number,
        count: number,
        unknown: number,
        ambientRgbas: Uint16Array,
    }[]
};
export function readTieAmbientRgbaBlock(view: DataViewExt): TieAmbientRgbaBlock {
    /*
    struct TieAmbientRgbaBlock {
        int16 tieIndex;
        uint16 count;
        uint16 ambientRgbas[count * 2]; // array of A1BGR5 colors
    }
    */
    const out: TieAmbientRgbaBlock = { maxCount: 0, list: [] };
    while (true) {
        const tieIndex = view.getInt16(0x0);
        if (tieIndex === -1) break;
        const count = view.getUint16(0x2);
        out.list.push({
            tieIndex,
            count,
            unknown: view.getInt32(0x4),
            ambientRgbas: view.subview(8, count * 2 - 4).getTypedArrayView(Uint16Array),
        });
        out.maxCount = Math.max(out.maxCount, count);
        view = view.subview(4 + count * 2);
    }
    return out;
}

export interface OcclusionMappings {
    tfragMappings: Int32Array;
    tieMappings: Int32Array;
    mobyMappings: Int32Array;
}
export const SIZEOF_OCCLUSION_MAPPING = 0x8;
export const OCCLUSION_MAPPING_NONE = 0x1FFFF;
export function readOcclusionMappings(view: DataViewExt): OcclusionMappings {
    /*
    typedef struct {
        // ! this is signed for some reason !
        // the bit to check in the occlusion mask
        int32 bit;
        // the uid of the object
        int32 uid;
    } OcclusionMapping;

    typedef struct {
        uint32 tfrag_count;
        uint32 tie_count;
        uint32 moby_count;
        OcclusionMapping tfrag_mappings[tfrag_count];
        OcclusionMapping tie_mappings[tie_count];
        OcclusionMapping moby_mappings[moby_count];
    } OcclusionMappings;
    */
    const tfragCount = view.getUint32(0x0);
    const tieCount = view.getUint32(0x4);
    const mobyCount = view.getUint32(0x8);

    let ptr = 0x10;
    const tfragMappings = view.subview(ptr, tfragCount * SIZEOF_OCCLUSION_MAPPING).getTypedArrayView(Int32Array);
    ptr += tfragCount * SIZEOF_OCCLUSION_MAPPING;
    const tieMappings = view.subview(ptr, tieCount * SIZEOF_OCCLUSION_MAPPING).getTypedArrayView(Int32Array);
    ptr += tieCount * SIZEOF_OCCLUSION_MAPPING;
    const mobyMappings = view.subview(ptr, mobyCount * SIZEOF_OCCLUSION_MAPPING).getTypedArrayView(Int32Array);
    ptr += mobyCount * SIZEOF_OCCLUSION_MAPPING;

    return {
        tfragMappings,
        tieMappings,
        mobyMappings,
    }
}
