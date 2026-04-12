import { GsPrimitiveType } from "../Common/PS2/GS";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { ShrubClass, ShrubPacketCommand, ShrubPacketCommandTypes, ShrubTexturePrimitive, ShrubVertex } from "./structs-core";

export const MAX_SHRUB_INSTANCES = 32;

export class ShrubProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TS = 2;
    public static a_Rgb = 3;

    public static ub_SceneParams = 0;
    public static ub_ShrubParams = 1;

    public override vert = `
${ShrubProgram.Common}

layout(location = ${ShrubProgram.a_Position}) in vec3 a_Position;
layout(location = ${ShrubProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${ShrubProgram.a_TS}) in vec2 a_TS;

out vec2 v_TS;
out vec3 v_Rgb;
out vec3 v_Normal;
out float v_LodAlpha;

${RatchetShaderLib.LightingFunctions}

void main() {
    mat4 instanceTransform = UnpackMatrix(u_ShrubInstances[gl_InstanceID].transform);
    vec4 t_PositionWorld = instanceTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    vec3 normal = normalize(inverse(transpose(mat3(instanceTransform))) * a_Normal);

    // not sure about dividing by 4
    vec3 rgb = u_ShrubInstancesRgbs[gl_InstanceID].rgb / 4.0;
    vec4 lights = u_ShrubInstancesDirLights[gl_InstanceID];

    v_TS = a_TS.xy;
    v_Rgb = commonVertexLighting(rgb, normal, lights, 1.0);
    v_Normal = normal;
    v_LodAlpha = u_ShrubExtraData[gl_InstanceID].x;
}
`;

    public override frag = `
${ShrubProgram.Common}
in vec2 v_TS;
in vec3 v_Rgb;
in vec3 v_Normal;
in float v_LodAlpha;

${RatchetShaderLib.CommonFragmentShader}

void main() {
    gl_FragColor = commonFragmentShader(vec4(v_Rgb, v_LodAlpha), u_Texture, v_TS);
}

`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

struct ShrubInstance {
    Mat4x4 transform;
};

layout(std140) uniform ub_ShrubParams {
    // this is laid out wierd because chrome got very laggy when I had the color in the ShrubInstance struct
    ShrubInstance u_ShrubInstances[${MAX_SHRUB_INSTANCES}];
    vec4 u_ShrubInstancesRgbs[${MAX_SHRUB_INSTANCES}];
    vec4 u_ShrubInstancesDirLights[${MAX_SHRUB_INSTANCES}]; // 4 dir lights per instance
    vec4 u_ShrubExtraData[${MAX_SHRUB_INSTANCES}]; // x = lodAlpha
};

layout(location = 0) uniform sampler2D u_Texture;
`;

}

export class ShrubGeometry {
    public vertexBuffer: GfxBuffer;
    public vertexCount: number;

    public static elementsPerVertex = 8; // position.xyz, normal.xyz, ts.xy
    public static bytesPerElement = 4;

    public draws: { material: { texture: number, clamp: number }, vertexCount: number }[] = [];

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, shrub: ShrubClass) {
        const device = cache.device;

        const assembled = assembleShrubClassGeometry(shrub);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.vertexData.buffer);
        this.vertexCount = assembled.vertexData.length / ShrubGeometry.elementsPerVertex;

        this.draws = assembled.draws;

        device.setResourceName(this.vertexBuffer, `Shrub Class ${shrub.header.oClass} (VB)`);

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                {
                    location: ShrubProgram.a_Position,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 0,
                    bufferIndex: 0,
                },
                {
                    location: ShrubProgram.a_Normal,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 3 * 4,
                    bufferIndex: 0,
                },
                {
                    location: ShrubProgram.a_TS,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 6 * 4,
                    bufferIndex: 0,
                },
            ],
            vertexBufferDescriptors: [
                {
                    byteStride: ShrubGeometry.elementsPerVertex * ShrubGeometry.bytesPerElement,
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

export function assembleShrubClassGeometry(shrub: ShrubClass) {
    const scale = shrub.header.scale * (1 / 1024);
    const normalScale = 1 / 0x7fff;
    const texcoordScale = 1 / 4096;

    // clean up command lists and sort by material
    const packets = shrub.body.packets.map(commandBufferToTriangles).flat(1);
    packets.sort((a, b) => {
        if (a.material.texture !== b.material.texture) return a.material.texture - b.material.texture;
        return a.material.clamp - b.material.clamp;
    });

    const expectedSize = packets.reduce((a, b) => a + b.vertices.length, 0) * ShrubGeometry.elementsPerVertex;
    const vertexArrayBuffer = new Float32Array(expectedSize);
    let ptr = 0;

    let draws: { material: { texture: number, clamp: number }, vertexCount: number }[] = [];

    for (const { vertices, material } of packets) {
        for (const vertex of vertices) {
            const normal = shrub.body.normals[vertex.n];
            vertexArrayBuffer[ptr++] = scale * vertex.x;
            vertexArrayBuffer[ptr++] = scale * vertex.y;
            vertexArrayBuffer[ptr++] = scale * vertex.z;
            vertexArrayBuffer[ptr++] = normalScale * normal.x;
            vertexArrayBuffer[ptr++] = normalScale * normal.y;
            vertexArrayBuffer[ptr++] = normalScale * normal.z;
            vertexArrayBuffer[ptr++] = texcoordScale * vertex.s;
            vertexArrayBuffer[ptr++] = texcoordScale * vertex.t;
        }
        draws.push({ material, vertexCount: vertices.length });
    }

    // merge adjacent draws with the same material
    for (let i = 0; i < draws.length - 1; i++) {
        const d0 = draws[i]!;
        const d1 = draws[i + 1]!;
        if (d0.material.texture === d1.material.texture && d0.material.clamp === d1.material.clamp) {
            d1.vertexCount += d0.vertexCount;
            d0.vertexCount = 0;
        }
    }
    draws = draws.filter(draw => draw.vertexCount > 0);

    assert(ptr == vertexArrayBuffer.length);

    return { vertexData: vertexArrayBuffer, draws };
}

function commandBufferToTriangles(commandBuffer: ShrubPacketCommand[]) {
    let currentPrimativeType: GsPrimitiveType | null = null;
    let currentMaterial: { texture: number, clamp: number } | null = null;

    const groups: { material: { texture: number, clamp: number }, strip: ShrubVertex[], triangleList: ShrubVertex[] }[] = [];

    for (const command of commandBuffer) {
        switch (command.type) {
            case ShrubPacketCommandTypes.PRIMITIVE: {
                currentPrimativeType = command.value.type;
                if (currentMaterial === null) {
                    throw new Error("Got a primitive reset command before we had a material set");
                }
                groups.push({ material: currentMaterial, strip: [], triangleList: [] });
                break;
            }
            case ShrubPacketCommandTypes.SET_MATERIAL: {
                currentMaterial = {
                    texture: command.value.adGif.tex0.low,
                    clamp: command.value.adGif.clamp.low,
                };
                break;
            }
            case ShrubPacketCommandTypes.VERTEX: {
                if (currentPrimativeType === GsPrimitiveType.TRIANGLE_STRIP) {
                    groups[groups.length - 1].strip.push(command.value);
                } else if (currentPrimativeType === GsPrimitiveType.TRIANGLE) {
                    groups[groups.length - 1].triangleList.push(command.value);
                } else {
                    throw new Error("Unsupported primitive type");
                }
                break;
            }
        }
    }

    return groups.map(group => {
        if (group.strip.length && group.triangleList.length) {
            throw new Error("Can't have both strip and triangle list data in the same primative");
        }
        if (group.strip.length) {
            group.triangleList = stripToTris(group.strip);
            group.strip.length = 0;
        }
        return { material: group.material, vertices: group.triangleList };
    });
}

function stripToTris(strip: ShrubVertex[]) {
    const tris: ShrubVertex[] = [];
    for (let i = 0; i < strip.length - 2; i++) {
        tris.push(strip[i + 0], strip[i + 1], strip[i + 2]);
    }
    return tris;
};
