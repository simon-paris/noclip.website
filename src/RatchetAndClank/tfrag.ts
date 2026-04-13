import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { RatchetShaderLib } from "./shader-lib";
import { Tfrag, TfragAdGifs, TfragLight, TfragStrip, TfragVertexInfo } from "./structs-core";

export class TfragProgram extends DeviceProgram {
    // position(3) + normal(3) + rgba(4) + texture(1) + st(2) + debug(4) = 17
    public static elementsPerVertex = 17;
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Rgba = 2;
    public static a_TextureLayer = 3;
    public static a_ST = 4;
    public static a_DirLightIndices = 5;

    // Define the slot index for our uniform parameters. noclip's framework just assigns sequential indices to
    // uniform blocks seen in the shader, in-order, starting with 0.
    public static ub_SceneParams = 0;
    public static ub_TfragParams = 1;

    public override vert = `
${TfragProgram.Common}

layout(location = ${TfragProgram.a_Position}) in vec3 a_Position;
layout(location = ${TfragProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TfragProgram.a_Rgba}) in vec4 a_Rgba;
layout(location = ${TfragProgram.a_TextureLayer}) in float a_TextureLayer;
layout(location = ${TfragProgram.a_ST}) in vec2 a_ST;
layout(location = ${TfragProgram.a_DirLightIndices}) in vec4 a_DirLightIndices;

out vec3 v_Normal;
out vec4 v_Rgba;
out vec2 v_ST;
flat out float v_TextureLayer;

${RatchetShaderLib.LightingFunctions}

void main() {
    mat4 worldTransform = UnpackMatrix(u_WorldFromLocal);
    vec4 t_PositionWorld = worldTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;

    vec3 normal = normalize(inverse(transpose(mat3(worldTransform))) * normalize(a_Normal));
    vec4 lights = a_DirLightIndices;

    v_Rgba = vec4(commonVertexLighting(a_Rgba.rgb, normal, lights, 1.0), a_Rgba.a);

    v_ST = a_ST.xy;
    v_Normal = normal;
    v_TextureLayer = a_TextureLayer;
}
`;

    public override frag = `
${TfragProgram.Common}
${RatchetShaderLib.CommonFragmentShader}

in vec3 v_Normal;
in vec4 v_Rgba;
in vec2 v_ST;
flat in float v_TextureLayer;

void main() {
    gl_FragColor = commonFragmentShader(v_Rgba, texture(SAMPLER_2DArray(u_Texture), vec3(v_ST, v_TextureLayer)));
}
`;

    public static Common = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_TfragParams {
    Mat4x4 u_WorldFromLocal;
};

layout(location = 0) uniform sampler2DArray u_Texture;

`;

}

export class TfragGeometry {
    // array of 3 vertex buffers, one per lod
    public lods: {
        vertexBuffer: GfxBuffer,
        vertexCount: number,
    }[];

    public assembled: ReturnType<typeof assembleTfragGeometry>;

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, private tfrag: Tfrag[]) {
        const device = cache.device;

        const assembled = assembleTfragGeometry(tfrag);
        this.assembled = assembled;

        this.lods = assembled.vertexArrayBuffers.map((lod, i) => {
            const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, lod.buffer.buffer);
            device.setResourceName(vertexBuffer, `Tfrag LOD ${i} (VB)`);

            return {
                vertexBuffer,
                vertexCount: lod.vertexCount,
            };
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
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 6 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_TextureLayer,
                    format: GfxFormat.F32_R,
                    bufferByteOffset: 10 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_ST,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 11 * 0x4,
                    bufferIndex: 0,
                },
                {
                    location: TfragProgram.a_DirLightIndices,
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 13 * 0x4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                {
                    byteStride: TfragProgram.elementsPerVertex * 0x4,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                },
            ],

            indexBufferFormat: null,
        });
    }

    public destroy(device: GfxDevice): void {
        for (const lod of this.lods) {
            device.destroyBuffer(lod.vertexBuffer);
        }
    }
}

type TfragIndexWithTexture = {
    index: number,
    textureLayer: number,
};

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
    s: number,
    t: number,
    light0: number,
    light1: number,
    light2: number,
    light3: number,
}

type TfragVertexWithTexture = TfragVertex & {
    textureLayer: number,
}

export function assembleTfragGeometry(tfrag: Tfrag[]) {
    const assembledTfragsFragments = tfrag.map((t, i) => assembleTfragFragment(i, t));

    const mergedVerts = mergeTfragVerts(assembledTfragsFragments);
    const mergedIndicesWithTextures = [
        mergeGroupsIntoIndexBuffer(assembledTfragsFragments.map(f => f.indices[0]), mergedVerts.tfragVertexBaseIndices),
        mergeGroupsIntoIndexBuffer(assembledTfragsFragments.map(f => f.indices[1]), mergedVerts.tfragVertexBaseIndices),
        mergeGroupsIntoIndexBuffer(assembledTfragsFragments.map(f => f.indices[2]), mergedVerts.tfragVertexBaseIndices),
    ];

    const vertsWithTextures = mergedIndicesWithTextures.map((lod) => {
        return removeIndicesAndAddTextures(mergedVerts.verts, lod);
    });

    const vertexArrayBuffers = vertsWithTextures.map((verts) => {
        return {
            buffer: encodeVerts(verts),
            vertexCount: verts.length,
        };
    });

    return {
        debug: assembledTfragsFragments,
        vertexArrayBuffers,
    };
}

function removeIndicesAndAddTextures(verts: TfragVertex[], indices: TfragIndexWithTexture[]) {
    const newVerts: TfragVertexWithTexture[] = [];
    for (let i = 0; i < indices.length; i++) {
        const idxAndTexture = indices[i];
        const vert = verts[idxAndTexture.index];
        newVerts.push({
            ...vert,
            textureLayer: idxAndTexture.textureLayer,
        });
    }
    return newVerts;
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
        verts: combinedVertexArrayBuffer,
        tfragVertexBaseIndices,
    };
}

function mergeGroupsIntoIndexBuffer(fragmentGroups: TfragTriangleGroup[][], tfragVertexBaseIndices: number[]): TfragIndexWithTexture[] {
    const mergedIndices: TfragIndexWithTexture[] = [];

    // add base index to each fragment
    for (let tfragIndex = 0; tfragIndex < fragmentGroups.length; tfragIndex++) {
        const fragment = fragmentGroups[tfragIndex];
        for (const group of fragment) {
            for (let i = 0; i < group.indices.length; i++) {
                group.indices[i] += tfragVertexBaseIndices[tfragIndex];
            }
        }
    }

    // assemble into draw list
    for (const group of fragmentGroups.flat(1)) {
        for (let i = 0; i < group.indices.length; i++) {
            mergedIndices.push({ index: group.indices[i], textureLayer: group.material });
        }
    }

    return mergedIndices;
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
            s: texcoordScale * info.s,
            t: texcoordScale * info.t,
            light0: light.directionalLights[0],
            light1: light.directionalLights[1],
            light2: light.directionalLights[2],
            light3: light.directionalLights[3],
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

    let stripPtr = 0;
    let vertexPtr = 0;
    let activeMaterial = -1;

    outer: while (true) {
        const strip = strips[stripPtr];
        if (!strip) {
            throw new Error("Ran out of strips");
        }

        switch (strip.endOfPacketFlag) {
            case 0: break; // normal strip
            case -1: break outer; // end
            case -128: break; // end of packet but not end of this tfrag
            default: throw new Error(`Unknown strip flag ${strip.endOfPacketFlag}`);
        }

        let newIndices: number[] = [];
        let vertexCount = strip.vertexCountAndFlag;
        if (vertexCount <= 0) {
            if (strip.adGifOffset === -1) {
                // do nothing
            } else if (strip.adGifOffset >= 0) {
                const localAdGifIndex = strip.adGifOffset / 0x5;
                activeMaterial = adGifs[localAdGifIndex] ? adGifs[localAdGifIndex].tex0.low : -1;
            } else {
                throw new Error(`invalid adGifOffset`);
            }
            vertexCount += 128;
        }
        for (let i = 0; i < vertexCount - 2; i++) {
            newIndices.push(indices[vertexPtr + 0]);
            newIndices.push(indices[vertexPtr + 1]);
            newIndices.push(indices[vertexPtr + 2]);
            vertexPtr++;
        }
        vertexPtr += 2;

        groups.push({ indices: newIndices, baseIndex: 0, material: activeMaterial });

        stripPtr++;
    }

    return groups;
}

function encodeVerts(verts: TfragVertexWithTexture[]) {
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
        vertexArrayBuffer[ptr++] = vert.textureLayer;
        vertexArrayBuffer[ptr++] = vert.s;
        vertexArrayBuffer[ptr++] = vert.t;
        vertexArrayBuffer[ptr++] = vert.light0;
        vertexArrayBuffer[ptr++] = vert.light1;
        vertexArrayBuffer[ptr++] = vert.light2;
        vertexArrayBuffer[ptr++] = vert.light3;
    }

    if (ptr !== vertexArrayBuffer.length) {
        console.warn(`Vertex array buffer wrong length`);
    }

    return vertexArrayBuffer;
}
