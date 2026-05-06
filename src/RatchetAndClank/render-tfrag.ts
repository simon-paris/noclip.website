import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { Tfrag, TfragLight, TfragVertexInfo } from "./bin-core";
import { PaletteTexture } from "./textures";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { noclipSpaceFromRatchetSpace } from "./utils";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";

export class TfragProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Rgba = 2;
    public static a_TextureParams = 3;
    public static a_ST = 4;
    public static a_DirLightIndices = 5;

    public static elementsPerVertex = 18; // position(3) + normal(3) + rgba(4) + texture(2) + st(2) + lights(4) = 18

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

layout(location = 0) uniform sampler2DArray u_Texture_16;
layout(location = 1) uniform sampler2DArray u_Texture_32;
layout(location = 2) uniform sampler2DArray u_Texture_64;
layout(location = 3) uniform sampler2DArray u_Texture_128;
layout(location = 4) uniform sampler2DArray u_Texture_256;

`;

    public override vert = `

layout(location = ${TfragProgram.a_Position}) in vec3 a_Position;
layout(location = ${TfragProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TfragProgram.a_Rgba}) in vec4 a_Rgba;
layout(location = ${TfragProgram.a_TextureParams}) in vec2 a_TextureParams;
layout(location = ${TfragProgram.a_ST}) in vec2 a_ST;
layout(location = ${TfragProgram.a_DirLightIndices}) in vec4 a_DirLightIndices;

out vec4 v_Rgba;
out vec2 v_ST;
out float v_FogFactor;
flat out int v_TextureLayer;
flat out int v_Clamp;

${RatchetShaderLib.LightingFunctions}

void main() {
    mat4 worldTransform = UnpackMatrix(u_WorldFromLocal);
    vec4 t_PositionWorld = worldTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_PositionWorld;

    vec3 normal = normalize(inverse(transpose(mat3(worldTransform))) * normalize(a_Normal));
    vec4 lights = a_DirLightIndices;

    v_Rgba = commonVertexLighting(a_Rgba, normal, lights);

    v_ST = a_ST.xy;
    v_FogFactor = fogFactor(t_PositionWorld.xyz);
    v_TextureLayer = int(a_TextureParams.x);
    v_Clamp = int(a_TextureParams.y);
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}
${RatchetShaderLib.Sampler}

in vec4 v_Rgba;
in vec2 v_ST;
in float v_FogFactor;
flat in int v_TextureLayer;
flat in int v_Clamp;

void main() {
    if (u_EnableTextures == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }
    vec2 texRemap = u_TextureRemaps.tfrags[v_TextureLayer].xy;
    vec4 textureSample = ratchetSampler(texRemap.x, texRemap.y, v_Clamp, v_ST);
    gl_FragColor = commonFragmentShader(v_Rgba, textureSample, v_FogFactor);
}
`;

}

export class TfragGeometry {
    // array of 3 vertex buffers, one per lod
    public lods: {
        vertexBuffer: GfxBuffer,
        vertexCount: number,
    }[];

    public assembled: { lods: { vertexArrayBuffer: Float32Array, vertexCount: number }[] }

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, private tfrags: Tfrag[], private tfragTextures: PaletteTexture[]) {
        const device = cache.device;

        const assembled = this.assemble(tfrags, tfragTextures);
        this.assembled = assembled;

        this.lods = assembled.lods.map((lod, i) => {
            const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, lod.vertexArrayBuffer.buffer);
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
                { location: TfragProgram.a_TextureParams, format: GfxFormat.F32_RG, bufferByteOffset: 10 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 12 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_DirLightIndices, format: GfxFormat.F32_RGBA, bufferByteOffset: 14 * 0x4, bufferIndex: 0, },
            ],
            vertexBufferDescriptors: [
                { byteStride: TfragProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
            ],
            indexBufferFormat: null,
        });
    }

    private assemble(tfrags: Tfrag[], tfragTextures: PaletteTexture[]) {
        const positionScale = 1 / 1024;
        const texcoordScale = 1 / 4096;
        const colorScale = 1 / 0x80;

        let vertexCounts = [0, 0, 0];

        for (let i = 0; i < tfrags.length; i++) {
            const tfrag = tfrags[i];
            const tfragStrips = [tfrag.dataGroup1.lod2.strips, tfrag.dataGroup3.lod1.strips, tfrag.dataGroup5.lod0.strips];
            for (let lodLevel = 0; lodLevel < 3; lodLevel++) {
                const strips = tfragStrips[lodLevel];
                let stripPtr = 0;
                stripLoop: while (true) {
                    const strip = strips[stripPtr];
                    assert(strip !== undefined);
                    switch (strip.endOfPacketFlag) {
                        case 0: break; // normal strip
                        case 0x80: break; // end of packet but not end of this tfrag
                        case 0xFF: break stripLoop; // end
                        default: throw new Error(`Unknown strip flag`);
                    }
                    vertexCounts[lodLevel] += 3 * (strip.vertexCount - 2);
                    stripPtr++;
                }
            }
        }

        const vertexArrayBuffers = vertexCounts.map(c => new Float32Array(c * TfragProgram.elementsPerVertex));
        const vertexPtrs = [0, 0, 0];

        for (let i = 0; i < tfrags.length; i++) {
            const tfrag = tfrags[i];
            const basePosition = { x: tfrag.dataGroup2.basePosition[0], y: tfrag.dataGroup2.basePosition[1], z: tfrag.dataGroup2.basePosition[2] };

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
            const tfragStrips = [tfrag.dataGroup1.lod2.strips, tfrag.dataGroup3.lod1.strips, tfrag.dataGroup5.lod0.strips];
            const tfragIndices = [tfrag.dataGroup1.lod2.indices, tfrag.dataGroup3.lod1.indices, tfrag.dataGroup5.lod0.indices];
            const tfragTextures = tfrag.dataGroup2.textures;

            for (let lod = 0; lod < 3; lod++) {
                const strips = tfragStrips[lod];
                let stripPtr = 0;
                const indices = tfragIndices[lod];
                let stripIndicesPtr = 0;

                let activeMaterial = 0;
                let activeClamp = 0;

                stripLoop: while (true) {
                    const strip = strips[stripPtr];
                    assert(strip !== undefined);

                    switch (strip.endOfPacketFlag) {
                        case 0: break; // normal strip
                        case 0x80: break; // end of packet but not end of this tfrag
                        case 0xFF: break stripLoop; // end
                        default: throw new Error(`Unknown strip flag`);
                    }

                    let vertexCount = strip.vertexCount;
                    if (strip.hasAdGifFlag) {
                        if (strip.adGifOffset === -1) {
                            // do nothing
                        } else if (strip.adGifOffset >= 0) {
                            const localAdGifIndex = strip.adGifOffset / 0x5;
                            assert(tfragTextures[localAdGifIndex] !== undefined);
                            activeMaterial = tfragTextures[localAdGifIndex].tex0.low;
                            activeClamp = tfragTextures[localAdGifIndex].clamp.low + (tfragTextures[localAdGifIndex].clamp.high << 2);
                        } else {
                            throw new Error(`invalid adGifOffset`);
                        }
                    }

                    for (let i = 0; i < vertexCount - 2; i++) {
                        const triangleIndices = [indices[stripIndicesPtr], indices[stripIndicesPtr + 1], indices[stripIndicesPtr + 2]];
                        for (let tri = 0; tri < 3; tri++) {
                            const vertexIndex = triangleIndices[tri];
                            const vertInfo = tfragInfo[vertexIndex];
                            const vertPos = tfragVerts[vertInfo.vertex / 2];
                            const rgba = tfrag.rgbas[vertInfo.vertex / 2];
                            const light = tfrag.lights[vertInfo.vertex / 2];
                            const normal = this.lightToNormal(light);

                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = positionScale * (basePosition.x + vertPos.x);
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = positionScale * (basePosition.y + vertPos.y);
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = positionScale * (basePosition.z + vertPos.z);
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = normal.x;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = normal.y;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = normal.z;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = colorScale * rgba.r;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = colorScale * rgba.g;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = colorScale * rgba.b;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = colorScale * rgba.a;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = activeMaterial;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = activeClamp;
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = texcoordScale * this.fixTexcoord(vertInfo.s);
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = texcoordScale * this.fixTexcoord(vertInfo.t);
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = light.directionalLights[0];
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = light.directionalLights[1];
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = light.directionalLights[2];
                            vertexArrayBuffers[lod][vertexPtrs[lod]++] = light.directionalLights[3];
                        }
                        stripIndicesPtr++;
                    }

                    stripIndicesPtr += 2;
                    stripPtr++;
                }
            }
        }

        for (let i = 0; i < 3; i++) {
            assert(vertexPtrs[i] === vertexCounts[i] * TfragProgram.elementsPerVertex);
            assert(vertexPtrs[i] === vertexArrayBuffers[i].length);
        }

        return {
            lods: [ // reverse order
                { vertexArrayBuffer: vertexArrayBuffers[2], vertexCount: vertexPtrs[2] },
                { vertexArrayBuffer: vertexArrayBuffers[1], vertexCount: vertexPtrs[1] },
                { vertexArrayBuffer: vertexArrayBuffers[0], vertexCount: vertexPtrs[0] },
            ]
        };
    }

    private fixTexcoord(n: number) {
        if (n < 0) return n / 2;
        return n;
    }

    private lightToNormal(light: TfragLight) {
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


    public destroy(device: GfxDevice): void {
        for (const lod of this.lods) {
            device.destroyBuffer(lod.vertexBuffer);
        }
    }
}

const bindingLayouts = [
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
];

export class TfragRenderer {
    private tfragProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.tfragProgram = renderHelper.renderCache.createProgram(new TfragProgram());
    }

    renderTfrag(renderInstList: GfxRenderInstList, tfragGeometry: TfragGeometry, settingLodPreset: number, textureMappings: GfxSamplerBinding[]) {
        const objectMatrix = noclipSpaceFromRatchetSpace; // the tfrag has no transform, it's already in world space

        let lodLevel = settingLodPreset;
        if (settingLodPreset === -1) {
            lodLevel = 0;
        }

        if (tfragGeometry.lods[lodLevel].vertexCount === 0) return;

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setGfxProgram(this.tfragProgram);

        const tfragParams = renderInst.allocateUniformBufferF32(TfragProgram.ub_TfragParams, 16);
        let offs = 0;
        offs += fillMatrix4x4(tfragParams, offs, objectMatrix);

        renderInst.setVertexInput(
            tfragGeometry.inputLayout,
            [
                { buffer: tfragGeometry.lods[lodLevel].vertexBuffer, byteOffset: 0 },
            ],
            null,
        );
        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setDrawCount(tfragGeometry.lods[lodLevel].vertexCount, 0);
        renderInstList.submitRenderInst(renderInst);
    }
}
