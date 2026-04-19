import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert, nArray } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { TieClass, TieImaginaryGsCommand, TieVertex } from "./structs-core";
import { ImaginaryGsCommandType } from "./utils";

export class TieProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TextureIndex = 1;
    public static a_ST = 2;
    public static a_Normal = 3;
    public static a_LodMorphOffset = 4;

    public static elementsPerVertex = 12; // position (3), texture index (1), st (2), normal (3), morph offset (3)

    public static a_InstanceTransform0 = 5;
    public static a_InstanceTransform1 = 6;
    public static a_InstanceTransform2 = 7;
    public static a_InstanceTransform3 = 8;
    public static a_InstanceAmbientRgba = 9;
    public static a_InstanceDirectionLights = 10;
    public static a_InstanceLodMorphFactor = 11;

    public static elementsPerInstance = 25; // transform (16), ambient (4), lights (4), extra (1)

    public static ub_SceneParams = 0;
    public static ub_TieParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

${nArray(16, i => `
layout(location = ${i}) uniform sampler2D u_Texture${i};
`).join('\n')}
`;

    public override vert = `

layout(location = ${TieProgram.a_Position}) in vec3 a_Position;
layout(location = ${TieProgram.a_TextureIndex}) in float a_TextureIndex;
layout(location = ${TieProgram.a_ST}) in vec2 a_ST;
layout(location = ${TieProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TieProgram.a_LodMorphOffset}) in vec3 a_LodMorphOffset;

layout(location = ${TieProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${TieProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${TieProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${TieProgram.a_InstanceTransform3}) in vec4 a_InstanceTransform3;
layout(location = ${TieProgram.a_InstanceAmbientRgba}) in vec4 a_InstanceAmbientRgba;
layout(location = ${TieProgram.a_InstanceDirectionLights}) in vec4 a_InstanceDirectionLights;
layout(location = ${TieProgram.a_InstanceLodMorphFactor}) in float a_LodMorphFactor;

out vec2 v_ST;
out vec4 v_Rgba;
out vec3 v_Normal;
flat out int v_TextureIndex;


${RatchetShaderLib.LightingFunctions}

void main() {
    vec3 morphedPosition = a_Position + a_LodMorphOffset * a_LodMorphFactor;
    Mat4x4 _instanceTransform = Mat4x4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, a_InstanceTransform3);
    mat4 instanceTransform = UnpackMatrix(_instanceTransform);
    vec4 t_PositionWorld = instanceTransform * vec4(morphedPosition, 1.0f);

    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    v_ST = a_ST;

    vec4 rgba = a_InstanceAmbientRgba.rgba;
    vec4 lights = a_InstanceDirectionLights;
    
    v_Normal = normalize(inverse(transpose(mat3(instanceTransform))) * a_Normal);
    v_Rgba = commonVertexLighting(rgba, v_Normal, lights);
    v_TextureIndex = int(a_TextureIndex);
}

`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}

in vec2 v_ST;
in vec4 v_Rgba;
in vec3 v_Normal;
flat in int v_TextureIndex;

void main() {
    // gross but fast
    ${nArray(16, i => `
            vec4 textureSample${i} = texture(SAMPLER_2D(u_Texture${i}), v_ST);
    `).join('\n')
        }
    ${nArray(16, i => `
            if (v_TextureIndex == ${i}) {
                gl_FragColor = commonFragmentShader(v_Rgba, textureSample${i});
                return;
            }
    `).join('\n')
        }
}
`;

}

export class TieGeometry {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;

    public vertexCount: number;

    constructor(cache: GfxRenderCache, tieOClass: number, tie: TieClass, lodLevel: number) {
        const device = cache.device;

        const vertexData = assembleTieClassGeometry(tieOClass, tie, lodLevel);

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.vertexArrayBuffer.buffer);
        device.setResourceName(this.vertexBuffer, `Tie Class ${tieOClass} (VB)`);

        this.vertexCount = vertexData.vertexCount;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: TieProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: TieProgram.a_TextureIndex, format: GfxFormat.F32_R, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: TieProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 4, bufferIndex: 0, },
                { location: TieProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                { location: TieProgram.a_LodMorphOffset, format: GfxFormat.F32_RGB, bufferByteOffset: 9 * 4, bufferIndex: 0, },
                // per instance
                { location: TieProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceTransform3, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceAmbientRgba, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceDirectionLights, format: GfxFormat.F32_RGBA, bufferByteOffset: 20 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceLodMorphFactor, format: GfxFormat.F32_R, bufferByteOffset: 24 * 4, bufferIndex: 1, },
            ],
            vertexBufferDescriptors: [
                { byteStride: TieProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
                { byteStride: TieProgram.elementsPerInstance * 0x4, frequency: GfxVertexBufferFrequency.PerInstance, },
            ],
            indexBufferFormat: null,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
    }
}

export function assembleTieClassGeometry(tieOClass: number, tie: TieClass, lod: number) {
    const positionScale = tie.scale * (1 / 1024);
    const texcoordScale = 1 / 4096;
    const normalScale = 1 / 0x7FFF;

    const commandLists: TieImaginaryGsCommand[][] = [];
    for (const packet of tie.packets[lod]) commandLists.push(packet.body.commandBuffer);
    const strips = commnadBufferToStrips(tieOClass, commandLists);
    strips.sort((a, b) => a.material - b.material);

    const vertexCount = strips.reduce((a, b) => a + (b.verts.length - 2), 0) * 3;
    const vertexBufferSize = vertexCount * TieProgram.elementsPerVertex;

    const vertexArrayBuffer = new Float32Array(vertexBufferSize);
    let ptr = 0;

    function pushTriangle(verts: { vertex: TieVertex, normalIndex: number }[], material: number) {
        fixTexcoords(verts.map(v => v.vertex));
        for (const vertAndNormalIndex of verts) {
            const vert = vertAndNormalIndex.vertex;
            const normal = tie.normalsData[vertAndNormalIndex.normalIndex];
            vertexArrayBuffer[ptr++] = positionScale * vert.x;
            vertexArrayBuffer[ptr++] = positionScale * vert.y;
            vertexArrayBuffer[ptr++] = positionScale * vert.z;
            vertexArrayBuffer[ptr++] = material;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.s;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.t;
            assert(vert.q === 4096);

            vertexArrayBuffer[ptr++] = normalScale * normal.x;
            vertexArrayBuffer[ptr++] = normalScale * normal.y;
            vertexArrayBuffer[ptr++] = normalScale * normal.z;

            vertexArrayBuffer[ptr++] = positionScale * vert.lodMorphOffsetX;
            vertexArrayBuffer[ptr++] = positionScale * vert.lodMorphOffsetY;
            vertexArrayBuffer[ptr++] = positionScale * vert.lodMorphOffsetZ;
        }
    }

    for (const strip of strips) {
        for (let i = 0; i < strip.verts.length - 2; i++) {
            pushTriangle([strip.verts[i + 0], strip.verts[i + 1], strip.verts[i + 2]], strip.material);
        }
    }

    assert(ptr == vertexArrayBuffer.length);

    return { vertexArrayBuffer, vertexCount };
}

// if ajacent verts have very different texcoords, they're intended to overflow and wrap around
function fixTexcoords(verts: TieVertex[]) {
    let min = 0, max = 0;
    for (const vert of verts) {
        if (vert.s < min) min = vert.s;
        if (vert.s > max) max = vert.s;
    }
    if (max - min > 8 * 4096) {
        for (const vert of verts) {
            if (vert.s < 8 * 4096) vert.s += 16 * 4096;
        }
    }

    min = 0, max = 0;
    for (const vert of verts) {
        if (vert.t < min) min = vert.t;
        if (vert.t > max) max = vert.t;
    }
    if (max - min > 8 * 4096) {
        for (const vert of verts) {
            if (vert.t < 8 * 4096) vert.t += 16 * 4096;
        }
    }
}

function commnadBufferToStrips(tieOClass: number, packets: TieImaginaryGsCommand[][]) {
    type TieStrip = { material: number, windingOrder: number, isFirstStripInPacket: number, verts: { vertex: TieVertex, normalIndex: number }[] };

    let strip: TieStrip | undefined;
    let lastMaterial = null;

    const strips: TieStrip[] = [];

    for (let packetIndex = 0; packetIndex < packets.length; packetIndex++) {
        const packet = packets[packetIndex];
        for (let i = 0; i < packet.length; i++) {
            const command = packet[i];
            switch (command.type) {
                case ImaginaryGsCommandType.PRIMITIVE_RESET: {
                    if (lastMaterial === null) {
                        throw new Error(`Unexpected primative reset before material`);
                    }
                    strip = { material: lastMaterial, windingOrder: command.value.windingOrder, isFirstStripInPacket: i, verts: [] }
                    strips.push(strip);
                    break;
                }
                case ImaginaryGsCommandType.SET_MATERIAL: {
                    lastMaterial = command.value;
                    strip = undefined;
                    break;
                }
                case ImaginaryGsCommandType.VERTEX: {
                    const vert = command.value;
                    if (!strip) {
                        throw new Error(`Unexpected vertex before primative reset`);
                    }
                    strip.verts.push(vert);
                }
            }
        }
    }

    return strips;
}
