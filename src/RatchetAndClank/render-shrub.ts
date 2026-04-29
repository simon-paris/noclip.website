import { GsPrimitiveType } from "../Common/PS2/GS";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { ShrubClass, ShrubImaginaryGsCommand, ShrubVertex } from "./bin-core";
import { ImaginaryGsCommandType, MegaBuffer, noclipSpaceFromRatchetSpace } from "./utils";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { ShrubInstance } from "./bin-gameplay";

export class ShrubProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TextureParams = 2;
    public static a_ST = 3;

    public static elementsPerVertex = 10; // position (3), normal (3), texture params (2), st (2)

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
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(location = 0) uniform sampler2DArray u_Texture_16;
layout(location = 1) uniform sampler2DArray u_Texture_32;
layout(location = 2) uniform sampler2DArray u_Texture_64;
layout(location = 3) uniform sampler2DArray u_Texture_128;
layout(location = 4) uniform sampler2DArray u_Texture_256;

`;

    public override vert = `

layout(location = ${ShrubProgram.a_Position}) in vec3 a_Position;
layout(location = ${ShrubProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${ShrubProgram.a_TextureParams}) in vec2 a_TextureParams; // x = texture index, y = clamp flag
layout(location = ${ShrubProgram.a_ST}) in vec2 a_ST;

layout(location = ${ShrubProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${ShrubProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${ShrubProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${ShrubProgram.a_InstanceTransform3}) in vec4 a_InstanceTransform3;
layout(location = ${ShrubProgram.a_InstanceAmbientRgba}) in vec4 a_InstanceAmbientRgba;
layout(location = ${ShrubProgram.a_InstanceDirectionLights}) in vec4 a_InstanceDirectionLights;
layout(location = ${ShrubProgram.a_InstanceLodAlpha}) in float a_InstanceLodAlpha;

flat out int v_TextureIndex;
flat out int v_Clamp;
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
    v_TextureIndex = int(a_TextureParams.x);
    v_Clamp = int(a_TextureParams.y);
}
`;

    public override frag = `

flat in int v_TextureIndex;
flat in int v_Clamp;
in vec2 v_ST;
in vec4 v_Rgba;
in vec3 v_Normal;

${RatchetShaderLib.CommonFragmentShader}
${RatchetShaderLib.Sampler}

void main() {
    vec2 texRemap = u_TextureRemaps.shrubs[v_TextureIndex].xy;
    vec4 textureSample = ratchetSampler(texRemap.x, texRemap.y, v_Clamp, v_ST);
    gl_FragColor = commonFragmentShader(v_Rgba, textureSample);
}

`;

}

export class ShrubGeometry {
    public vertexBuffer: GfxBuffer;
    public vertexCount: number;

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, shrub: ShrubClass, textureIndices: number[]) {
        const device = cache.device;

        const assembled = assembleShrubClassGeometry(shrub, textureIndices);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.vertexData.buffer);
        this.vertexCount = assembled.vertexData.length / ShrubProgram.elementsPerVertex;

        device.setResourceName(this.vertexBuffer, `Shrub Class ${shrub.header.oClass} (VB)`);

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: ShrubProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: ShrubProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: ShrubProgram.a_TextureParams, format: GfxFormat.F32_RG, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                { location: ShrubProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 8 * 4, bufferIndex: 0, },
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

export class ShrubRenderer {
    private shrubProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.shrubProgram = renderHelper.renderCache.createProgram(new ShrubProgram());
    }

    renderShrub(renderInstList: GfxRenderInstList, shrubGeometry: ShrubGeometry, shrubInstances: ShrubInstance[], textureMappings: GfxSamplerBinding[], cameraPosition: vec3, settingLodPreset: number, settingLodBias: number, instanceDataBuffer: MegaBuffer): void {
        type ShrubDrawInstance = { objectMatrix: mat4, directionalLights: number[], rgb: { r: number, g: number, b: number }, lodAlpha: number, i: number };
        const shrubInstancesToDraw: ShrubDrawInstance[] = [];
        for (let i = 0; i < shrubInstances.length; i++) {
            const shrubInstance = shrubInstances[i];

            // shrub instance transform
            const objectMatrix = mat4.create();
            mat4.multiply(objectMatrix, noclipSpaceFromRatchetSpace, shrubInstance.matrix);
            const position = vec3.create();
            mat4.getTranslation(position, objectMatrix);
            const distanceToCamera = vec3.distance(position, cameraPosition);

            // lod
            let lodAlpha = settingLodPreset === 0 ? 1 : 0;
            if (settingLodPreset === -1) {
                const farDist = shrubInstance.drawDistance + settingLodBias * 1.5;
                if (farDist > 0) {
                    const nearDist = farDist * 0.5;
                    lodAlpha = 1 - (distanceToCamera - nearDist) / (farDist - nearDist);
                    lodAlpha = Math.max(0, Math.min(1, lodAlpha));
                }
            }
            if (lodAlpha <= 0) continue;

            // this is much slower than doing nothing because of the jumps into rust
            // // find bounding sphere and frustum cull
            // const objectScale = Math.hypot(objectMatrix[0], objectMatrix[1], objectMatrix[2]);
            // if (!cameraFrustum.containsSphere(position, 0x7FFF / 1024 * shrubClass.header.scale * objectScale)) {
            //     continue;
            // }

            shrubInstancesToDraw.push({
                objectMatrix,
                directionalLights: shrubInstance.directionalLights,
                rgb: shrubInstance.color,
                lodAlpha,
                i,
            })
        }

        if (!shrubInstancesToDraw.length) return;

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.shrubProgram);
        renderInst.setBindingLayouts([
            {
                numSamplers: 5,
                numUniformBuffers: 2,
                samplerEntries: [
                    { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
                    { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
                    { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
                    { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
                    { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
                ],
            }
        ]);

        // per instance data
        const instanceDataStartBytes = instanceDataBuffer.ptr * 4;
        for (let i = 0; i < shrubInstancesToDraw.length; i++) {
            const inst = shrubInstancesToDraw[i];
            const color = inst.rgb;
            instanceDataBuffer.ptr += fillMatrix4x4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.objectMatrix);
            instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, color.r / 0x80, color.g / 0x80, color.b / 0x80, 1);
            instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.directionalLights[0], inst.directionalLights[1], inst.directionalLights[2], inst.directionalLights[3]);
            instanceDataBuffer.f32View[instanceDataBuffer.ptr++] = inst.lodAlpha;
        }

        renderInst.setVertexInput(
            shrubGeometry.inputLayout,
            [
                { buffer: shrubGeometry.vertexBuffer, byteOffset: 0 },
                { buffer: instanceDataBuffer.gfxBuffer, byteOffset: instanceDataStartBytes },
            ],
            null,
        );
        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setDrawCount(shrubGeometry.vertexCount, 0);
        renderInst.setInstanceCount(shrubInstancesToDraw.length);
        renderInstList.submitRenderInst(renderInst);
    }
}

export function assembleShrubClassGeometry(shrub: ShrubClass, textureIndices: number[]) {
    const scale = shrub.header.scale * (1 / 1024);
    const normalScale = 1 / 0x7fff;
    const texcoordScale = 1 / 4096;

    // clean up command lists
    const packets = shrub.body.packets.map(commandBufferToTriangles).flat(1);

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
            vertexArrayBuffer[ptr++] = textureIndices[material.texture];
            vertexArrayBuffer[ptr++] = material.clamp;
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
                    clamp: command.value.adGif.clamp.low + (command.value.adGif.clamp.high << 2),
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
