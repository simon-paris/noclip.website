import { mat4, quat, vec3, vec4 } from "gl-matrix";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { FakeTextureHolder } from "../TextureHolder";
import { MAX_TIE_INSTANCES, TieGeometry, TieProgram } from "./tie";
import { CameraController } from "../Camera";
import { buildLevelFromFiles, LevelFiles, ShrubInstanceBatch, TieInstanceBatch } from "./level-builder";
import { batches, distanceToCamera, makeTextureWithPalette, noclipSpaceFromRatchetSpace, pathToDebugLines } from "./utils";
import { TfragGeometry, TfragProgram } from "./tfrag";
import { MAX_SHRUB_INSTANCES, ShrubGeometry, ShrubProgram } from "./shrub";
import { colorNewFromRGBA, Red, White } from "../Color";
import { SkyGeometry, SkyProgram } from "./sky";
import { RatchetShaderLib } from "./shader-lib";
import { Frustum } from "../Geometry";
import { MobyInstance } from "./structs-gameplay";
import { nArray } from "../util";

const pathBase = `RatchetAndClank1`;

class RatchetAndClank1Scene implements SceneGfx {
    private renderHelper: GfxRenderHelper;

    private renderInstList = new GfxRenderInstList();

    private tfragProgram: GfxProgram;
    private tieProgram: GfxProgram;
    private shrubProgram: GfxProgram;
    private skyProgram: GfxProgram;

    private samplerWrap: GfxSampler;
    private samplerClamp: GfxSampler;

    public textureHolder = new FakeTextureHolder([]);

    private settings = {
        lodSetting: -1, // -1 means dynamic
        lodBias: 40,
        enableTfrag: true,
        enableTies: true,
        enableMobys: false,
        enableShrubs: true,
        enableSky: true,
        enableFog: true,
        enableTextures: true,
        showPaths: false,
        dirLightIndex: 0,
    };

    // raw data files
    private files:
        | { ready: false; }
        | ({ ready: true, } & LevelFiles) = {
            ready: false,
        };

    // parsed and assembled level structure
    private level: {
        ready: false,
    } | ReturnType<typeof buildLevelFromFiles> = {
            ready: false,
        };

    private textures = {
        tfragTextures: new Array<GfxTexture>(),
        tieTextures: new Array<GfxTexture>(),
        shrubTextures: new Array<GfxTexture>(),
        skyTextures: new Array<GfxTexture>(),
    }

    // meshes generated from level data
    private geometries = {
        tfrag: null as null | TfragGeometry,
        ties: new Map<number, (TieGeometry | null)[]>(), // map of oClass to array of LOD geometries
        shrubs: new Map<number, ShrubGeometry>(),
        skyShells: new Array<SkyGeometry>(),
    };

    constructor(private sceneContext: SceneContext, public levelNumber: number) {
        this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);
        const cache = this.renderHelper.renderCache;

        this.tfragProgram = cache.createProgram(new TfragProgram());
        this.tieProgram = cache.createProgram(new TieProgram());
        this.shrubProgram = cache.createProgram(new ShrubProgram());
        this.skyProgram = cache.createProgram(new SkyProgram());

        this.samplerWrap = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.samplerClamp = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.fetchLevelFiles().then(() => {
            if (!this.files.ready) {
                throw new Error("Level files not ready");
            }
            this.level = buildLevelFromFiles(this.files);
            console.log(this.level);

            this.buildAssetGeometry();
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 400);
    }

    private async fetchLevelFiles() {
        const coreIndexBuffer = await this.sceneContext.dataFetcher.fetchData(`${pathBase}/level_${this.levelNumber}.core_index`);
        const coreDataBuffer = await this.sceneContext.dataFetcher.fetchData(`${pathBase}/level_${this.levelNumber}.core_data`);
        const gameplayBuffer = await this.sceneContext.dataFetcher.fetchData(`${pathBase}/level_${this.levelNumber}.gameplay`);
        const gsRamBuffer = await this.sceneContext.dataFetcher.fetchData(`${pathBase}/level_${this.levelNumber}.gs_ram`);

        this.files = {
            ready: true,
            coreIndexBuffer,
            coreIndex: coreIndexBuffer.createDataViewExt({ littleEndian: true }),
            coreDataBuffer,
            coreData: coreDataBuffer.createDataViewExt({ littleEndian: true }),
            gameplayBuffer,
            gameplay: gameplayBuffer.createDataViewExt({ littleEndian: true }),
            gsRamBuffer,
            gsRam: gsRamBuffer.createDataViewExt({ littleEndian: true }),
        };

    }

    private buildAssetGeometry() {
        if (!this.level.ready) {
            throw new Error("Not ready")
        }

        const cache = this.renderHelper.renderCache;

        const { tfrags, tfragTextures } = this.level;
        for (let i = 0; i < tfragTextures.length; i++) {
            const tfragTexture = tfragTextures[i];
            const gfxTextures = makeTextureWithPalette(cache.device, tfragTexture);
            this.textures.tfragTextures.push(gfxTextures.pixelsTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTextures.pixelsTexture });
        }
        this.geometries.tfrag = new TfragGeometry(cache, tfrags);

        const { ties, tieTextures } = this.level;
        for (let i = 0; i < tieTextures.length; i++) {
            const tieTexture = tieTextures[i];
            const gfxTextures = makeTextureWithPalette(cache.device, tieTexture);
            this.textures.tieTextures.push(gfxTextures.pixelsTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTextures.pixelsTexture });
        }
        for (const { oClass, tieClass } of ties) {
            this.geometries.ties.set(oClass, [null, null, null]);
            for (let i = 0; i < 3; i++) {
                if (tieClass.packets[i].length === 0) continue; // nothing to render for this lod
                this.geometries.ties.get(oClass)![i] = new TieGeometry(cache, oClass, tieClass, i);
            }
        }

        const { shrubs, shrubTextures } = this.level;
        for (const { oClass, shrubClass } of shrubs) {
            this.geometries.shrubs.set(oClass, new ShrubGeometry(cache, shrubClass));
        }
        for (let i = 0; i < shrubTextures.length; i++) {
            const shrubTexture = shrubTextures[i];
            const gfxTextures = makeTextureWithPalette(cache.device, shrubTexture);
            this.textures.shrubTextures.push(gfxTextures.pixelsTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTextures.pixelsTexture });
        }

        const { sky, skyTextures } = this.level;
        for (let i = 0; i < sky.shells.length; i++) {
            this.geometries.skyShells.push(new SkyGeometry(cache, sky.shells[i]));
        }
        for (let i = 0; i < skyTextures.length; i++) {
            const skyTexture = skyTextures[i];
            const gfxTextures = makeTextureWithPalette(cache.device, skyTexture);
            this.textures.skyTextures.push(gfxTextures.pixelsTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTextures.pixelsTexture });
        }

        console.log(this.geometries);

        this.textureHolder.onnewtextures();
    }

    private fillSceneParams(template: GfxRenderInst, viewerInput: ViewerRenderInput, cameraPosition: vec3): void {
        if (!this.level.ready) {
            throw new Error("Not ready");
        }
        const levelSettings = this.level.levelSettings;

        const data = template.allocateUniformBufferF32(TieProgram.ub_SceneParams, RatchetShaderLib.SceneParamsSizeInFloats);
        let offs = 0;

        // camera transform and position (24 floats)
        const nearClip = 0.05;
        const farClip = 1024;
        viewerInput.camera.setClipPlanes(nearClip, farClip);
        offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec3v(data, offs, cameraPosition, this.settings.enableTextures ? 1 : 0);
        offs += fillVec4(data, offs, nearClip, farClip, 0, 0);

        // background color (4 floats)
        const backgroundColor = this.level.levelSettings.backgroundColor;
        offs += fillVec4(data, offs, backgroundColor.r / 0xFF, backgroundColor.g / 0xFF, backgroundColor.b / 0xFF, 1);
        // sky color (4 floats)
        const skyColor = this.level.sky.header.skyColor;
        offs += fillVec4(data, offs, skyColor.r / 0xFF, skyColor.g / 0xFF, skyColor.b / 0xFF, skyColor.a / 0xFF);

        // fog params (8 floats)
        if (this.settings.enableFog) {
            const fogColor = levelSettings.fogColor;
            offs += fillVec4(data, offs, fogColor.r / 0xFF, fogColor.g / 0xFF, fogColor.b / 0xFF, 1);
            offs += fillVec4(data, offs,
                levelSettings.fogNearDistance / 1024,
                levelSettings.fogFarDistance / 1024,
                1 - (levelSettings.fogNearIntensity / 255),
                1 - (levelSettings.fogFarIntensity / 255),
            );
        } else {
            offs += fillVec4(data, offs, 0, 0, 0, 0);
            offs += fillVec4(data, offs, 1, 2, 0, 0);
        }

        // lights (16 * 16 floats)
        const directionalLights = this.level.directionLights;
        for (let i = 0; i < 16; i++) {
            if (i < directionalLights.length) {
                const light = directionalLights[i];
                offs += fillVec4(data, offs, -light.directionA.x, -light.directionA.z, light.directionA.y, 0);
                offs += fillVec4(data, offs, light.colorA.r, light.colorA.g, light.colorA.b, 1);
                offs += fillVec4(data, offs, -light.directionB.x, -light.directionB.z, light.directionB.y, 0);
                offs += fillVec4(data, offs, light.colorB.r, light.colorB.g, light.colorB.b, 1);
            } else {
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
            }
        }
    }

    private renderTfrag(cameraPosition: vec3): void {
        const objectMatrix = noclipSpaceFromRatchetSpace; // the tfrag has no transform, it's already in world space

        let lodLevel = this.settings.lodSetting;
        if (this.settings.lodSetting === -1) {
            lodLevel = 0;
        }

        const tfragGeometry = this.geometries.tfrag;
        if (!tfragGeometry) return;

        const template1 = this.renderHelper.pushTemplateRenderInst();
        template1.setGfxProgram(this.tfragProgram);
        template1.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            attachmentsState: [{
                channelWriteMask: GfxChannelWriteMask.AllChannels,
                rgbBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
                alphaBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.One,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
            }]
        });
        const tfragParams = template1.allocateUniformBufferF32(TfragProgram.ub_TfragParams, 16);
        let offs = 0;
        offs += fillMatrix4x4(tfragParams, offs, objectMatrix);

        for (const draw of tfragGeometry.lods[lodLevel].draws) {
            const material = draw.material < 0 ? 0 : draw.material;

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            renderInst.setVertexInput(
                tfragGeometry.inputLayout,
                [{ buffer: tfragGeometry.vertexBuffer, byteOffset: 0 }],
                { buffer: tfragGeometry.lods[lodLevel].indexBuffer, byteOffset: 0 },
            );
            renderInst.setSamplerBindings(0, [
                { gfxTexture: this.textures.tfragTextures[material], gfxSampler: this.samplerWrap }
            ]);
            renderInst.setDrawCount(draw.indexCount, draw.startIndex);
            this.renderInstList.submitRenderInst(renderInst);
        }

        this.renderHelper.renderInstManager.popTemplate();
    }

    private renderTie(tieInstanceBatch: TieInstanceBatch, cameraPosition: vec3, cameraFrustum: Frustum): void {
        if (!this.level.ready) return;

        const { tieClass, textureIndices, oClass } = tieInstanceBatch;

        const scratchVec3_1 = vec3.create();
        const scratchVec3_2 = vec3.create();

        type TieDrawInstance = { objectMatrix: mat4, directionLights: number[], rgba: vec4, lodMorphFactor: number, i: number };
        const tieInstancesToDrawByLod: TieDrawInstance[][] = [[], [], []];
        for (let i = 0; i < tieInstanceBatch.instances.length; i++) {
            const tieInstance = tieInstanceBatch.instances[i];

            // tie instance transform
            const objectMatrix = mat4.create();
            mat4.multiply(objectMatrix, noclipSpaceFromRatchetSpace, tieInstance.matrix);
            let position = scratchVec3_1;
            mat4.getTranslation(position, objectMatrix);

            // camera position
            const toCamera = scratchVec3_2;
            vec3.sub(toCamera, position, cameraPosition);
            const distanceToCamera = vec3.len(toCamera);

            // determine LOD level
            const hasLod2 = tieClass.packets[2].length > 0;
            const hasLod1 = tieClass.packets[1].length > 0;
            let modelLodLevel = this.settings.lodSetting;
            let lodMorphFactor = 0;
            if (this.settings.lodSetting === -1) {
                let smoothLod = 0;
                let nearDist = tieClass.nearDist + this.settings.lodBias;
                let midDist = tieClass.midDist + this.settings.lodBias * 2;
                let farDist = tieClass.farDist + this.settings.lodBias * 3;
                if (distanceToCamera < nearDist) {
                    smoothLod = 0;
                } else if (distanceToCamera < midDist) {
                    smoothLod = (distanceToCamera - nearDist) / (midDist - nearDist);
                } else if (distanceToCamera < farDist) {
                    smoothLod = 1 + (distanceToCamera - midDist) / (farDist - midDist);
                } else {
                    smoothLod = 2;
                }
                modelLodLevel = Math.floor(smoothLod);
                lodMorphFactor = smoothLod - modelLodLevel;
            }
            if (modelLodLevel === 2 && !hasLod2) { modelLodLevel = 1; lodMorphFactor = 0; }
            if (modelLodLevel === 1 && !hasLod1) { modelLodLevel = 0; lodMorphFactor = 0; }

            // this is much slower than doing nothing because of the jumps into rust
            // // find bounding sphere and frustum cull
            // const objectScale = Math.hypot(objectMatrix[0], objectMatrix[1], objectMatrix[2]);
            // if (!cameraFrustum.containsSphere(position, 0x7FFF / 1024 * tieClass.scale * objectScale)) {
            //     continue;
            // }

            for (const dirLight of tieInstance.directionalLights) {
                if (dirLight < 0 || (dirLight >= this.level.directionLights.length && dirLight !== 0xF)) {
                    throw new Error(`Invalid directional light index ${dirLight}`);
                }
            }

            // can't find this data :(
            const rgba = vec4.fromValues(1, 1, 1, 1);

            tieInstancesToDrawByLod[modelLodLevel].push({
                objectMatrix,
                directionLights: tieInstance.directionalLights,
                rgba,
                lodMorphFactor,
                i,
            });
        }

        for (let i = 0; i < tieInstancesToDrawByLod.length; i++) {
            const lodLevel = i;
            const tieInstancesToDraw = tieInstancesToDrawByLod[i];
            if (!tieInstancesToDraw.length) continue;

            const tieGeometry = this.geometries.ties.get(oClass)?.[lodLevel];
            if (!tieGeometry) continue;

            const template1 = this.renderHelper.pushTemplateRenderInst();
            template1.setGfxProgram(this.tieProgram);
            template1.setMegaStateFlags({
                cullMode: GfxCullMode.None,
                attachmentsState: [{
                    channelWriteMask: GfxChannelWriteMask.AllChannels,
                    rgbBlendState: {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                    },
                    alphaBlendState: {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.One,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                    },
                }]
            });
            template1.setVertexInput(
                tieGeometry.inputLayout,
                [{ buffer: tieGeometry.vertexBuffer, byteOffset: 0 }],
                null,
            );

            const batchSizes = batches(tieInstancesToDraw.length, MAX_TIE_INSTANCES);
            let ptr = 0;
            for (let i = 0; i < batchSizes.length; i++) {
                const batchSize = batchSizes[i];

                const renderInst = this.renderHelper.renderInstManager.newRenderInst();
                const uniformBufferSize =
                    // matrix
                    (16 * MAX_TIE_INSTANCES) +
                    // directional light indices
                    (4 * MAX_TIE_INSTANCES) +
                    // rgba
                    (4 * MAX_TIE_INSTANCES) +
                    // extras
                    (4 * MAX_TIE_INSTANCES);
                const tieParams = renderInst.allocateUniformBufferF32(TieProgram.ub_TieParams, uniformBufferSize);
                let tieParamsOffset = 0;
                for (let j = 0; j < batchSize; j++) {
                    const inst = tieInstancesToDraw[ptr + j];
                    tieParamsOffset += fillMatrix4x4(tieParams, tieParamsOffset, inst.objectMatrix);
                    tieParamsOffset += fillVec4(tieParams, tieParamsOffset, inst.directionLights[0], inst.directionLights[1], inst.directionLights[2], inst.directionLights[3]);
                    tieParamsOffset += fillVec4v(tieParams, tieParamsOffset, inst.rgba);
                    tieParamsOffset += fillVec4(tieParams, tieParamsOffset, inst.lodMorphFactor, 0, 0, 0);
                }
                ptr += batchSize;
                renderInst.setInstanceCount(batchSize);

                let requiredSamplers = 16;
                while (requiredSamplers && tieInstanceBatch.textureIndices[requiredSamplers - 1] === 0xFF) requiredSamplers--; // truncate the texture array at the last non-0xFF value
                renderInst.setSamplerBindings(0, nArray(requiredSamplers, j => ({
                    gfxTexture: this.textures.tieTextures[textureIndices[j]],
                    gfxSampler: this.samplerWrap
                })));

                renderInst.setDrawCount(tieGeometry.triangleCount * 3, 0);
                this.renderInstList.submitRenderInst(renderInst);
            }
            this.renderHelper.renderInstManager.popTemplate();
        }
    }

    private renderMoby(mobyInstance: MobyInstance, cameraWorldMatrix: mat4): void {
        const pos = vec3.fromValues(mobyInstance.position.x, mobyInstance.position.y, mobyInstance.position.z);
        vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
        this.renderHelper.debugDraw.drawLocator(pos, 0.3, White);
        const mat = mat4.fromTranslation(mat4.create(), pos);
        const rotation = quat.create();
        mat4.getRotation(rotation, cameraWorldMatrix);
        mat4.fromRotationTranslationScale(mat, rotation, pos, vec3.fromValues(0.01, 0.01, 0.01));
        this.renderHelper.debugDraw.drawWorldTextMtx(String(mobyInstance.oClass), mat, White);
    }

    private renderShrubs(shrubInstanceBatch: ShrubInstanceBatch, cameraPosition: vec3, cameraFrustum: Frustum): void {
        if (!this.level.ready) return;

        const { shrubClass, instances: shrubInstances, textureIndices } = shrubInstanceBatch;
        const oClass = shrubClass.header.oClass;

        const shrubGeometry = this.geometries.shrubs.get(oClass);
        if (!shrubGeometry) return;

        type ShrubDrawInstance = { objectMatrix: mat4, directionalLights: number[], rgb: { r: number, g: number, b: number }, lodAlpha: number, i: number };
        const shrubInstancesToDraw: ShrubDrawInstance[] = [];
        for (let i = 0; i < shrubInstances.length; i++) {
            const shrubInstance = shrubInstances[i];

            // shrub instance transform
            const objectMatrix = mat4.create();
            mat4.multiply(objectMatrix, noclipSpaceFromRatchetSpace, shrubInstance.matrix);
            const position = vec3.create();
            mat4.getTranslation(position, objectMatrix);
            const dist = distanceToCamera(position, cameraPosition);

            // lod
            let lodAlpha = this.settings.lodSetting === 0 ? 1 : 0;
            if (this.settings.lodSetting === -1) {
                const farDist = shrubInstance.drawDistance + this.settings.lodBias * 1.5;
                if (farDist > 0) {
                    const nearDist = farDist * 0.5;
                    lodAlpha = 1 - (dist - nearDist) / (farDist - nearDist);
                }
            }
            if (lodAlpha <= 0) continue;

            // this is much slower than doing nothing because of the jumps into rust
            // // find bounding sphere and frustum cull
            // const objectScale = Math.hypot(objectMatrix[0], objectMatrix[1], objectMatrix[2]);
            // if (!cameraFrustum.containsSphere(position, 0x7FFF / 1024 * shrubClass.header.scale * objectScale)) {
            //     continue;
            // }

            for (const dirLightIndex of shrubInstance.directionalLights) {
                if (dirLightIndex < 0 || (dirLightIndex >= this.level.directionLights.length && dirLightIndex !== 0xF)) {
                    throw new Error("invalid directional light index");
                }
            }

            shrubInstancesToDraw.push({
                objectMatrix,
                directionalLights: shrubInstance.directionalLights,
                rgb: shrubInstance.color,
                lodAlpha,
                i,
            })
        }

        const template1 = this.renderHelper.pushTemplateRenderInst();
        template1.setGfxProgram(this.shrubProgram);
        template1.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            attachmentsState: [{
                channelWriteMask: GfxChannelWriteMask.AllChannels,
                rgbBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
                alphaBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.One,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
            }]
        });
        template1.setVertexInput(
            shrubGeometry.inputLayout,
            [{ buffer: shrubGeometry.vertexBuffer, byteOffset: 0 }],
            null,
        );

        const batchSizes = batches(shrubInstancesToDraw.length, MAX_SHRUB_INSTANCES);
        let i = 0;
        for (const batchSize of batchSizes) {
            const template2 = this.renderHelper.pushTemplateRenderInst();
            const size =
                // matrix
                (16 * MAX_SHRUB_INSTANCES) +
                // rgb
                (4 * MAX_SHRUB_INSTANCES) +
                // dir lights
                (4 * MAX_SHRUB_INSTANCES) +
                // extras
                (4 * MAX_SHRUB_INSTANCES);
            const shrubParams = template2.allocateUniformBufferF32(ShrubProgram.ub_ShrubParams, size * 2);
            let shrubParamsOffset = 0;
            for (let j = 0; j < batchSize; j++) {
                const inst = shrubInstancesToDraw[i + j];
                const color = inst.rgb;
                shrubParamsOffset += fillMatrix4x4(shrubParams, shrubParamsOffset, inst.objectMatrix);
                shrubParamsOffset += fillVec4(shrubParams, shrubParamsOffset, color.r / 0x40, color.g / 0x40, color.b / 0x40, 1);
                shrubParamsOffset += fillVec4(shrubParams, shrubParamsOffset, inst.directionalLights[0], inst.directionalLights[1], inst.directionalLights[2], inst.directionalLights[3]);
                shrubParamsOffset += fillVec4(shrubParams, shrubParamsOffset, inst.lodAlpha, 0, 0, 0);
            }

            i += batchSize;
            template2.setInstanceCount(batchSize);

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();

            let requiredSamplers = 16;
            while (requiredSamplers && shrubInstanceBatch.textureIndices[requiredSamplers - 1] === 0xFF) requiredSamplers--; // truncate the texture array at the last non-0xFF value
            renderInst.setSamplerBindings(0, nArray(requiredSamplers, j => ({
                gfxTexture: this.textures.shrubTextures[textureIndices[j]],
                gfxSampler: this.samplerWrap
            })));

            renderInst.setDrawCount(shrubGeometry.vertexCount, 0);
            this.renderInstList.submitRenderInst(renderInst);

            this.renderHelper.renderInstManager.popTemplate();
        }

        this.renderHelper.renderInstManager.popTemplate();
    }

    private renderSky(cameraPosition: vec3, skyShellIndex: number): void {
        const objectMatrix = mat4.create();
        mat4.translate(objectMatrix, objectMatrix, cameraPosition);
        mat4.multiply(objectMatrix, objectMatrix, noclipSpaceFromRatchetSpace);

        const skyShellGeometry = this.geometries.skyShells[skyShellIndex];
        if (!skyShellGeometry) return;

        const template1 = this.renderHelper.pushTemplateRenderInst();
        template1.setGfxProgram(this.skyProgram);
        template1.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            depthWrite: false,
            depthCompare: GfxCompareMode.Always,
            attachmentsState: [{
                channelWriteMask: GfxChannelWriteMask.AllChannels,
                rgbBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
                alphaBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.One,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
            }],
        });

        for (const draw of skyShellGeometry.draws) {
            const renderInst = this.renderHelper.renderInstManager.newRenderInst();

            const skyParams = renderInst.allocateUniformBufferF32(SkyProgram.ub_SkyParams, 20);
            let offs = 0;
            offs += fillMatrix4x4(skyParams, offs, objectMatrix);
            offs += fillVec4(skyParams, offs, Number(draw.flags.textured), 0, 0, 0);

            renderInst.setVertexInput(
                skyShellGeometry.inputLayout,
                [{ buffer: skyShellGeometry.vertexBuffer, byteOffset: 0 }],
                { buffer: skyShellGeometry.indexBuffer, byteOffset: 0 },
            );
            renderInst.setSamplerBindings(0, [
                { gfxTexture: this.textures.skyTextures[draw.material], gfxSampler: this.samplerClamp }
            ]);
            renderInst.setDrawCount(draw.indexCount, draw.startIndex);
            this.renderInstList.submitRenderInst(renderInst);
        }

        this.renderHelper.renderInstManager.popTemplate();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        if (!this.level.ready) return;

        const cameraPosition = vec3.create();
        mat4.getTranslation(cameraPosition, viewerInput.camera.worldMatrix);
        const cameraFrustum = viewerInput.camera.frustum;

        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([
            { numSamplers: 16, numUniformBuffers: 2 },
        ]);

        this.fillSceneParams(template, viewerInput, cameraPosition);

        if (this.settings.enableSky) {
            for (let i = 0; i < this.geometries.skyShells.length; i++) {
                this.renderSky(cameraPosition, i);
            }
        }

        if (this.settings.enableTfrag) {
            this.renderTfrag(cameraPosition);
        }

        if (this.settings.enableTies) {
            for (let i = 0; i < this.level.ties.length; i++) {
                this.renderTie(this.level.ties[i], cameraPosition, cameraFrustum);
            }
        }

        if (this.settings.enableMobys) {
            for (let i = 0; i < this.level.mobyInstances.instances.length; i++) {
                this.renderMoby(this.level.mobyInstances.instances[i], viewerInput.camera.worldMatrix);
            }
        }

        if (this.settings.enableShrubs) {
            for (let i = 0; i < this.level.shrubs.length; i++) {
                this.renderShrubs(this.level.shrubs[i], cameraPosition, cameraFrustum);
            }
        }

        if (this.settings.showPaths) {
            for (const path of this.level.paths) {
                const lines = pathToDebugLines(path.points, colorNewFromRGBA(0.1, 0.3, 0.8, 1));
                for (const line of lines) this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
            }
            for (const path of this.level.grindPaths) {
                const lines = pathToDebugLines(path.points, colorNewFromRGBA(0.7, 0.4, 0.1, 1));
                for (const line of lines) this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
            }
        }


        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const backgroundColor = this.level.levelSettings.backgroundColor;
        mainColorDesc.clearColor = { r: backgroundColor.r / 255, g: backgroundColor.g / 255, b: backgroundColor.b / 255, a: 1 };
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName("Main Pass");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer, scope) => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });


        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        builder.execute();
    }

    public createPanels(): UI.Panel[] {
        const renderSettingsPanel = new UI.Panel();
        renderSettingsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderSettingsPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Settings');

        const lodSetting = new UI.RadioButtons('LoD', ["Dynamic", "High", "Med", "Low"]);
        lodSetting.setSelectedIndex(this.settings.lodSetting + 1);
        lodSetting.onselectedchange = () => {
            this.settings.lodSetting = lodSetting.selectedIndex - 1;
        };
        renderSettingsPanel.contents.appendChild(lodSetting.elem);

        const lodBias = new UI.Slider('LoD Bias', this.settings.lodBias, -100, 200);
        lodBias.onvalue = (n: number) => {
            this.settings.lodBias = n;
        };
        renderSettingsPanel.contents.appendChild(lodBias.elem);

        const enableTfrag = new UI.Checkbox('Enable Tfrag', this.settings.enableTfrag);
        enableTfrag.onchanged = () => {
            this.settings.enableTfrag = enableTfrag.checked;
        };
        renderSettingsPanel.contents.appendChild(enableTfrag.elem);

        const enableTies = new UI.Checkbox('Enable Ties', this.settings.enableTies);
        enableTies.onchanged = () => {
            this.settings.enableTies = enableTies.checked;
        };
        renderSettingsPanel.contents.appendChild(enableTies.elem);

        const enableShrubs = new UI.Checkbox('Enable Shrubs', this.settings.enableShrubs);
        enableShrubs.onchanged = () => {
            this.settings.enableShrubs = enableShrubs.checked;
        };
        renderSettingsPanel.contents.appendChild(enableShrubs.elem);

        const enableFog = new UI.Checkbox('Enable Fog', this.settings.enableFog);
        enableFog.onchanged = () => {
            this.settings.enableFog = enableFog.checked;
        };
        renderSettingsPanel.contents.appendChild(enableFog.elem);

        const enableTextures = new UI.Checkbox('Enable Textures', this.settings.enableTextures);
        enableTextures.onchanged = () => {
            this.settings.enableTextures = enableTextures.checked;
        };
        renderSettingsPanel.contents.appendChild(enableTextures.elem);

        const enableSky = new UI.Checkbox('Enable Sky', this.settings.enableSky);
        enableSky.onchanged = () => {
            this.settings.enableSky = enableSky.checked;
        };
        renderSettingsPanel.contents.appendChild(enableSky.elem);

        const enableMobys = new UI.Checkbox('Show Moby Positions', this.settings.enableMobys);
        enableMobys.onchanged = () => {
            this.settings.enableMobys = enableMobys.checked;
        };
        renderSettingsPanel.contents.appendChild(enableMobys.elem);

        const showPaths = new UI.Checkbox('Show Paths', this.settings.showPaths);
        showPaths.onchanged = () => {
            this.settings.showPaths = showPaths.checked;
        };
        renderSettingsPanel.contents.appendChild(showPaths.elem);

        return [renderSettingsPanel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (const lods of this.geometries.ties.values()) {
            for (const geometry of lods) {
                geometry?.destroy(device);
            }
        }
        this.geometries.tfrag?.destroy(device);
        for (const geometry of this.geometries.shrubs.values()) {
            geometry.destroy(device);
        }
    }
}

class RatchetAndClank1SceneDesc implements SceneDesc {
    id: string;

    constructor(public levelNumber: number, public name: string) {
        this.id = String(levelNumber);
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new RatchetAndClank1Scene(sceneContext, this.levelNumber);
    }
}

export const sceneGroup: SceneGroup = {
    id: "RatchetAndClank1",
    name: "Ratchet & Clank",
    sceneDescs: [
        new RatchetAndClank1SceneDesc(0, "Kyzil Plateau, Veldin (Tutorial)"),
        new RatchetAndClank1SceneDesc(1, "Tobruk Crater, Novalis"),
        new RatchetAndClank1SceneDesc(2, "Outpost X11, Aridia"),
        new RatchetAndClank1SceneDesc(3, "Metropolis, Kerwan"),
        new RatchetAndClank1SceneDesc(4, "Logging Site, Eudora"),
        new RatchetAndClank1SceneDesc(5, "Blackwater City, Rilgar"),
        new RatchetAndClank1SceneDesc(6, "Blarg Station, Nebula G34"),
        new RatchetAndClank1SceneDesc(7, "Quark's HQ, Umbris"),
        new RatchetAndClank1SceneDesc(8, "Fort Krontos, Batalia"),
        new RatchetAndClank1SceneDesc(9, "Blarg Depot, Gaspar"),
        new RatchetAndClank1SceneDesc(10, "Kogor Refinery, Orxon"),
        new RatchetAndClank1SceneDesc(11, "Jowai Resort, Pokitaru"),
        new RatchetAndClank1SceneDesc(12, "Bomb Factory, Hoven"),
        new RatchetAndClank1SceneDesc(13, "Gemlik Base, Oltanis Orbit"),
        new RatchetAndClank1SceneDesc(14, "Gorda City Ruins, Oltanis"),
        new RatchetAndClank1SceneDesc(15, "Robot Plant, Quartu"),
        new RatchetAndClank1SceneDesc(16, "Gadgetron Site, Kalebo III"),
        new RatchetAndClank1SceneDesc(17, "Drek's Fleet, Veldin Orbit"),
        new RatchetAndClank1SceneDesc(18, "Kyzil Plateau, Veldin"),
    ],
};
