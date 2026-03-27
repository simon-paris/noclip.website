import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { TieClass, TieDinkyVertex, TiePacketCommand, TiePacketCommandTypes } from "./structs-core";

export const MAX_TIE_INSTANCES = 64;

export class TieProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_STQ = 1;
    public static a_Rgba = 2;

    public static ub_SceneParams = 0;
    public static ub_TieParams = 1;

    public override vert = `
${TieProgram.Common}

layout(location = ${TieProgram.a_Position}) in vec3 a_Position;
layout(location = ${TieProgram.a_STQ}) in vec3 a_STQ;
layout(location = ${TieProgram.a_Rgba}) in float a_Rgba;

out vec2 v_UV;
out float v_Rgba;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_tieInstances[gl_InstanceID].transform) * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    v_UV = vec2(a_STQ.x, a_STQ.y);
    v_Rgba = a_Rgba;
}
`;

    public override frag = `
${TieProgram.Common}
in vec2 v_UV;
in float v_Rgba;

void main() {
    vec4 tex = texture(SAMPLER_2D(u_Texture), v_UV);
    vec3 texColor = vec3(tex.r, tex.g, tex.b);
    float alpha = tex.a;
    if (alpha < 0.01) {
        discard;
    }
    gl_FragColor = vec4(texColor, alpha);
}
`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

struct TieInstance {
    Mat4x4 transform;
};

layout(std140) uniform ub_TieParams {
    TieInstance u_tieInstances[${MAX_TIE_INSTANCES}];
};

layout(location = 0) uniform sampler2D u_Texture;
`;

}

export class TieGeometry {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;

    public static elementsPerVertex = 10; // xyz, stq, rgba
    public static bytesPerElement = 4;

    public draws: { material: number, vertexCount: number }[] = [];

    constructor(cache: GfxRenderCache, tieOClass: number, tie: TieClass, lodLevel: number) {
        const device = cache.device;

        const vertexData = assembleTieClassGeometry(tie, lodLevel);

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.vertexArrayBuffer.buffer);
        device.setResourceName(this.vertexBuffer, `Tie Class ${tieOClass} (VB)`);

        this.draws = vertexData.draws;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                {
                    location: TieProgram.a_Position,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 0,
                    bufferIndex: 0,
                },
                {
                    location: TieProgram.a_STQ,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 3 * 4,
                    bufferIndex: 0,
                },
                {
                    location: TieProgram.a_Rgba,
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 6 * 4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                {
                    byteStride: TieGeometry.elementsPerVertex * TieGeometry.bytesPerElement,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                },
            ],

            indexBufferFormat: null,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
    }
}

export function assembleTieClassGeometry(tie: TieClass, lod: number = 0) {
    const positionScale = tie.scale * (1 / 1024);
    const texcoordScale = 1 / 4096;

    // TODO: this converts the tri-strips to tri-lists, I'd prefer to render native tri-strips but the renderer doesn't support it

    const commandLists: TiePacketCommand[][] = [];
    for (const packet of tie.packets[lod]) commandLists.push(packet.body.commandBuffer);
    const strips = commnadBufferToStrips(commandLists);
    strips.sort((a, b) => a.material - b.material);

    const expectedSize = strips.reduce((a, b) => a + ((b.verts.length - 2) * 3 * TieGeometry.elementsPerVertex), 0);

    const vertexArrayBuffer = new Float32Array(expectedSize);
    let ptr = 0;

    function fixTexcoord(n: number) {
        // while (n < 1) n += 1;
        const extraBits = n & 0xf000 >> 12;
        // return n & 0x1fff;
        while (n > 0x1000) n -= 0x1000;
        return n;
        return n;
    }

    function pushTriangle(verts: TieDinkyVertex[],) {
        for (const vert of verts) {
            vertexArrayBuffer[ptr++] = positionScale * vert.x;
            vertexArrayBuffer[ptr++] = positionScale * vert.y;
            vertexArrayBuffer[ptr++] = positionScale * vert.z;
            vertexArrayBuffer[ptr++] = texcoordScale * fixTexcoord(vert.s);
            vertexArrayBuffer[ptr++] = texcoordScale * fixTexcoord(vert.t);
            vertexArrayBuffer[ptr++] = texcoordScale * vert.q;

            // if (texcoordScale * fixTexcoord(vert.q) !== 1) {
            //     debugger;
            // }

            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
        }
    }

    let draws: { material: number, vertexCount: number }[] = [];

    for (const strip of strips) {
        for (let i = 0; i < strip.verts.length - 2; i++) {
            if (i % 2 === 0) {
                pushTriangle([strip.verts[i + 0], strip.verts[i + 1], strip.verts[i + 2]]);
            } else {
                pushTriangle([strip.verts[i + 0], strip.verts[i + 2], strip.verts[i + 1]]);
            }
        }
        draws.push({ material: strip.material, vertexCount: (strip.verts.length - 2) * 3 });
    }

    // merge adjacent draws with the same material
    for (let i = 0; i < draws.length - 1; i++) {
        const d0 = draws[i]!;
        const d1 = draws[i + 1]!;
        if (d0.material === d1.material) {
            d1.vertexCount += d0.vertexCount;
            d0.vertexCount = 0;
        }
    }
    draws = draws.filter(draw => draw.vertexCount > 0);

    assert(ptr == vertexArrayBuffer.length);

    return { vertexArrayBuffer, draws };
}

function commnadBufferToStrips(packets: TiePacketCommand[][]) {

    const strips: { material: number, verts: TieDinkyVertex[] }[] = [];

    let lastMaterial = 0;
    for (const packet of packets) {
        for (const command of packet) {
            switch (command.type) {
                case TiePacketCommandTypes.PRIMITIVE_RESET: {
                    assert(lastMaterial !== null);
                    strips.push({ material: lastMaterial, verts: [] })
                    break;
                }
                case TiePacketCommandTypes.SET_MATERIAL: {
                    lastMaterial = command.value;
                    break;
                }
                case TiePacketCommandTypes.VERTEX: {
                    const vert = command.value;
                    strips[strips.length - 1].verts.push(vert);
                }
            }
        }
    }

    return strips;
}
