import { GsPrimitiveType } from "../Common/PS2/GS";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { ShrubClass, ShrubPacketCommand, ShrubPacketCommandTypes, ShrubTexturePrimitive, ShrubVertex, TieClass, TieDinkyVertex, TiePacketCommandTypes } from "./structs-core";

export const MAX_SHRUB_INSTANCES = 128;

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
out vec3 v_Normal;
out vec3 v_Rgb;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_shrubInstances[gl_InstanceID].transform) * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    v_TS = a_TS.xy;
    v_Normal = a_Normal;
    v_Rgb = u_shrubInstancesRgbs[gl_InstanceID].rgb;
}
`;

    public override frag = `
${ShrubProgram.Common}
in vec2 v_TS;
in vec3 v_Normal;
in vec3 v_Rgb;

void main() {
    vec4 texColor = texture(u_Texture, vec2(v_TS.x, v_TS.y));
    float alpha = min(texColor.a * 2.0, 1.0);
    // if (alpha < 0.01) {
    //     discard;
    // }
    vec3 shading = vec3(abs(v_Normal.x + v_Normal.y + v_Normal.z) / 10.f);
    // gl_FragColor = vec4(v_Rgb, alpha); // not working
    gl_FragColor = vec4(texColor.rgb - shading, alpha);
}
`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

struct ShrubInstance {
    Mat4x4 transform;
};

layout(std140) uniform ub_ShrubParams {
    // this is laid out wierd because chrome got very laggy when I had the color in the ShrubInstance struct
    ShrubInstance u_shrubInstances[${MAX_SHRUB_INSTANCES}];
    vec4 u_shrubInstancesRgbs[${MAX_SHRUB_INSTANCES}];
};

layout(location = 0) uniform sampler2D u_Texture;
`;

}

export class ShrubGeometry {
    public vertexBuffer: GfxBuffer;
    public vertexCount: number;

    public static elementsPerVertex = 8; // position.xyz, normal.xyz, ts.xy
    public static bytesPerElement = 4;

    public draws: { material: number, vertexCount: number }[] = [];

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

    // TODO: sort by material id
    const packets = shrub.body.packets.map(commandBufferToTriangles).flat(1);

    const expectedSize = packets.reduce((a, b) => a + b.vertices.length, 0) * ShrubGeometry.elementsPerVertex;
    const vertexArrayBuffer = new Float32Array(expectedSize);
    let ptr = 0;

    let draws: { material: number, vertexCount: number }[] = [];

    function fixTexcoord(n: number) {
        while (n > 0x1000) n -= 0x1000;
        return n;
    }

    for (const { vertices, material } of packets) {
        for (const vertex of vertices) {
            const normal = shrub.body.normals[vertex.n];
            vertexArrayBuffer[ptr++] = scale * vertex.x;
            vertexArrayBuffer[ptr++] = scale * vertex.y;
            vertexArrayBuffer[ptr++] = scale * vertex.z;
            vertexArrayBuffer[ptr++] = normalScale * normal.x;
            vertexArrayBuffer[ptr++] = normalScale * normal.y;
            vertexArrayBuffer[ptr++] = normalScale * normal.z;
            vertexArrayBuffer[ptr++] = texcoordScale * fixTexcoord(vertex.s);
            vertexArrayBuffer[ptr++] = texcoordScale * fixTexcoord(vertex.t);
        }
        draws.push({ material: material.tex0.low, vertexCount: vertices.length });
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

    return { vertexData: vertexArrayBuffer, draws };
}

function commandBufferToTriangles(commandBuffer: ShrubPacketCommand[]) {
    let currentPrimativeType: GsPrimitiveType | null = null;
    let currentMaterial: ShrubTexturePrimitive | null = null;

    const groups: { material: ShrubTexturePrimitive, strip: ShrubVertex[], triangleList: ShrubVertex[] }[] = [];

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
                currentMaterial = command.value.adGif;
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
        if (i % 2 === 0) {
            tris.push(strip[i + 0], strip[i + 1], strip[i + 2]);
        } else {
            tris.push(strip[i + 0], strip[i + 2], strip[i + 1]);
        }
    }
    return tris;
};
