import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { RatchetShaderLib } from "./shader-lib";
import { Tfrag, TfragAdGifs, TfragLight, TfragStrip, TfragVertexInfo } from "./structs-core";

export class TfragProgram extends DeviceProgram {
    // position(3) + normal(3) + rgba(4) = 10
    // + repeat for parent vertex = 20
    // + texcoord(2) = 22
    public static elementsPerVertex = 22;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Rgba = 2;
    public static a_ParentPosition = 3;
    public static a_ParentNormal = 4;
    public static a_ParentRgba = 5;
    public static a_TS = 6;

    // Define the slot index for our uniform parameters. noclip's framework just assigns sequential indices to
    // uniform blocks seen in the shader, in-order, starting with 0.
    public static ub_SceneParams = 0;
    public static ub_TfragParams = 1;

    public override vert = `
${TfragProgram.Common}

layout(location = ${TfragProgram.a_Position}) in vec3 a_Position;
layout(location = ${TfragProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TfragProgram.a_Rgba}) in vec4 a_Rgba;
layout(location = ${TfragProgram.a_ParentPosition}) in vec3 a_ParentPosition;
layout(location = ${TfragProgram.a_ParentNormal}) in vec3 a_ParentNormal;
layout(location = ${TfragProgram.a_ParentRgba}) in vec4 a_ParentRgba;
layout(location = ${TfragProgram.a_TS}) in vec2 a_TS;

out vec3 v_Normal;
out vec4 v_Rgba;
out vec2 v_TS;

${RatchetShaderLib.LightingFunctions}

void main() {
    mat4 worldTransform = UnpackMatrix(u_WorldFromLocal);
    vec4 t_PositionWorld = worldTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;

    vec3 normal = normalize(inverse(transpose(mat3(worldTransform))) * a_Normal);
    v_Rgba = vec4(commonVertexLighting(a_Rgba.rgb, normal, 0), a_Rgba.a);

    v_TS = a_TS.xy;
    v_Normal = normal;
}
`;

    public override frag = `
${TfragProgram.Common}
${RatchetShaderLib.CommonFragmentShader}

in vec3 v_Normal;
in vec4 v_Rgba;
in vec2 v_TS;

void main() {
    gl_FragColor = commonFragmentShader(v_Rgba, u_Texture, v_TS);
    // gl_FragColor = vec4(v_Normal, 1.0);
}
`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_TfragParams {
    Mat4x4 u_WorldFromLocal;
};

layout(location = 0) uniform sampler2D u_Texture;

`;

}

export class TfragGeometry {
    public vertexBuffer: GfxBuffer;

    // array of 3 index buffers, one per lod
    public lods: {
        indexBuffer: GfxBuffer,
        draws: { material: number, startIndex: number, indexCount: number }[],
        totalIndexCount: number,
    }[];

    public assembled: ReturnType<typeof assembleTfragGeometry>;

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, private tfrag: Tfrag[]) {
        const device = cache.device;

        const assembled = assembleTfragGeometry(tfrag);
        this.assembled = assembled;
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.verts.buffer);
        device.setResourceName(this.vertexBuffer, `Tfrag (VB)`);

        this.lods = assembled.indices.map(({ indices, draws }, i) => {
            const indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
            device.setResourceName(indexBuffer, `Tfrag LOD ${i} (IB)`);
            const totalIndexCount = indices.length;
            return { indexBuffer, draws, totalIndexCount };
        });

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                {
                    location: TfragProgram.a_Position,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 0,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_Normal,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 3 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_Rgba,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 6 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_ParentPosition,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 10 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_ParentNormal,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 13 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_ParentRgba,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 16 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_TS,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 20 * 0x4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                {
                    byteStride: TfragProgram.elementsPerVertex * 0x4,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                },
            ],

            indexBufferFormat: GfxFormat.U32_R,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        for (const lod of this.lods) {
            device.destroyBuffer(lod.indexBuffer);
        }
    }
}

type TfragVertex = {
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
    a: number,
    parent: {
        x: number,
        y: number,
        z: number,
    } | null,
    s: number,
    t: number,
}

export function assembleTfragGeometry(tfrag: Tfrag[]) {
    const assembledTfragsFragments = tfrag.map((t, i) => assembleTfragFragment(i, t));

    const mergedVerts = mergeTfragVerts(assembledTfragsFragments);
    const mergedIndicesAndDraws = [
        mergeGroupsIntoIndexBuffer(assembledTfragsFragments.map(f => f.indices[0]), mergedVerts.tfragVertexBaseIndices),
        mergeGroupsIntoIndexBuffer(assembledTfragsFragments.map(f => f.indices[1]), mergedVerts.tfragVertexBaseIndices),
        mergeGroupsIntoIndexBuffer(assembledTfragsFragments.map(f => f.indices[2]), mergedVerts.tfragVertexBaseIndices),
    ];

    return {
        verts: mergedVerts.verts,
        indices: mergedIndicesAndDraws,
    };
}

function mergeTfragVerts(tfrags: ReturnType<typeof assembleTfragFragment>[]) {
    const combinedVertexArrayBuffer: TfragVertex[] = [];
    const tfragVertexBaseIndices: number[] = [];

    let vertexPtr = 0;
    for (const tfrag of tfrags) {
        combinedVertexArrayBuffer.push(...tfrag.verts);
        tfragVertexBaseIndices.push(vertexPtr);
        vertexPtr += tfrag.verts.length;
    }

    return {
        unencodedVerts: combinedVertexArrayBuffer,
        verts: encodeVerts(combinedVertexArrayBuffer),
        tfragVertexBaseIndices,
    };
}

function mergeGroupsIntoIndexBuffer(fragmentGroups: TfragTriangleGroup[][], tfragVertexBaseIndices: number[]) {
    const mergedIndices: number[] = [];
    let draws: { material: number, startIndex: number, indexCount: number }[] = [];

    // add base index to each fragment
    for (let tfragIndex = 0; tfragIndex < fragmentGroups.length; tfragIndex++) {
        const fragment = fragmentGroups[tfragIndex];
        for (const group of fragment) {
            for (let i = 0; i < group.indices.length; i++) {
                group.indices[i] += tfragVertexBaseIndices[tfragIndex];
            }
        }
    }

    // sort
    const sorted = fragmentGroups.flat(1).sort((a, b) => a.material - b.material);

    // assemble into draw list
    for (const group of sorted) {
        draws.push({
            material: group.material,
            startIndex: mergedIndices.length,
            indexCount: group.indices.length,
        });
        for (let i = 0; i < group.indices.length; i++) {
            mergedIndices.push(group.indices[i]);
        }
    }

    // merge adjacent draws with the same material
    for (let i = 0; i < draws.length - 1; i++) {
        const d0 = draws[i]!;
        const d1 = draws[i + 1]!;
        if (d0.material === d1.material) {
            d1.indexCount += d0.indexCount;
            d1.startIndex = d0.startIndex;
            d0.indexCount = 0;
        }
    }
    draws = draws.filter(draw => draw.indexCount > 0);

    return {
        indices: new Uint32Array(mergedIndices),
        draws
    };
}

export function assembleTfragFragment(tfragId: number, tfrag: Tfrag) {
    const verts = concatAndRemoveDoubleIndirectionFromVertices(tfragId, tfrag);

    const lod2Indices = stripsIntoTriangles(tfragId, tfrag.lod2Strips.data, tfrag.lod2Indices.data, tfrag.commonTextures.data);
    const lod1Indices = stripsIntoTriangles(tfragId, tfrag.lod1Strips.data, tfrag.lod1Indices.data, tfrag.commonTextures.data);
    const lod0Indices = stripsIntoTriangles(tfragId, tfrag.lod0Strips.data, tfrag.lod0Indices.data, tfrag.commonTextures.data);

    return {
        verts: verts,
        indices: [
            lod0Indices,
            lod1Indices,
            lod2Indices,
        ],
    };
}

/**
 * Tfrags have 3 LODs, each LOD has it's own set of indices but they share vertices.
 * The vertices of each lod is concatted together, high lods can reference vertices used in lower lods.
 * 
 * The index buffer actually points into the VertexInfo array, and VertexInfo points into the vertex array, and each VertexInfo also
 * optionally points to a parent vertex from a lower lod.
 * 
 * If a vertex has a parent, it can be lerped between the vertex position and parent position to transition between LODs.
 * 
 * This function concatenates the 3 info/vertex arrays, and flattens the parent positions into the vertex array.
 * So after this, the index buffers point directly into the vertex array.
 * 
 * Also, this function moves all the vertex positions to world space.
 */
function concatAndRemoveDoubleIndirectionFromVertices(tfragId: number, tfrag: Tfrag) {
    const basePosition = { x: tfrag.basePosition[0], y: tfrag.basePosition[1], z: tfrag.basePosition[2] };
    const positionScale = 1 / 1024;
    const texcoordScale = 1 / 4096;

    let tfragInfo: TfragVertexInfo[] = [];
    for (const info of tfrag.commonVertexInfo.data ?? []) {
        tfragInfo.push(info);
    }
    for (const info of tfrag.lod01VertexInfo?.data ?? []) {
        tfragInfo.push(info);
    }
    for (const info of tfrag.lod0VertexInfo?.data ?? []) {
        tfragInfo.push(info);
    }
    let tfragVerts: { x: number, y: number, z: number }[] = [];
    for (const position of tfrag.commonPositions.data ?? []) {
        tfragVerts.push(position);
    }
    for (const position of tfrag.lod01Positions?.data ?? []) {
        tfragVerts.push(position);
    }
    for (const position of tfrag.lod0Positions?.data ?? []) {
        tfragVerts.push(position);
    }

    return tfragInfo.map<TfragVertex>((info) => {
        const idx = info.vertex / 2;
        const position = tfragVerts[idx];
        const rgba = tfrag.rgbas[idx];
        const light = tfrag.lights[idx];
        const normal = lightToNormal(light);
        const parentPosition = info.parent !== 0x1000 ? tfragVerts[idx] : null;
        return {
            tfragId,
            x: positionScale * (basePosition.x + position.x),
            y: positionScale * (basePosition.y + position.y),
            z: positionScale * (basePosition.z + position.z),
            nx: normal.x,
            ny: normal.y,
            nz: normal.z,
            r: rgba.r / 255,
            g: rgba.g / 255,
            b: rgba.b / 255,
            a: Math.max(1, (rgba.a * 2) / 255), // alpha values are 0x0 - 0x80
            parent: parentPosition ? {
                x: positionScale * (basePosition.x + parentPosition.x),
                y: positionScale * (basePosition.y + parentPosition.y),
                z: positionScale * (basePosition.z + parentPosition.z),
            } : null,
            s: texcoordScale * info.s,
            t: texcoordScale * info.t,
        };
    });
}

function lightToNormal(light: TfragLight) {
    const angleScale = Math.PI / 128;

    const azimuth = light.azimuth * angleScale;
    const elevation = light.elevation * angleScale;
    const cosAzimuth = Math.cos(azimuth);
    const sinAzimuth = Math.sin(azimuth);
    const cosElevation = Math.cos(elevation);
    const sinElevation = Math.sin(elevation);

    return {
        x: cosAzimuth * cosElevation,
        y: sinAzimuth * cosElevation,
        z: sinElevation,
    };
}


type TfragTriangleGroup = {
    material: number,
    baseIndex: number,
    indices: number[],
}

function stripsIntoTriangles(tfragId: number, strips: TfragStrip[], indices: Uint8Array, adGifs: TfragAdGifs[]): TfragTriangleGroup[] {
    const groups: TfragTriangleGroup[] = [];

    let activeMaterial = -1;
    let stripStart = 0;
    for (const strip of strips) {
        let newIndices: number[] = [];
        let vertexCount = strip.vertexCountAndFlag;
        if (vertexCount <= 0) {
            if (vertexCount === 0) {
                break;
            } else if (strip.adGifOffset >= 0) {
                const localAdGifIndex = strip.adGifOffset / 0x5;
                activeMaterial = adGifs[localAdGifIndex] ? adGifs[localAdGifIndex].tex0.low : -1;
            }
            vertexCount += 128;
        }
        for (let i = 0; i < vertexCount - 2; i++) {
            newIndices.push(indices[stripStart + i + 0]);
            newIndices.push(indices[stripStart + i + 1]);
            newIndices.push(indices[stripStart + i + 2]);
        }
        stripStart += vertexCount;
        groups.push({ indices: newIndices, baseIndex: 0, material: activeMaterial });
    }

    return groups;
}

function encodeVerts(verts: TfragVertex[]) {
    const vertexArrayBuffer = new Float32Array(verts.length * TfragProgram.elementsPerVertex);
    let ptr = 0;
    for (const vert of verts) {
        vertexArrayBuffer[ptr++] = vert.x;
        vertexArrayBuffer[ptr++] = vert.y;
        vertexArrayBuffer[ptr++] = vert.z;
        vertexArrayBuffer[ptr++] = vert.nx;
        vertexArrayBuffer[ptr++] = vert.ny;
        vertexArrayBuffer[ptr++] = vert.nz;
        vertexArrayBuffer[ptr++] = vert.r;
        vertexArrayBuffer[ptr++] = vert.g;
        vertexArrayBuffer[ptr++] = vert.b;
        vertexArrayBuffer[ptr++] = vert.a;

        vertexArrayBuffer[ptr++] = vert.parent ? vert.parent.x : vert.x;
        vertexArrayBuffer[ptr++] = vert.parent ? vert.parent.y : vert.y;
        vertexArrayBuffer[ptr++] = vert.parent ? vert.parent.z : vert.z;
        vertexArrayBuffer[ptr++] = 0; // parent normal missing
        vertexArrayBuffer[ptr++] = 0;
        vertexArrayBuffer[ptr++] = 0;
        vertexArrayBuffer[ptr++] = 0; // parent rgba missing
        vertexArrayBuffer[ptr++] = 0;
        vertexArrayBuffer[ptr++] = 0;
        vertexArrayBuffer[ptr++] = 0;

        vertexArrayBuffer[ptr++] = vert.s;
        vertexArrayBuffer[ptr++] = vert.t;
    }

    if (ptr !== vertexArrayBuffer.length) {
        console.warn(`Vertex array buffer wrong length`);
    }

    return vertexArrayBuffer;
}
