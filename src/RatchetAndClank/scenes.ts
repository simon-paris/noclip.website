import { mat4, vec3, vec4 } from "gl-matrix";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillMatrix4x4, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { FakeTextureHolder } from "../TextureHolder";
import { ShrubInstance, TieInstance } from "./structs-gameplay";
import { ShrubClass, Tfrag, TieClass } from "./structs-core";
import { MAX_TIE_INSTANCES, TieGeometry, TieProgram } from "./tie";
import { CameraController } from "../Camera";
import { buildLevelFromFiles, LevelFiles, ShrubInstanceBatch, TieInstanceBatch } from "./level-builder";
import { batches, distanceToCamera, makeTextureWithPalette, noclipSpaceFromRatchetSpace, pathToDebugLines } from "./utils";
import { TfragGeometry, TfragProgram } from "./tfrag";
import { MAX_SHRUB_INSTANCES, ShrubGeometry, ShrubProgram } from "./shrub";
import { colorFromRGBA8, colorNewFromRGBA, Red, White } from "../Color";
import { SkyGeometry, SkyProgram } from "./sky";
import { RatchetShaderLib } from "./shader-lib";

const pathBase = `RatchetAndClank1`;

class RatchetAndClank1Scene implements SceneGfx {
    private renderHelper: GfxRenderHelper;

    private renderInstList = new GfxRenderInstList();

    private tfragProgram: GfxProgram;
    private tieProgram: GfxProgram;
    private shrubProgram: GfxProgram;
    private skyProgram: GfxProgram;

    private linearSampler: GfxSampler;
    private clampSampler: GfxSampler;

    public textureHolder = new FakeTextureHolder([]);

    private settings = {
        lodSetting: -1, // -1 means dynamic
        lodBias: 40,
        enableTfrag: true,
        enableTies: true,
        enableShrubs: true,
        enableSky: true,
        enableFog: true,
        showPaths: false,
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

        this.linearSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.clampSampler = cache.createSampler({
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

        const data = template.allocateUniformBufferF32(TieProgram.ub_SceneParams, RatchetShaderLib.SceneParamsSizeInFloats);
        let offs = 0;

        // camera transform and position (24 floats)
        const nearClip = 0.01;
        const farClip = 1000;
        viewerInput.camera.setClipPlanes(nearClip, farClip);
        offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec3v(data, offs, cameraPosition, 0);
        offs += fillVec4(data, offs, nearClip, farClip, 0, 0);

        // fog params (8 floats)
        if (this.settings.enableFog) {
            const levelSettings = this.level.levelSettings;
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
            offs += fillVec4(data, offs, 1, 1000, 0, 0);
        }

        // lights (16 * 8 floats)
        const directionalLights = this.level.directionLights;
        for (let i = 0; i < 8; i++) {
            if (i < directionalLights.length) {
                const light = directionalLights[i];
                offs += fillVec4(data, offs, light.directionA.x, -light.directionA.y, light.directionA.z, 0);
                offs += fillVec4(data, offs, light.colorA.r, light.colorA.g, light.colorA.b, 1);
                offs += fillVec4(data, offs, light.directionB.x, -light.directionB.y, light.directionB.z, 0);
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
            // TODO
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
            // if (draw.material < 0) continue; // special materials e.g. glass
            const material = draw.material < 0 ? 0 : draw.material;

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            renderInst.setVertexInput(
                tfragGeometry.inputLayout,
                [{ buffer: tfragGeometry.vertexBuffer, byteOffset: 0 }],
                { buffer: tfragGeometry.lods[lodLevel].indexBuffer, byteOffset: 0 },
            );
            renderInst.setSamplerBindings(0, [
                { gfxTexture: this.textures.tfragTextures[material], gfxSampler: this.linearSampler }
            ]);
            renderInst.setDrawCount(draw.indexCount, draw.startIndex);
            this.renderInstList.submitRenderInst(renderInst);
        }

        this.renderHelper.renderInstManager.popTemplate();
    }

    private renderTie(tieInstanceBatch: TieInstanceBatch, lodLevel: number, cameraPosition: vec3): void {
        const { tieClass, textureIndices, oClass } = tieInstanceBatch;
        const tieGeometry = this.geometries.ties.get(oClass)?.[lodLevel];
        if (!tieGeometry) return;

        const tieInstancesToDraw = tieInstanceBatch.instances.map((tieInstance, i) => {
            // tie instance transform
            const objectMatrix = mat4.create();
            mat4.multiply(objectMatrix, noclipSpaceFromRatchetSpace, tieInstance.matrix);
            let position = vec3.create();
            mat4.getTranslation(position, objectMatrix);
            // mat4.fromTranslation(objectMatrix, position); // temp

            // camera position
            const toCamera = vec3.create();
            vec3.sub(toCamera, position, cameraPosition);
            const distanceToCamera = vec3.len(toCamera);

            const hasLod2 = tieClass.packets[2].length > 0;
            const hasLod1 = tieClass.packets[1].length > 0;

            let desiredLodLevel = this.settings.lodSetting;
            if (this.settings.lodSetting === -1) {
                // dynamic lod
                desiredLodLevel = 0;
                if (distanceToCamera > tieInstance.drawDistance) return null;
                if (distanceToCamera - this.settings.lodBias > tieClass.midDist) desiredLodLevel = 1;
                if (distanceToCamera - this.settings.lodBias * 2 > tieClass.farDist) desiredLodLevel = 2;
            }
            if (desiredLodLevel === 2 && !hasLod2) desiredLodLevel = 1;
            if (desiredLodLevel === 1 && !hasLod1) desiredLodLevel = 0;

            if (desiredLodLevel !== lodLevel) return null;

            return {
                instance: i,
                position,
                distanceToCamera,
                objectMatrix,
            };
        }).filter(tieParams => !!tieParams);

        if (this.settings.showPaths) {
            for (const tieParams of tieInstancesToDraw) {
                if (tieParams.distanceToCamera > 40) continue;
                const mtx = mat4.create();
                mat4.translate(mtx, mtx, tieParams.position);
                mat4.scale(mtx, mtx, [0.005, 0.005, 0.005]);
                this.renderHelper.debugDraw.drawWorldTextMtx(`tie ${oClass} #${tieParams.instance}`, mtx, White);
            }
        }

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
        let i = 0;
        for (const batchSize of batchSizes) {
            const template2 = this.renderHelper.pushTemplateRenderInst();
            const tieParams = template2.allocateUniformBufferF32(TieProgram.ub_TieParams, 16 * 0x4 * MAX_TIE_INSTANCES);
            let tieParamsOffset = 0;
            for (let j = 0; j < batchSize; j++) {
                tieParamsOffset += fillMatrix4x4(tieParams, tieParamsOffset, tieInstancesToDraw[i + j].objectMatrix);
            }
            i += batchSize;
            template2.setInstanceCount(batchSize);

            let vertexPtr = 0;
            for (const draw of tieGeometry.draws) {
                const renderInst = this.renderHelper.renderInstManager.newRenderInst();
                renderInst.setSamplerBindings(0, [
                    { gfxTexture: this.textures.tieTextures[textureIndices[draw.material]], gfxSampler: this.linearSampler }
                ]);
                renderInst.setDrawCount(draw.vertexCount, vertexPtr);
                this.renderInstList.submitRenderInst(renderInst);
                vertexPtr += draw.vertexCount;
            }

            this.renderHelper.renderInstManager.popTemplate();
        }
        this.renderHelper.renderInstManager.popTemplate();
    }

    private renderShrubs(shrubInstanceBatch: ShrubInstanceBatch, cameraPosition: vec3): void {
        const { shrubClass, instances: shrubInstances, textureIndices } = shrubInstanceBatch;
        const oClass = shrubClass.header.oClass;

        const shrubGeometry = this.geometries.shrubs.get(oClass);
        if (!shrubGeometry) return;

        const shrubInstancesToDraw = shrubInstances.map((shrubInstance, i) => {
            // shrub instance transform
            const objectMatrix = mat4.create();
            mat4.multiply(objectMatrix, noclipSpaceFromRatchetSpace, shrubInstance.matrix);
            const position = vec3.create();
            mat4.getTranslation(position, objectMatrix);
            const dist = distanceToCamera(position, cameraPosition);

            // TODO: frustum cull

            // lod
            if (this.settings.lodSetting >= 1) {
                return null;
            } else if (this.settings.lodSetting === -1) {
                if (dist - this.settings.lodBias > shrubInstance.drawDistance) return null;
            }

            return {
                instance: i,
                position,
                objectMatrix,
                distanceToCamera: dist,
                rgb: shrubInstance.color
            };
        }).filter(matrix => !!matrix);

        if (this.settings.showPaths) {
            for (const shrubParams of shrubInstancesToDraw) {
                if (shrubParams.distanceToCamera > 40) continue;
                const mtx = mat4.create();
                mat4.translate(mtx, mtx, shrubParams.position);
                mat4.scale(mtx, mtx, [0.005, 0.005, 0.005]);
                this.renderHelper.debugDraw.drawWorldTextMtx(`shrub ${oClass} #${shrubParams.instance}`, mtx, White);
            }
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
            const shrubParams = template2.allocateUniformBufferF32(ShrubProgram.ub_ShrubParams, (16 * 0x4 + 4 * 0x4) * MAX_SHRUB_INSTANCES);
            let shrubParamsOffset = 0;
            for (let j = 0; j < batchSize; j++) {
                shrubParamsOffset += fillMatrix4x4(shrubParams, shrubParamsOffset, shrubInstancesToDraw[i + j].objectMatrix);
            }
            shrubParamsOffset = 16 * MAX_SHRUB_INSTANCES;
            for (let j = 0; j < batchSize; j++) {
                const color = shrubInstancesToDraw[i + j].rgb;
                shrubParamsOffset += fillVec4(shrubParams, shrubParamsOffset, color.r / 0x40, color.g / 0x40, color.b / 0x40, 1);
            }
            i += batchSize;
            template2.setInstanceCount(batchSize);

            let vertexPtr = 0;
            for (const draw of shrubGeometry.draws) {
                const renderInst = this.renderHelper.renderInstManager.newRenderInst();
                renderInst.setSamplerBindings(0, [
                    { gfxTexture: this.textures.shrubTextures[textureIndices[draw.material]], gfxSampler: this.linearSampler }
                ]);
                renderInst.setDrawCount(draw.vertexCount, vertexPtr);
                this.renderInstList.submitRenderInst(renderInst);
                vertexPtr += draw.vertexCount;
            }

            this.renderHelper.renderInstManager.popTemplate();
        }

        this.renderHelper.renderInstManager.popTemplate();
    }

    private renderSky(cameraPosition: vec3, skyShellIndex: number): void {
        // const objectMatrix = mat4.clone(noclipSpaceFromRatchetSpace);
        const objectMatrix = mat4.create(); // the sky shell is already in world space, so it doesn't need a transform
        mat4.translate(objectMatrix, objectMatrix, cameraPosition); // the sky shell is centered on the camera
        mat4.multiply(objectMatrix, objectMatrix, noclipSpaceFromRatchetSpace); // convert from Ratchet's coordinate space to our coordinate space

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
        const skyParams = template1.allocateUniformBufferF32(SkyProgram.ub_SkyParams, 16);
        let offs = 0;
        offs += fillMatrix4x4(skyParams, offs, objectMatrix);


        for (const draw of skyShellGeometry.draws) {
            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            renderInst.setVertexInput(
                skyShellGeometry.inputLayout,
                [{ buffer: skyShellGeometry.vertexBuffer, byteOffset: 0 }],
                { buffer: skyShellGeometry.indexBuffer, byteOffset: 0 },
            );
            renderInst.setSamplerBindings(0, [
                { gfxTexture: this.textures.skyTextures[draw.material], gfxSampler: this.clampSampler }
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

        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([
            { numSamplers: 1, numUniformBuffers: 2 },
        ]);

        this.fillSceneParams(template, viewerInput, cameraPosition);

        for (const locator of this.level.debug.locators) {
            this.renderHelper.debugDraw.drawLocator(locator.position, 0.05, locator.color);
        }
        for (const line of this.level.debug.lines) {
            this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
        }

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
                for (let lodLevel = 0; lodLevel < 3; lodLevel++) {
                    this.renderTie(this.level.ties[i], lodLevel, cameraPosition);
                }
            }
        }

        if (this.settings.enableShrubs) {
            for (let i = 0; i < this.level.shrubs.length; i++) {
                this.renderShrubs(this.level.shrubs[i], cameraPosition);
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
        const fogColor = this.level.levelSettings.fogColor;
        mainColorDesc.clearColor = { r: fogColor.r / 255, g: fogColor.g / 255, b: fogColor.b / 255, a: 1 };
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
    name: "Ratchet and Clank",
    sceneDescs: [
        new RatchetAndClank1SceneDesc(0, "Veldin Tutorial"),
        new RatchetAndClank1SceneDesc(1, "Novalis"),
        new RatchetAndClank1SceneDesc(2, "Aridia"),
        new RatchetAndClank1SceneDesc(3, "Kerwan"),
        new RatchetAndClank1SceneDesc(4, "Eudora"),
        new RatchetAndClank1SceneDesc(5, "Rilgar"),
        new RatchetAndClank1SceneDesc(6, "Nebula G34"),
        new RatchetAndClank1SceneDesc(7, "Umbris"),
        new RatchetAndClank1SceneDesc(8, "Batalia"),
        new RatchetAndClank1SceneDesc(9, "Gaspar"),
        new RatchetAndClank1SceneDesc(10, "Orxon"),
        new RatchetAndClank1SceneDesc(11, "Pokitaru"),
        new RatchetAndClank1SceneDesc(12, "Hoven"),
        new RatchetAndClank1SceneDesc(13, "Oltanis Orbit"),
        new RatchetAndClank1SceneDesc(14, "Oltanis"),
        new RatchetAndClank1SceneDesc(15, "Quartu"),
        new RatchetAndClank1SceneDesc(16, "Kalebo III"),
        new RatchetAndClank1SceneDesc(17, "Veldin Orbit"),
        new RatchetAndClank1SceneDesc(18, "Veldin Finale"),
    ],
};
