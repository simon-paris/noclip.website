import { assert } from "../util";
import { DataViewExt } from "./DataViewExt";

export interface OverlaySectionHeader {
    addr: number;
    size: number;
    type: number;
    entry: number;
}
export function readOverlaySectionHeader(view: DataViewExt) {
    return {
        addr: view.getUint32(0x0),
        size: view.getUint32(0x4),
        type: view.getUint32(0x8),
        entry: view.getUint32(0xC),
    }
}

export interface OverlaySection {
    header: OverlaySectionHeader;
    data: DataViewExt;
}
export function readOverlaySections(view: DataViewExt): OverlaySection[] {
    const sections: OverlaySection[] = [];
    let offset = 0;
    while (offset < view.byteLength) {
        const header = readOverlaySectionHeader(view.subview(offset));
        const data = view.subview(offset + 0x10, header.size);
        sections.push({ header, data });
        offset += 0x10 + header.size;
    }
    return sections;
}

export function readOverlayVMem(sections: OverlaySection[], addr: number, size: number): DataViewExt {
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (addr >= section.header.addr && addr + size <= section.header.addr + section.header.size) {
            const offset = addr - section.header.addr;
            return section.data.subview(offset, size);
        }
    }
    assert(false);
}

export interface WaterMesh_Rac1_L1 {
    descriptor: ReturnType<typeof readWaterMeshDescriptor_Rac1_L1>;
    positions: DataViewExt;
    uvs: DataViewExt;
}
export function readWaterMesh_Rac1_L1(sections: OverlaySection[], addr: number, size: number): WaterMesh_Rac1_L1 {
    const descriptor = readWaterMeshDescriptor_Rac1_L1(readOverlayVMem(sections, addr, size));
    const positions = readOverlayVMem(sections, descriptor.verticesVaddr, descriptor.vertexCount * 4 * 4);
    const uvs = readOverlayVMem(sections, descriptor.uvsVaddr, descriptor.vertexCount * 4 * 2);
    return { descriptor, positions, uvs };
}

export const SIZEOF_WATER_MESH_DESCRIPTOR = 0x60;
export function readWaterMeshDescriptor_Rac1_L1(view: DataViewExt) {
    return {
        verticesVaddr: view.getUint32(0x0),
        uvsVaddr: view.getUint32(0x4),
        boundsSphereVaddr: view.getUint32(0x8),
        vertexCount: view.getInt32(0xC),
        scrollSpeed: [view.getFloat32(0x10), view.getFloat32(0x14)],
        wobbleAmplitude: view.getFloat32(0x18),
        phaseStep: view.getInt32(0x1C),
        direction1: view.getFloat32_Xy(0x20),
        direction2: view.getFloat32_Xy(0x28),
        rgba: view.getUint32(0x30),
        fxTextures: [view.getInt32(0x34), view.getInt32(0x38)],
        fix: [view.getUint8(0x3C), view.getUint8(0x3D)],
        runtimeScroll1: view.getFloat32_Xy(0x40),
        runtimeScroll2: view.getFloat32_Xy(0x48),
        phase: view.getInt32(0x50),
        zBlend: view.getFloat32(0x5C),
    }
}
