import { vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { TieClass, TieDinkyVertex, TiePacketCommand, TiePacketCommandTypes } from "./structs-core";

export const MAX_TIE_INSTANCES = 64;

export class TieProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_STQ = 1;
    public static a_Normal = 2;
    public static a_Rgba = 3;
    public static a_LowerLodOffset = 4;

    public static elementsPerVertex = 16; // xyz, stq, normal, rgba, lowerLodOffset

    public static ub_SceneParams = 0;
    public static ub_TieParams = 1;

    public override vert = `
${TieProgram.Common}

layout(location = ${TieProgram.a_Position}) in vec3 a_Position;
layout(location = ${TieProgram.a_STQ}) in vec3 a_STQ;
layout(location = ${TieProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TieProgram.a_Rgba}) in vec4 a_Rgba;
layout(location = ${TieProgram.a_LowerLodOffset}) in vec3 a_LowerLodOffset;

out vec2 v_UV;
out vec4 v_Rgba;
out vec3 v_Normal;


${RatchetShaderLib.LightingFunctions}

void main() {
    mat4 instanceTransform = UnpackMatrix(u_tieInstances[gl_InstanceID].transform);
    vec4 t_PositionWorld = instanceTransform * vec4(a_Position, 1.0f);

    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    v_UV = vec2(a_STQ.x, a_STQ.y) / a_STQ.z;
    
    vec3 normal = normalize(inverse(transpose(mat3(instanceTransform))) * a_Normal);

    vec3 viewDir = normalize(t_PositionWorld.xyz - u_CameraPosWorld);
    if (dot(normal, viewDir) < 0.0) {
        normal = -normal;
    }
    normal *= vec3(-1.0, -1.0, 1.0);
    v_Normal = normal;
    v_Rgba = vec4(commonVertexLighting(a_Rgba.rgb, normal, 0), a_Rgba.a);
}

`;

    public override frag = `
${TieProgram.Common}
${RatchetShaderLib.CommonFragmentShader}

in vec2 v_UV;
in vec4 v_Rgba;
in vec3 v_Normal;

void main() {
    gl_FragColor = commonFragmentShader(v_Rgba, u_Texture, v_UV);
    // gl_FragColor = vec4(v_Normal, 1.0);
}

`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

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

    public draws: { material: number, vertexCount: number }[] = [];

    constructor(cache: GfxRenderCache, tieOClass: number, tie: TieClass, lodLevel: number) {
        const device = cache.device;

        const vertexData = assembleTieClassGeometry(tieOClass, tie, lodLevel);

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
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 3 * 4,
                    bufferIndex: 0,
                },
                {
                    location: TieProgram.a_Normal,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 6 * 4,
                    bufferIndex: 0,
                },
                {
                    location: TieProgram.a_Rgba,
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 9 * 4,
                    bufferIndex: 0,
                },
                {
                    location: TieProgram.a_LowerLodOffset,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 13 * 4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                {
                    byteStride: TieProgram.elementsPerVertex * 0x4,
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

export function assembleTieClassGeometry(tieOClass: number, tie: TieClass, lod: number) {
    const positionScale = tie.scale * (1 / 1024);
    const texcoordScale = 1 / 4096;

    // TODO: this converts the tri-strips to tri-lists, I'd prefer to render native tri-strips but the renderer doesn't support it

    const commandLists: TiePacketCommand[][] = [];
    for (const packet of tie.packets[lod]) commandLists.push(packet.body.commandBuffer);
    const strips = commnadBufferToStrips(tieOClass, commandLists);
    strips.sort((a, b) => a.material - b.material);

    const expectedSize = strips.reduce((a, b) => a + ((b.verts.length - 2) * 3 * TieProgram.elementsPerVertex), 0);

    const vertexArrayBuffer = new Float32Array(expectedSize);
    let ptr = 0;

    function fixTexcoords(verts: TieDinkyVertex[]) {
        // if ajacent verts have very different texcoords, they're probably intended to overflow and wrap around
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

    function getNormal(triVerts: TieDinkyVertex[]) {
        const p1 = vec3.fromValues(triVerts[0].x, triVerts[0].y, triVerts[0].z);
        const p2 = vec3.fromValues(triVerts[1].x, triVerts[1].y, triVerts[1].z);
        const p3 = vec3.fromValues(triVerts[2].x, triVerts[2].y, triVerts[2].z);
        const a = vec3.create();
        vec3.subtract(a, p2, p1);
        const b = vec3.create();
        vec3.subtract(b, p3, p1);
        const normal = vec3.create();
        vec3.cross(normal, a, b);
        vec3.normalize(normal, normal);
        return normal;
    }

    function pushTriangle(verts: TieDinkyVertex[]) {
        fixTexcoords(verts);
        const normal = getNormal(verts);
        for (const vert of verts) {
            vertexArrayBuffer[ptr++] = positionScale * vert.x;
            vertexArrayBuffer[ptr++] = positionScale * vert.y;
            vertexArrayBuffer[ptr++] = positionScale * vert.z;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.s;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.t;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.q;

            vertexArrayBuffer[ptr++] = normal[0];
            vertexArrayBuffer[ptr++] = normal[1];
            vertexArrayBuffer[ptr++] = normal[2];

            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;

            vertexArrayBuffer[ptr++] = positionScale * ((vert as any).unknown0 ?? 0);
            vertexArrayBuffer[ptr++] = positionScale * ((vert as any).unknown2 ?? 0);
            vertexArrayBuffer[ptr++] = positionScale * ((vert as any).unknown4 ?? 0);
        }
    }

    let draws: { material: number, vertexCount: number }[] = [];

    for (const strip of strips) {
        for (let i = 0; i < strip.verts.length - 2; i++) {
            pushTriangle([strip.verts[i + 0], strip.verts[i + 1], strip.verts[i + 2]]);
        }
        draws.push({ material: strip.material, vertexCount: (strip.verts.length - 2) * 3 });
    }

    // merge adjacent draws with the same material
    for (let i = 0; i < draws.length - 1; i++) {
        const d0 = draws[i];
        const d1 = draws[i + 1];
        if (d0.material === d1.material) {
            d1.vertexCount += d0.vertexCount;
            d0.vertexCount = 0;
        }
    }
    draws = draws.filter(draw => draw.vertexCount > 0);

    assert(ptr == vertexArrayBuffer.length);

    return { vertexArrayBuffer, draws };
}

function commnadBufferToStrips(tieOClass: number, packets: TiePacketCommand[][]) {
    type TieStrip = { material: number, windingOrder: number, isFirstStripInPacket: number, verts: TieDinkyVertex[] };

    let strip: TieStrip | undefined;
    let lastMaterial = null;

    const strips: TieStrip[] = [];

    for (let packetIndex = 0; packetIndex < packets.length; packetIndex++) {
        const packet = packets[packetIndex];
        for (let i = 0; i < packet.length; i++) {
            const command = packet[i];
            switch (command.type) {
                case TiePacketCommandTypes.PRIMITIVE_RESET: {
                    if (lastMaterial === null) {
                        throw new Error(`Unexpected primative reset before material`);
                    }
                    strip = { material: lastMaterial, windingOrder: command.value.windingOrder, isFirstStripInPacket: i, verts: [] }
                    strips.push(strip);
                    break;
                }
                case TiePacketCommandTypes.SET_MATERIAL: {
                    lastMaterial = command.value;
                    strip = undefined;
                    break;
                }
                case TiePacketCommandTypes.VERTEX: {
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
