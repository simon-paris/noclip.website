import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { TieClass, TiePacketCommand, TiePacketCommandTypes, TieVertex } from "./structs-core";

export const MAX_TIE_INSTANCES = 64;

export class TieProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_STQ = 1;
    public static a_Normal = 2;
    public static a_Rgba = 3;
    public static a_LodMorphOffset = 4;

    public static elementsPerVertex = 16; // xyz, stq, normal, rgba, lowerLodOffset

    public static ub_SceneParams = 0;
    public static ub_TieParams = 1;

    public override vert = `
${TieProgram.Common}

layout(location = ${TieProgram.a_Position}) in vec3 a_Position;
layout(location = ${TieProgram.a_STQ}) in vec3 a_STQ;
layout(location = ${TieProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TieProgram.a_Rgba}) in vec4 a_Rgba;
layout(location = ${TieProgram.a_LodMorphOffset}) in vec3 a_LodMorphOffset;

out vec2 v_UV;
out vec4 v_Rgba;
out vec3 v_Normal;


${RatchetShaderLib.LightingFunctions}

void main() {
    vec3 morphedPosition = a_Position + a_LodMorphOffset * u_lodMorphFactor[gl_InstanceID].x;
    mat4 instanceTransform = UnpackMatrix(u_tieInstances[gl_InstanceID].transform);
    vec4 t_PositionWorld = instanceTransform * vec4(morphedPosition, 1.0f);

    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    v_UV = vec2(a_STQ.x, a_STQ.y) / a_STQ.z;
    
    v_Normal = normalize(inverse(transpose(mat3(instanceTransform))) * a_Normal);
    v_Rgba = vec4(commonVertexLighting(a_Rgba.rgb, v_Normal, 0), a_Rgba.a);
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
    vec4 u_lodMorphFactor[${MAX_TIE_INSTANCES}]; // only x used
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
                    location: TieProgram.a_LodMorphOffset,
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
    const normalScale = 1 / 0x7FFF;

    const commandLists: TiePacketCommand[][] = [];
    for (const packet of tie.packets[lod]) commandLists.push(packet.body.commandBuffer);
    const strips = commnadBufferToStrips(tieOClass, commandLists);
    strips.sort((a, b) => a.material - b.material);

    const expectedSize = strips.reduce((a, b) => a + ((b.verts.length - 2) * 3 * TieProgram.elementsPerVertex), 0);

    const vertexArrayBuffer = new Float32Array(expectedSize);
    let ptr = 0;

    function fixTexcoords(verts: TieVertex[]) {
        // if ajacent verts have very different texcoords, they're intended to overflow and wrap around
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

    function pushTriangle(verts: { vertex: TieVertex, normalIndex: number }[]) {
        fixTexcoords(verts.map(v => v.vertex));
        for (const vertAndNormalIndex of verts) {
            const vert = vertAndNormalIndex.vertex;
            const normal = tie.normalsData[vertAndNormalIndex.normalIndex];
            vertexArrayBuffer[ptr++] = positionScale * vert.x;
            vertexArrayBuffer[ptr++] = positionScale * vert.y;
            vertexArrayBuffer[ptr++] = positionScale * vert.z;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.s;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.t;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.q;

            vertexArrayBuffer[ptr++] = normalScale * normal.x;
            vertexArrayBuffer[ptr++] = normalScale * normal.y;
            vertexArrayBuffer[ptr++] = normalScale * normal.z;

            // TODO: vertex colors come from instances not classes, also I don't know how to read them
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 0;
            vertexArrayBuffer[ptr++] = 1;

            vertexArrayBuffer[ptr++] = positionScale * vert.lodMorphOffsetX;
            vertexArrayBuffer[ptr++] = positionScale * vert.lodMorphOffsetY;
            vertexArrayBuffer[ptr++] = positionScale * vert.lodMorphOffsetZ;
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
    type TieStrip = { material: number, windingOrder: number, isFirstStripInPacket: number, verts: { vertex: TieVertex, normalIndex: number }[] };

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
