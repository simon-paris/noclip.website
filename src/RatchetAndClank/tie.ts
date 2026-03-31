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
layout(location = ${TieProgram.a_Rgba}) in vec4 a_Rgba;

out vec2 v_UV;
out vec4 v_Rgba;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_tieInstances[gl_InstanceID].transform) * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    v_UV = vec2(a_STQ.x, a_STQ.y); // divide by q? seems to not work
    v_Rgba = a_Rgba;
}
`;

    public override frag = `
${TieProgram.Common}
in vec2 v_UV;
in vec4 v_Rgba;

float linearizeDepth(float depth, float near, float far) {
    float z = depth * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - z * (far - near));
}


void main() {
    vec4 tex = texture(SAMPLER_2D(u_Texture), v_UV);
    vec3 texColor = vec3(tex.r, tex.g, tex.b);
    float alpha = tex.a;
    if (alpha < 0.01) {
        discard;
    }
    vec3 surfaceCoolor = texColor;

    float worldDepth = linearizeDepth(1.0 - gl_FragCoord.z, u_NearFarClip.x, u_NearFarClip.y);

    vec3 fogColor = u_FogColor.xyz;
    float nearFogDist = u_FogParams.x;
    float farFogDist = u_FogParams.y;

    float fogFactor = 1.0 - clamp((farFogDist - worldDepth) / (farFogDist - nearFogDist), 0.0, 1.0);
    fogFactor = u_FogParams.z + fogFactor * (u_FogParams.w - u_FogParams.z);

    vec3 finalColor = mix(surfaceCoolor, fogColor, fogFactor);
    gl_FragColor = vec4(finalColor, alpha);
}
`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec2 u_NearFarClip;
    vec4 u_FogColor;
    vec4 u_FogParams; // nearDist, farDist, nearIntensity, farIntensity
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

export function assembleTieClassGeometry(tieOClass: number, tie: TieClass, lod: number) {
    const positionScale = tie.scale * (1 / 1024);
    const texcoordScale = 1 / 4096;

    // TODO: this converts the tri-strips to tri-lists, I'd prefer to render native tri-strips but the renderer doesn't support it

    const commandLists: TiePacketCommand[][] = [];
    for (const packet of tie.packets[lod]) commandLists.push(packet.body.commandBuffer);
    const strips = commnadBufferToStrips(tieOClass, commandLists);
    strips.sort((a, b) => a.material - b.material);

    const expectedSize = strips.reduce((a, b) => a + ((b.verts.length - 2) * 3 * TieGeometry.elementsPerVertex), 0);

    const vertexArrayBuffer = new Float32Array(expectedSize);
    let ptr = 0;

    function fixTexCoords(verts: TieDinkyVertex[]) {
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

    function pushTriangle(verts: TieDinkyVertex[]) {
        fixTexCoords(verts);
        // fixMissingUnknowns(verts);
        for (const vert of verts) {
            vertexArrayBuffer[ptr++] = positionScale * vert.x;
            vertexArrayBuffer[ptr++] = positionScale * vert.y;
            vertexArrayBuffer[ptr++] = positionScale * vert.z;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.s;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.t;
            vertexArrayBuffer[ptr++] = texcoordScale * vert.q; // not working

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

function commnadBufferToStrips(tieOClass: number, packets: TiePacketCommand[][]) {

    let strip: { material: number, verts: TieDinkyVertex[] } | undefined;
    let lastMaterial = null;

    const strips: { material: number, verts: TieDinkyVertex[] }[] = [];

    for (let packetIndex = 0; packetIndex < packets.length; packetIndex++) {
        const packet = packets[packetIndex];
        for (let i = 0; i < packet.length; i++) {
            const command = packet[i];
            switch (command.type) {
                case TiePacketCommandTypes.PRIMITIVE_RESET: {
                    if (lastMaterial === null) {
                        throw new Error(`Unexpected primative reset before material`);
                    }
                    strip = { material: lastMaterial, verts: [] }
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
