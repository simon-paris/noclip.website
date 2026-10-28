import { vec3 } from "gl-matrix";
import { OverlaySection, readWaterMesh_Rac1_L1, SIZEOF_WATER_MESH_DESCRIPTOR } from "./bin-overlay";
import { noclipSpaceFromRatchetSpace } from "./utils";
import { White } from "../Color";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";

export const RAC1_SKY_ROTATION = new Map([
    [9, [{ shell: 3, rotation: { x: 0, y: 0.3, z: 0 } }]], // fixed Ry = 0.3 rad too
]);

const ySpin = (v: number) => ({
    x: 0,
    y: 0,
    z: 2 * Math.PI * 60 * v * 0x100
});

export const RAC1_SKY_ANGULAR_VELOCITY = new Map([
    [0, [{ shell: 3, angularVelocity: ySpin(1 / 0x8000) }]],
    [1, [
        { shell: 2, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 4, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [3, [
        { shell: 1, angularVelocity: ySpin(1 / 0x10000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
    ]],
    [4, [
        { shell: 1, angularVelocity: ySpin(1 / 0x10000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
    ]],
    [5, [{ shell: 1, angularVelocity: ySpin(1 / 50000) }]],
    [7, [{ shell: 2, angularVelocity: ySpin(1 / 50000) }]],
    [8, [{ shell: 1, angularVelocity: ySpin(1 / 40000) }]],
    [9, [{ shell: 3, angularVelocity: ySpin(1 / 25000) }]],
    [10, [
        { shell: 0, angularVelocity: ySpin(1 / (0x20000 * 2)) },
        { shell: 1, angularVelocity: ySpin(1 / (0x20000 * 5)) },
        { shell: 2, angularVelocity: ySpin(1 / (0x40000 * 10)) },
        { shell: 3, angularVelocity: ySpin(1 / (0x20000 * 10)) },
    ]],
    [11, [
        { shell: 1, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [12, [
        { shell: 1, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [14, [
        { shell: 1, angularVelocity: ySpin(1 / 50000) },
        { shell: 2, angularVelocity: ySpin(1 / 100000) },
    ]],
    [16, [
        { shell: 1, angularVelocity: ySpin(1 / 0x40000) },
        { shell: 2, angularVelocity: ySpin(1 / 0x20000) },
        { shell: 3, angularVelocity: ySpin(1 / 0x10000) },
    ]],
    [18, [
        { shell: 4, angularVelocity: ySpin(1 / 40000) },
        { shell: 5, angularVelocity: ySpin(1 / 60000) },
    ]],
]);

export const RAC1_L1_WATER_MESHES = [
    { vaddr: 0x1e2fc0, count: 8 }, // river
    { vaddr: 0x1e3380, count: 2 }, // trench in building
    { vaddr: 0x1fbc80, count: 4 }, // pipe
    { vaddr: 0x202d80, count: 3 }, // cave
];

export function renderWaterMeshes_Rac1(level: number, sections: OverlaySection[], renderHelper: GfxRenderHelper) {
    switch (level) {
        case 1: {
            for (let i = 0; i < RAC1_L1_WATER_MESHES.length; i++) {
                const mesh = RAC1_L1_WATER_MESHES[i];
                for (let j = 0; j < mesh.count; j++) {
                    const waterMesh = readWaterMesh_Rac1_L1(sections, mesh.vaddr + j * SIZEOF_WATER_MESH_DESCRIPTOR, SIZEOF_WATER_MESH_DESCRIPTOR);
                    const positions = waterMesh.positions.subdivide(0, 0xFFFF, 0x10).map(view => view.getFloat32_Xyz(0));

                    for (let k = 0; k < positions.length; k++) {
                        const pos = vec3.fromValues(positions[k].x, positions[k].y, positions[k].z);
                        vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
                        renderHelper.debugDraw.drawLocator(pos, 0.3, White);
                    }
                }
            }
            break;
        }
    }
}
