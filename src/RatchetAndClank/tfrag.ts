import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { Tfrag, TfragAdGifs, TfragLight, TfragStrip, TfragVertexInfo } from "./structs-core";
import { PaletteTexture } from "./textures";

export class TfragProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Rgba = 2;
    public static a_TextureLayer = 3;
    public static a_ST = 4;
    public static a_DirLightIndices = 5;

    public static elementsPerVertex = 17; // position(3) + normal(3) + rgba(4) + texture(1) + st(2) + lights(4) = 17

    public static ub_SceneParams = 0;
    public static ub_TfragParams = 1;

    public override both = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_TfragParams {
    Mat4x4 u_WorldFromLocal;
};

layout(location = 0) uniform sampler2DArray u_Texture;

`;

    public override vert = `

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

    v_Rgba = commonVertexLighting(a_Rgba, normal, lights);

    v_ST = a_ST.xy;
    v_Normal = normal;
    v_TextureLayer = a_TextureLayer;
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}

in vec3 v_Normal;
in vec4 v_Rgba;
in vec2 v_ST;
flat in float v_TextureLayer;

void main() {
    gl_FragColor = commonFragmentShader(v_Rgba, texture(SAMPLER_2DArray(u_Texture), vec3(v_ST, v_TextureLayer)));
}
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

    constructor(cache: GfxRenderCache, private tfrags: Tfrag[], private tfragTextures: PaletteTexture[]) {
        const device = cache.device;

        const assembled = assembleTfragGeometry(tfrags, tfragTextures);
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
                { location: TfragProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: TfragProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_Rgba, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_TextureLayer, format: GfxFormat.F32_R, bufferByteOffset: 10 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 11 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_DirLightIndices, format: GfxFormat.F32_RGBA, bufferByteOffset: 13 * 0x4, bufferIndex: 0, },
            ],
            vertexBufferDescriptors: [
                { byteStride: TfragProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
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

export function assembleTfragGeometry(tfrags: Tfrag[], tfragTextures: PaletteTexture[]) {
    // `tfrags[tfragIdx][lodLevel][strip]`
    const assembledTfragsFragments = tfrags.map((t, i) => assembleTfragFragment(i, t));

    // merge all fragments into `everything[lodLevel][strip]`
    const mergedTfragLods = [
        assembledTfragsFragments.map(f => f[0]).flat(1),
        assembledTfragsFragments.map(f => f[1]).flat(1),
        assembledTfragsFragments.map(f => f[2]).flat(1),
    ];

    // merge strips
    const vertexArrayBuffers = mergedTfragLods.map((groups) => {
        const sorted = sortTransparent(groups, tfragTextures);
        const flat = flattenTfragVerts(sorted);
        const buffer = encodeVerts(flat);
        return {
            buffer,
            vertexCount: flat.length,
        };
    });

    return {
        debug: assembledTfragsFragments,
        vertexArrayBuffers,
    };
}

// build verts and indices for a single tfrag
export function assembleTfragFragment(tfragId: number, tfrag: Tfrag) {
    const verts = concatAndRemoveDoubleIndirectionFromVertices(tfragId, tfrag);

    // [lod2, lod1, lod0]
    const vertsByLod = [
        stripsIntoTriangles(tfragId, tfrag.dataGroup5.lod0.strips, tfrag.dataGroup5.lod0.indices, tfrag.dataGroup2.textures, verts),
        stripsIntoTriangles(tfragId, tfrag.dataGroup3.lod1.strips, tfrag.dataGroup3.lod1.indices, tfrag.dataGroup2.textures, verts),
        stripsIntoTriangles(tfragId, tfrag.dataGroup1.lod2.strips, tfrag.dataGroup1.lod2.indices, tfrag.dataGroup2.textures, verts),
    ];

    return vertsByLod;
}

// takes triangle lists and flattens them into one
function flattenTfragVerts(triangleGroups: TfragTriangleGroup[]) {
    const result: TfragVertexWithTexture[] = [];
    for (let i = 0; i < triangleGroups.length; i++) {
        const group = triangleGroups[i];
        for (let j = 0; j < group.verts.length; j++) {
            const vert = group.verts[j];
            result.push({
                ...vert,
                textureLayer: group.material,
            });
        }
    }
    return result;
}

// move transparent groups to the end
export function sortTransparent(groups: TfragTriangleGroup[], tfragTextures: PaletteTexture[]) {
    groups.sort((a, b) => {
        const aTransparent = tfragTextures[a.material].hasAlpha;
        const bTransparent = tfragTextures[b.material].hasAlpha;
        if (aTransparent && !bTransparent) return 1;
        if (!aTransparent && bTransparent) return -1;
        return 0;
    });
    return groups;
}

/**
 * Tfrags have 3 LODs, each LOD has it's own set of indices but they share vertices.
 * The vertices of each lod is concatted together, high lods can reference vertices used in lower lods.
 * 
 * The index buffer actually points into the VertexInfo array, and VertexInfo points into the vertex array, and each VertexInfo also
 * optionally points to a parent vertex from a lower lod.
 * 
 * This function concatenates the 3 info/vertex arrays, and flattens the parent positions into the vertex array.
 * So after this, the index buffers point directly into the vertex array.
 * 
 * Also, this function moves all the vertex positions to world space.
 */
function concatAndRemoveDoubleIndirectionFromVertices(tfragId: number, tfrag: Tfrag): TfragVertex[] {
    const basePosition = { x: tfrag.dataGroup2.basePosition[0], y: tfrag.dataGroup2.basePosition[1], z: tfrag.dataGroup2.basePosition[2] };
    const positionScale = 1 / 1024;
    const texcoordScale = 1 / 4096;
    const colorScale = 1 / 0x80;

    const tfragInfo = new Array<TfragVertexInfo>().concat(
        tfrag.dataGroup2.vertexInfoPart1,
        tfrag.dataGroup4.vertexInfoPart2,
        tfrag.dataGroup5.vertexInfoPart3,
    );
    const tfragVerts = new Array<{ x: number, y: number, z: number }>().concat(
        tfrag.dataGroup2.vertexPositionsPart1,
        tfrag.dataGroup4.vertexPositionsPart2,
        tfrag.dataGroup5.vertexPositionsPart3,
    );

    const result = new Array<TfragVertex>();
    for (let i = 0; i < tfragInfo.length; i++) {
        const info = tfragInfo[i];
        const idx = info.vertex / 2;
        const position = tfragVerts[idx];
        const rgba = tfrag.rgbas[idx];
        const light = tfrag.lights[idx];
        const normal = lightToNormal(light);
        result.push({
            x: positionScale * (basePosition.x + position.x),
            y: positionScale * (basePosition.y + position.y),
            z: positionScale * (basePosition.z + position.z),
            nx: normal.x,
            ny: normal.y,
            nz: normal.z,
            r: colorScale * rgba.r,
            g: colorScale * rgba.g,
            b: colorScale * rgba.b,
            a: colorScale * rgba.a,
            s: texcoordScale * info.s,
            t: texcoordScale * info.t,
            light0: light.directionalLights[0],
            light1: light.directionalLights[1],
            light2: light.directionalLights[2],
            light3: light.directionalLights[3],
        })
    }
    return result;
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
    indices: number[],
    verts: TfragVertex[],
}

// decode the strips into triangle lists, grouped by material
function stripsIntoTriangles(tfragId: number, strips: TfragStrip[], indices: Uint8Array, adGifs: TfragAdGifs[], verts: TfragVertex[]): TfragTriangleGroup[] {
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
            case 0x80: break; // end of packet but not end of this tfrag
            case 0xFF: break outer; // end
            default: throw new Error(`Unknown strip flag`);
        }

        let newIndices: number[] = [];
        let newVerts: TfragVertex[] = [];

        let vertexCount = strip.vertexCount;
        if (strip.hasAdGifFlag) {
            if (strip.adGifOffset === -1) {
                // do nothing
            } else if (strip.adGifOffset >= 0) {
                const localAdGifIndex = strip.adGifOffset / 0x5;
                activeMaterial = adGifs[localAdGifIndex] ? adGifs[localAdGifIndex].tex0.low : -1;
            } else {
                throw new Error(`invalid adGifOffset`);
            }
        }
        for (let i = 0; i < vertexCount - 2; i++) {
            newIndices.push(indices[vertexPtr + 0]);
            newIndices.push(indices[vertexPtr + 1]);
            newIndices.push(indices[vertexPtr + 2]);
            newVerts.push(verts[indices[vertexPtr + 0]]);
            newVerts.push(verts[indices[vertexPtr + 1]]);
            newVerts.push(verts[indices[vertexPtr + 2]]);
            vertexPtr++;
        }
        vertexPtr += 2;

        groups.push({ indices: newIndices, verts: newVerts, material: activeMaterial });

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
    assert(ptr === vertexArrayBuffer.length);
    return vertexArrayBuffer;
}
