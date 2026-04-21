import { GsPrimitiveType } from "../Common/PS2/GS";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert, nArray } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { ShrubClass, ShrubImaginaryGsCommand, ShrubVertex } from "./structs-core";
import { ImaginaryGsCommandType } from "./utils";

export class ShrubProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TextureIndex = 2;
    public static a_ST = 3;

    public static elementsPerVertex = 9; // position (3), normal (3), texture index (1), st (2)

    public static a_InstanceTransform0 = 4;
    public static a_InstanceTransform1 = 5;
    public static a_InstanceTransform2 = 6;
    public static a_InstanceTransform3 = 7;
    public static a_InstanceAmbientRgba = 8;
    public static a_InstanceDirectionLights = 9;
    public static a_InstanceLodAlpha = 10;

    public static elementsPerInstance = 25; // transform (16), ambient rgba (4), directional lights (4), lod alpha (1)

    public static ub_SceneParams = 0;
    public static ub_ShrubParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

${nArray(16, i => `
layout(location = ${i}) uniform sampler2D u_Texture${i};
`).join('\n')}
`;

    public override vert = `

layout(location = ${ShrubProgram.a_Position}) in vec3 a_Position;
layout(location = ${ShrubProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${ShrubProgram.a_TextureIndex}) in float a_TextureIndex;
layout(location = ${ShrubProgram.a_ST}) in vec2 a_ST;

layout(location = ${ShrubProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${ShrubProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${ShrubProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${ShrubProgram.a_InstanceTransform3}) in vec4 a_InstanceTransform3;
layout(location = ${ShrubProgram.a_InstanceAmbientRgba}) in vec4 a_InstanceAmbientRgba;
layout(location = ${ShrubProgram.a_InstanceDirectionLights}) in vec4 a_InstanceDirectionLights;
layout(location = ${ShrubProgram.a_InstanceLodAlpha}) in float a_InstanceLodAlpha;

flat out int v_TextureIndex;
out vec2 v_ST;
out vec4 v_Rgba;
out vec3 v_Normal;

${RatchetShaderLib.LightingFunctions}

void main() {
    Mat4x4 _instanceTransform = Mat4x4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, a_InstanceTransform3);
    mat4 instanceTransform = UnpackMatrix(_instanceTransform);
    vec4 t_PositionWorld = instanceTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;
    vec3 normal = normalize(inverse(transpose(mat3(instanceTransform))) * a_Normal);

    vec4 rgba = a_InstanceAmbientRgba.rgba;
    vec4 lights = a_InstanceDirectionLights;

    v_ST = a_ST.xy;
    v_Rgba = commonVertexLighting(rgba, normal, lights);
    v_Rgba.a *= a_InstanceLodAlpha;
    v_Normal = normal;
    v_TextureIndex = int(a_TextureIndex);
}
`;

    public override frag = `

flat in int v_TextureIndex;
in vec2 v_ST;
in vec4 v_Rgba;
in vec3 v_Normal;

${RatchetShaderLib.CommonFragmentShader}

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

export class ShrubGeometry {
    public vertexBuffer: GfxBuffer;
    public vertexCount: number;

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, shrub: ShrubClass) {
        const device = cache.device;

        const assembled = assembleShrubClassGeometry(shrub);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.vertexData.buffer);
        this.vertexCount = assembled.vertexData.length / ShrubProgram.elementsPerVertex;

        device.setResourceName(this.vertexBuffer, `Shrub Class ${shrub.header.oClass} (VB)`);

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: ShrubProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: ShrubProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: ShrubProgram.a_TextureIndex, format: GfxFormat.F32_R, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                { location: ShrubProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 7 * 4, bufferIndex: 0, },
                // per instance
                { location: ShrubProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceTransform3, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceAmbientRgba, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceDirectionLights, format: GfxFormat.F32_RGBA, bufferByteOffset: 20 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceLodAlpha, format: GfxFormat.F32_R, bufferByteOffset: 24 * 4, bufferIndex: 1, },
            ],
            vertexBufferDescriptors: [
                { byteStride: ShrubProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
                { byteStride: ShrubProgram.elementsPerInstance * 0x4, frequency: GfxVertexBufferFrequency.PerInstance, },
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

    const triangleCount = packets.reduce((a, b) => a + b.vertices.length, 0) / 3; // shrubs are triangle lists not strips
    const expectedSize = triangleCount * 3 * ShrubProgram.elementsPerVertex;
    const vertexArrayBuffer = new Float32Array(expectedSize);

    let ptr = 0;
    for (const { vertices, material } of packets) {
        for (const vertex of vertices) {
            const normal = shrub.body.normals[vertex.n];
            vertexArrayBuffer[ptr++] = scale * vertex.x;
            vertexArrayBuffer[ptr++] = scale * vertex.y;
            vertexArrayBuffer[ptr++] = scale * vertex.z;
            vertexArrayBuffer[ptr++] = normalScale * normal.x;
            vertexArrayBuffer[ptr++] = normalScale * normal.y;
            vertexArrayBuffer[ptr++] = normalScale * normal.z;
            vertexArrayBuffer[ptr++] = material.texture;
            vertexArrayBuffer[ptr++] = texcoordScale * vertex.s;
            vertexArrayBuffer[ptr++] = texcoordScale * vertex.t;
        }
    }

    assert(ptr == vertexArrayBuffer.length);

    return { vertexData: vertexArrayBuffer };
}

function commandBufferToTriangles(commandBuffer: ShrubImaginaryGsCommand[]) {
    let currentPrimitiveType: GsPrimitiveType | null = null;
    let currentMaterial: { texture: number, clamp: number } | null = null;

    const groups: { material: { texture: number, clamp: number }, strip: ShrubVertex[], triangleList: ShrubVertex[] }[] = [];

    for (const command of commandBuffer) {
        switch (command.type) {
            case ImaginaryGsCommandType.PRIMITIVE_RESET: {
                currentPrimitiveType = command.value.type;
                if (currentMaterial === null) {
                    throw new Error("Got a primitive reset command before we had a material set");
                }
                groups.push({ material: currentMaterial, strip: [], triangleList: [] });
                break;
            }
            case ImaginaryGsCommandType.SET_MATERIAL: {
                currentMaterial = {
                    texture: command.value.adGif.tex0.low,
                    clamp: command.value.adGif.clamp.low,
                };
                break;
            }
            case ImaginaryGsCommandType.VERTEX: {
                if (currentPrimitiveType === GsPrimitiveType.TRIANGLE_STRIP) {
                    groups[groups.length - 1].strip.push(command.value);
                } else if (currentPrimitiveType === GsPrimitiveType.TRIANGLE) {
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
            throw new Error("Can't have both strip and triangle list data in the same primitive");
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
