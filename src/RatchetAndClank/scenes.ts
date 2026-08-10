import { mat4, quat, vec3, vec4 } from "gl-matrix";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillMatrix4x4, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCullMode, GfxDevice, GfxMipFilterMode, GfxSampler, GfxSamplerBinding, GfxTexFilterMode, GfxTexture, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { FakeTextureHolder } from "../TextureHolder";
import { TieGeometry, TieProgram, TieRenderer } from "./render-tie";
import { CameraController } from "../Camera";
import { LevelResources, load, loadFilesFromNetwork } from "./loader";
import { createMegaBuffer, MegaBuffer, noclipSpaceFromRatchetSpace, lineChainToLineSegments, GN } from "./utils";
import { TfragGeometry, TfragRenderer } from "./render-tfrag";
import { ShrubGeometry, ShrubRenderer } from "./render-shrub";
import { colorNewFromRGBA, OpaqueBlack, White } from "../Color";
import { SkyAnimationState, SkyGeometry, SkyRenderer } from "./render-sky";
import { RatchetShaderLib } from "./shader-lib";
import { createGfxTextureForPaletteTexture, createTextureAtlases, createTieRgbaTexture_Rac1, createTieRgbaTexture_Rac234, TextureAtlases } from "./textures";
import { CollisionGeometry, CollisionRenderer } from "./render-collision";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { GfxDynamicBufferCache } from "../gfx/render/GfxRenderCache";
import { MobyGeometry, MobyRenderer } from "./render-moby";
import { nArray } from "../util";

const pathBase = (gn: GN) => `RatchetAndClank${gn}`;

class RatchetAndClankScene implements SceneGfx {
    private renderHelper: GfxRenderHelper;

    private renderInstList = new GfxRenderInstList();

    private samplerGeneral: GfxSampler;
    private samplerSky: GfxSampler;

    public textureHolder = new FakeTextureHolder([]);

    private missionsPanel: UI.Panel | null = null;

    private settings = {
        lodSetting: -1, // -1 means dynamic
        lodBias: 40,
        showCollision: false,
        enableTfrag: true,
        enableTies: true,
        enableMobys: true,
        enableBangles: false, // disable bangles by default because, bangles representing armour work well but many objects have destructable bits that overlap their main mesh
        enableShrubs: true,
        enableSky: true,
        enableFog: true,
        enableTextures: true,
        showObjectIds: false,
        showPaths: false,
        mobyMissionFlags: 0xFFFFFFFF, // bitmask to despawn mobys on completed missions
    };

    private levelResources: LevelResources;

    private textures: {
        textureAtlases: TextureAtlases | null,
        tieRgbaTexture: GfxTexture | null,
        skyTextures: GfxTexture[],
    };

    private geometries: {
        tfrag: TfragGeometry | null,
        ties: Map<number, (TieGeometry | null)[]>, // 3 lods, lod 0 is always present
        mobys: Map<number, (MobyGeometry | null)[]>, // 2 lods, both may be null
        shrubs: Map<number, ShrubGeometry>,
        skyShells: Map<number, SkyGeometry>,
        collision: CollisionGeometry | null,
    };

    private animationStates: {
        sky: SkyAnimationState[]
    };

    private renderers: {
        tfrag: TfragRenderer,
        tie: TieRenderer,
        moby: MobyRenderer,
        shrub: ShrubRenderer,
        sky: SkyRenderer,
        collision: CollisionRenderer,
    };

    private instanceDataBuffer: MegaBuffer;
    private instanceDataBufferCache: GfxDynamicBufferCache;

    constructor(private sceneContext: SceneContext, public gn: GN, public levelNumber: number, public chunkNumber: number | null) {
        this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);
        const cache = this.renderHelper.renderCache;

        this.levelResources = {
            levelCoreHeader: null,
            gameplayHeader: null,
            gsTable: null,
            levelSettings: null,
            paths: null,
            grindPaths: null,
            directionLights: null,
            pointLights: null,
            collisionGetter: null,
            tfrags: null,
            tfragTextures: null,
            tieTextures: null,
            tieOClasses: null,
            tieClasses: null,
            tieClassTextureIndices: null,
            tieInstances: null,
            tieInstancesByOClass: null,
            tieAmbientRgbas: null,
            mobyTextures: null,
            mobyGsStashList: null,
            mobyOClasses: null,
            mobyClasses: null,
            mobyClassTextureIndices: null,
            mobyInstances: null,
            mobyInstancesByOClass: null,
            mobyUniqueMissionIds: null,
            shrubTextures: null,
            shrubOClasses: null,
            shrubClasses: null,
            shrubClassTextureIndices: null,
            shrubInstances: null,
            shrubInstancesByOClass: null,
            sky: null,
            skyTextures: null,
        };

        this.samplerGeneral = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.samplerSky = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.textures = {
            textureAtlases: null,
            tieRgbaTexture: null,
            skyTextures: [],
        }

        this.geometries = {
            tfrag: null,
            ties: new Map(),
            mobys: new Map(),
            shrubs: new Map(),
            skyShells: new Map(),
            collision: null,
        };

        this.animationStates = {
            sky: nArray(8, () => ({ quat: quat.create() })),
        };

        this.renderers = {
            tfrag: new TfragRenderer(this.renderHelper),
            tie: new TieRenderer(this.renderHelper),
            moby: new MobyRenderer(this.renderHelper),
            shrub: new ShrubRenderer(this.renderHelper),
            sky: new SkyRenderer(this.renderHelper),
            collision: new CollisionRenderer(this.renderHelper),
        };

        this.instanceDataBuffer = createMegaBuffer(cache.device, "Instance Data", 1024 * 1024);
        this.instanceDataBufferCache = new GfxDynamicBufferCache(cache.device);

        const filePromises = loadFilesFromNetwork(sceneContext.dataFetcher, `${pathBase(this.gn)}/level_${this.levelNumber}`, this.gn, this.chunkNumber);
        load(this.gn, this.chunkNumber, this.levelResources, filePromises).then(() => {
            if (IS_DEVELOPMENT) console.log(this);
        }).then(() => {
            this.populateMissionsList();
        }).catch((e) => {
            console.error(`Error loading level:`, e);
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 400);
    }

    getOrCreateTfragGeometry(): TfragGeometry | null {
        const existing = this.geometries.tfrag;
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const { tfrags, tfragTextures } = this.levelResources;
        if (!tfrags || !tfragTextures) return null;

        this.geometries.tfrag = new TfragGeometry(this.renderHelper.renderCache, tfrags, tfragTextures, this.textures.textureAtlases);
        return this.geometries.tfrag;
    }

    getOrCreateTieGeometry(oClass: number): (TieGeometry | null)[] | null {
        const existing = this.geometries.ties.get(oClass);
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const tieClass = this.levelResources.tieClasses?.get(oClass);
        if (!tieClass) return null;
        const tieTextureIndices = this.levelResources.tieClassTextureIndices?.get(oClass);
        if (!tieTextureIndices) return null;

        const tieGeometry: (TieGeometry | null)[] = [null, null, null];
        for (let i = 0; i < 3; i++) {
            if (tieClass.packets[i].length === 0) continue; // no mesh for this lod
            tieGeometry[i] = new TieGeometry(this.renderHelper.renderCache, oClass, tieClass, i, tieTextureIndices, this.textures.textureAtlases);
        }
        this.geometries.ties.set(oClass, tieGeometry);
        return tieGeometry;
    }

    getOrCreateMobyGeometry(oClass: number): (MobyGeometry | null)[] | null {
        const existing = this.geometries.mobys.get(oClass);
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const mobyClass = this.levelResources.mobyClasses?.get(oClass);
        if (!mobyClass) return null;
        if (!mobyClass.mesh) return null;
        const mobyTextureIndices = this.levelResources.mobyClassTextureIndices?.get(oClass);
        if (!mobyTextureIndices) return null;

        const mobyGeometry: (MobyGeometry | null)[] = [null, null];
        for (let i = 0; i < 2; i++) {
            if (!mobyClass.mesh.packetsByLod[i].length) continue;
            mobyGeometry[i] = new MobyGeometry(this.renderHelper.renderCache, oClass, mobyClass, i, mobyTextureIndices, this.textures.textureAtlases);
        }

        this.geometries.mobys.set(oClass, mobyGeometry);
        return mobyGeometry;
    }

    getOrCreateShrubGeometry(oClass: number): ShrubGeometry | null {
        const existing = this.geometries.shrubs.get(oClass);
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const shrubClass = this.levelResources.shrubClasses?.get(oClass);
        if (!shrubClass) return null;
        const shrubTextureIndices = this.levelResources.shrubClassTextureIndices?.get(oClass);
        if (!shrubTextureIndices) return null;

        const shrubGeometry = new ShrubGeometry(this.renderHelper.renderCache, shrubClass, shrubTextureIndices, this.textures.textureAtlases);
        this.geometries.shrubs.set(oClass, shrubGeometry);
        return shrubGeometry;
    }

    getOrCreateCollisionGeometry(): CollisionGeometry | null {
        const existing = this.geometries.collision;
        if (existing) return existing;

        const { collisionGetter } = this.levelResources;
        if (!collisionGetter) return null;

        this.geometries.collision = new CollisionGeometry(this.renderHelper.renderCache, collisionGetter());
        return this.geometries.collision;
    }

    getOrCreateSkyGeometry(i: number): SkyGeometry | null {
        const existing = this.geometries.skyShells.get(i);
        if (existing) return existing;

        const { sky } = this.levelResources;
        if (!sky) return null;

        const skyGeometry = new SkyGeometry(this.renderHelper.renderCache, i, sky.shells[i]);
        this.geometries.skyShells.set(i, skyGeometry);
        return skyGeometry;
    }

    getOrCreateSkyTextures(): GfxTexture[] | null {
        const existing = this.textures.skyTextures;
        if (existing.length > 0) return existing;

        const { skyTextures } = this.levelResources;
        if (!skyTextures) return null;

        const gfxTextures: GfxTexture[] = [];
        for (let i = 0; i < skyTextures.length; i++) {
            const skyTexture = skyTextures[i];
            const gfxTexture = createGfxTextureForPaletteTexture(this.renderHelper.device, skyTexture).pixelsTexture;
            this.textures.skyTextures.push(gfxTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTexture });
            gfxTextures.push(gfxTexture);
        }
        this.textureHolder.onnewtextures();
        this.textures.skyTextures = gfxTextures;
        return gfxTextures;
    }

    getOrCreateTieRgbaTexture(): GfxTexture | null {
        const existing = this.textures.tieRgbaTexture;
        if (existing) return existing;

        if (this.gn === 1) {
            const { tieInstances } = this.levelResources;
            if (!tieInstances) return null;

            this.textures.tieRgbaTexture = createTieRgbaTexture_Rac1(this.renderHelper.device, tieInstances);
            this.textureHolder.viewerTextures.push({ gfxTexture: this.textures.tieRgbaTexture });
            this.textureHolder.onnewtextures();
            return this.textures.tieRgbaTexture;
        } else {
            const { tieAmbientRgbas } = this.levelResources;
            if (!tieAmbientRgbas) return null;

            this.textures.tieRgbaTexture = createTieRgbaTexture_Rac234(this.renderHelper.device, tieAmbientRgbas);
            this.textureHolder.viewerTextures.push({ gfxTexture: this.textures.tieRgbaTexture });
            this.textureHolder.onnewtextures();
            return this.textures.tieRgbaTexture;
        }
    }

    getOrCreateAtlasTextures(): GfxSamplerBinding[] | null {
        const { tfragTextures, tieTextures, mobyTextures, shrubTextures } = this.levelResources;
        if (!tfragTextures || !tieTextures || !mobyTextures || !shrubTextures) return null;

        if (!this.textures.textureAtlases) {
            this.textures.textureAtlases = createTextureAtlases(this.renderHelper.device, tfragTextures, tieTextures, mobyTextures, shrubTextures);
        }
        return [
            { gfxTexture: this.textures.textureAtlases.gfxTextures[16], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[32], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[64], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[128], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[256], gfxSampler: this.samplerGeneral },
        ];
    }

    private fillSceneParams(template: GfxRenderInst, viewerInput: ViewerRenderInput, cameraPosition: vec3): void {
        const levelSettings = this.levelResources.levelSettings ?? {
            backgroundColor: OpaqueBlack,
            fogColor: OpaqueBlack,
            fogNearDistance: 0,
            fogFarDistance: 1,
            fogNearIntensity: 0,
            fogFarIntensity: 0,
        };

        const data = template.allocateUniformBufferF32(TieProgram.ub_SceneParams, RatchetShaderLib.SceneParamsSizeInFloats);
        let offs = 0;

        // camera transform (16 floats)
        const nearClip = 0.05;
        const farClip = 1024;
        viewerInput.camera.setClipPlanes(nearClip, farClip);
        offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);

        // camera data (12 floats)
        offs += fillVec3v(data, offs, cameraPosition, 0);
        const cameraDirection = vec3.fromValues(viewerInput.camera.viewMatrix[2], viewerInput.camera.viewMatrix[6], viewerInput.camera.viewMatrix[10]);
        offs += fillVec3v(data, offs, cameraDirection, 0);
        offs += fillVec4(data, offs, nearClip, farClip, viewerInput.camera.isOrthographic ? 1 : 0, 0);

        // lod settings (4 floats)
        offs += fillVec4(data, offs, this.settings.lodSetting, this.settings.lodBias, 0, 0);

        // render settings (4 floats)
        offs += fillVec4(data, offs, this.settings.enableTextures ? 1 : 0, this.settings.mobyMissionFlags, 0, 0);

        // background color (4 floats)
        const backgroundColor = levelSettings.backgroundColor;
        offs += fillVec4(data, offs, backgroundColor.r / 0xFF, backgroundColor.g / 0xFF, backgroundColor.b / 0xFF, 1);

        // fog params (12 floats)
        if (this.settings.enableFog) {
            const fogColor = levelSettings.fogColor;
            offs += fillVec4(data, offs, fogColor.r / 0xFF, fogColor.g / 0xFF, fogColor.b / 0xFF, 1);
            offs += fillVec4(data, offs,
                levelSettings.fogNearDistance / 1024,
                levelSettings.fogFarDistance / 1024,
                0,
                0,
            );
            offs += fillVec4(data, offs,
                1 - (levelSettings.fogNearIntensity / 255),
                1 - (levelSettings.fogFarIntensity / 255),
                0,
                0,
            );
        } else {
            offs += fillVec4(data, offs, 0, 0, 0, 0);
            offs += fillVec4(data, offs, 0, 1, 0, 0);
            offs += fillVec4(data, offs, 0, 0, 0, 0);
        }

        // lights (16 * 16 floats)
        const directionalLights = this.levelResources.directionLights ?? [];
        for (let i = 0; i < 16; i++) {
            if (i < directionalLights.length) {
                const light = directionalLights[i];
                offs += fillVec4(data, offs, -light.directionA.x, -light.directionA.z, light.directionA.y, 0);
                offs += fillVec4(data, offs, light.colorA.r, light.colorA.g, light.colorA.b, -light.colorA.a);
                offs += fillVec4(data, offs, -light.directionB.x, -light.directionB.z, light.directionB.y, 0);
                offs += fillVec4(data, offs, light.colorB.r, light.colorB.g, light.colorB.b, -light.colorB.a);
            } else {
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
            }
        }
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const cameraPosition = vec3.create();
        mat4.getTranslation(cameraPosition, viewerInput.camera.worldMatrix);
        const isOrtho = viewerInput.camera.isOrthographic;
        const cameraFrustum = viewerInput.camera.frustum;

        let lodSetting = this.settings.lodSetting;
        if (isOrtho && lodSetting === -1) lodSetting = 0; // always treat dynamic lod as high lod in ortho view
        const lodBias = this.settings.lodBias;

        // setup
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({
            cullMode: GfxCullMode.None, // the game has backface culling only on objects within a specific per-object distance from the camera
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
        template.setBindingLayouts([
            { numSamplers: 1, numUniformBuffers: 2 },
        ]);
        this.fillSceneParams(template, viewerInput, cameraPosition);
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // textures shared between tfrags, ties, and shrubs
        const atlasTextures = this.getOrCreateAtlasTextures();

        // sky
        const skyTextures = this.getOrCreateSkyTextures();
        if (this.settings.enableSky && skyTextures && this.levelResources.sky?.shells) {
            for (let i = 0; i < this.levelResources.sky.shells.length; i++) {
                const skyShellGeometry = this.getOrCreateSkyGeometry(i);
                if (!skyShellGeometry) continue;
                if (!skyTextures) continue;
                this.renderers.sky.renderSky(this.renderInstList, cameraPosition, viewerInput.deltaTime, skyShellGeometry, skyTextures, this.samplerSky, this.animationStates.sky[i], isOrtho);
            }
        }

        // collision
        if (this.settings.showCollision) {
            const collisionGeometry = this.getOrCreateCollisionGeometry();
            if (collisionGeometry) {
                this.renderers.collision.renderCollision(this.renderInstList, cameraPosition, collisionGeometry);
            }
        }

        // tfrag
        if (this.settings.enableTfrag && atlasTextures) {
            const tfragGeometry = this.getOrCreateTfragGeometry();
            if (tfragGeometry) {
                this.renderers.tfrag.renderTfrag(this.renderInstList, tfragGeometry, lodSetting, atlasTextures);
            }
        }

        // ties
        const tieRgbaTexture = this.getOrCreateTieRgbaTexture();
        if (this.settings.enableTies && atlasTextures && tieRgbaTexture) {
            const tieTextureMappings = [...atlasTextures, { gfxTexture: tieRgbaTexture, gfxSampler: this.samplerGeneral }];
            const tieOClasses = this.levelResources.tieOClasses ?? [];
            for (let i = 0; i < tieOClasses.length; i++) {
                const oClass = tieOClasses[i];
                const tieClass = this.levelResources.tieClasses?.get(oClass);
                if (!tieClass) continue;
                const instances = this.levelResources.tieInstancesByOClass?.get(oClass);
                if (!instances) continue;
                const geometriesByLod = this.getOrCreateTieGeometry(oClass);
                if (!geometriesByLod) continue;
                this.renderers.tie.renderTie(this.renderInstList, geometriesByLod, tieClass, instances, tieTextureMappings, cameraPosition, cameraFrustum, lodSetting, lodBias, this.gn, this.instanceDataBuffer);
            }
        }

        // mobys
        if (this.settings.enableMobys && atlasTextures) {
            const mobyOClasses = this.levelResources.mobyOClasses ?? [];
            for (let i = 0; i < mobyOClasses.length; i++) {
                const oClass = mobyOClasses[i];
                const mobyClass = this.levelResources.mobyClasses?.get(oClass);
                if (!mobyClass) continue;
                const mobyInstances = this.levelResources.mobyInstancesByOClass?.get(oClass);
                if (!mobyInstances) continue;
                const mobyGeometryArr = this.getOrCreateMobyGeometry(oClass);
                if (!mobyGeometryArr) continue;
                this.renderers.moby.renderMoby(this.renderInstList, mobyGeometryArr, mobyClass, mobyInstances, atlasTextures, cameraPosition, cameraFrustum, lodSetting, lodBias, this.settings.enableBangles, this.settings.mobyMissionFlags, this.instanceDataBuffer);
            }
        }

        // shrubs
        if (this.settings.enableShrubs && atlasTextures) {
            const shrubOClasses = this.levelResources.shrubOClasses ?? [];
            for (let i = 0; i < shrubOClasses.length; i++) {
                const oClass = shrubOClasses[i];
                const instances = this.levelResources.shrubInstancesByOClass?.get(oClass);
                if (!instances) continue;
                const geometry = this.getOrCreateShrubGeometry(oClass);
                if (!geometry) continue;
                this.renderers.shrub.renderShrub(this.renderInstList, geometry, instances, atlasTextures, cameraPosition, cameraFrustum, lodSetting, lodBias, this.instanceDataBuffer);
            }
        }

        // object ids
        if (this.settings.showObjectIds) {
            const renderObjectPosition = (text: string, _pos: vec3) => {
                const pos = vec3.clone(_pos);
                vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
                this.renderHelper.debugDraw.drawLocator(pos, 0.3, White);
                const mat = mat4.fromTranslation(mat4.create(), pos);
                const rotation = quat.create();
                mat4.getRotation(rotation, viewerInput.camera.worldMatrix);
                mat4.fromRotationTranslationScale(mat, rotation, pos, vec3.fromValues(0.01, 0.01, 0.01));
                if (vec3.distance(pos, cameraPosition) < 40) {
                    this.renderHelper.debugDraw.drawWorldTextMtx(String(text), mat, White);
                }
            }

            if (this.settings.enableTies) {
                const tieInstances = this.levelResources.tieInstances ?? [];
                for (let i = 0; i < tieInstances.length; i++) {
                    const inst = tieInstances[i];
                    renderObjectPosition("tie" + inst.oClass, mat4.getTranslation(vec3.create(), inst.matrix));
                }
            }
            if (this.settings.enableMobys) {
                const mobyInstances = this.levelResources.mobyInstances ?? [];
                for (let i = 0; i < mobyInstances.length; i++) {
                    const inst = mobyInstances[i];
                    renderObjectPosition("moby" + inst.oClass, vec3.fromValues(inst.position.x, inst.position.y, inst.position.z));
                }
            }
            if (this.settings.enableShrubs) {
                const shrubInstances = this.levelResources.shrubInstances ?? [];
                for (let i = 0; i < shrubInstances.length; i++) {
                    const inst = shrubInstances[i];
                    renderObjectPosition("shrub" + inst.oClass, mat4.getTranslation(vec3.create(), inst.matrix));
                }
            }
        }

        // paths
        if (this.settings.showPaths) {
            const paths = this.levelResources.paths ?? [];
            const grindPaths = this.levelResources.grindPaths ?? [];
            const regularPathColor = colorNewFromRGBA(0.1, 0.3, 0.8, 1);
            const grindPathColor = colorNewFromRGBA(0.7, 0.4, 0.1, 1);
            for (const path of paths) {
                for (const line of lineChainToLineSegments(path.points, regularPathColor)) this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
            }
            for (const path of grindPaths) {
                for (const line of lineChainToLineSegments(path.points, grindPathColor)) this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
            }
        }

        this.instanceDataBuffer.upload();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const backgroundColor = this.levelResources.levelSettings?.backgroundColor ?? OpaqueBlack;
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

        const lodBias = new UI.Slider('LoD Bias', this.settings.lodBias, -20, 200);
        lodBias.onvalue = (n: number) => {
            this.settings.lodBias = n;
        };
        renderSettingsPanel.contents.appendChild(lodBias.elem);

        const showCollision = new UI.Checkbox('Show Collision', this.settings.showCollision);
        showCollision.onchanged = () => {
            this.settings.showCollision = showCollision.checked;
            enableTfrag.setChecked(this.settings.enableTfrag = !showCollision.checked);
            enableTies.setChecked(this.settings.enableTies = !showCollision.checked);
            enableShrubs.setChecked(this.settings.enableShrubs = !showCollision.checked);
        };
        renderSettingsPanel.contents.appendChild(showCollision.elem);

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

        const enableMobys = new UI.Checkbox('Enable Mobys', this.settings.enableMobys);
        enableMobys.onchanged = () => {
            this.settings.enableMobys = enableMobys.checked;
        };
        renderSettingsPanel.contents.appendChild(enableMobys.elem);

        const enableBangles = new UI.Checkbox('Enable Bangles', this.settings.enableBangles);
        enableBangles.onchanged = () => {
            this.settings.enableBangles = enableBangles.checked;
        };
        renderSettingsPanel.contents.appendChild(enableBangles.elem);

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

        const showObjectIds = new UI.Checkbox('Object IDs', this.settings.showObjectIds);
        showObjectIds.onchanged = () => {
            this.settings.showObjectIds = showObjectIds.checked;
        };
        renderSettingsPanel.contents.appendChild(showObjectIds.elem);

        const showPaths = new UI.Checkbox('Show Paths', this.settings.showPaths);
        showPaths.onchanged = () => {
            this.settings.showPaths = showPaths.checked;
        };
        renderSettingsPanel.contents.appendChild(showPaths.elem);

        const missionsPanel = new UI.Panel();
        missionsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        missionsPanel.setTitle(UI.LAYER_ICON, 'Moby Mission Flags');
        this.missionsPanel = missionsPanel;

        return [renderSettingsPanel, missionsPanel];
    }

    populateMissionsList() {
        if (!this.missionsPanel) return;
        if (!this.levelResources.mobyUniqueMissionIds) return;

        const missionSelector = new UI.MultiSelect();
        const missionList = Array.from(this.levelResources.mobyUniqueMissionIds.keys())
            .filter(num => num != -1)
            .sort((a, b) => a - b);
        missionSelector.setStrings(missionList.map(num => `Mission ${num}`));
        for (let i = 0; i < missionList.length; i++) missionSelector.setItemSelected(i, true);
        missionSelector.onitemchanged = (index: number, v: boolean) => {
            if (v) {
                this.settings.mobyMissionFlags |= (1 << index);
            } else {
                this.settings.mobyMissionFlags &= ~(1 << index);
            }
        };
        this.missionsPanel.contents.appendChild(missionSelector.elem);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        const allGeometries = [
            this.geometries.tfrag,
            ...(Array.from(this.geometries.ties.values()).flat(1)),
            ...(Array.from(this.geometries.mobys.values()).flat(1)),
            ...this.geometries.shrubs.values(),
            ...this.geometries.skyShells.values(),
            this.geometries.collision,
        ];
        for (const geometry of allGeometries) {
            geometry?.destroy(device);
        }

        const allTextures = [
            ...(this.textures.textureAtlases ? Object.values(this.textures.textureAtlases?.gfxTextures) : []),
            this.textures.tieRgbaTexture,
            ...this.textures.skyTextures,
        ]
        for (const texture of allTextures) {
            if (texture) {
                device.destroyTexture(texture);
            }
        }

        this.instanceDataBuffer.destroy();

        this.textureHolder.destroy(device);

        if (IS_DEVELOPMENT) {
            device.checkForLeaks();
        }
    }
}

class RatchetAndClank1SceneDesc implements SceneDesc {
    id: string;

    constructor(public levelNumber: number, public name: string) {
        this.id = String(levelNumber);
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new RatchetAndClankScene(sceneContext, 1, this.levelNumber, null);
    }
}

class RatchetAndClank2SceneDesc implements SceneDesc {
    id: string;

    constructor(public levelNumber: number, public chunkNumber: number | null, public name: string) {
        if (chunkNumber === null) {
            this.id = String(levelNumber);
        } else {
            this.id = `${levelNumber}_${chunkNumber}`;
        }
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new RatchetAndClankScene(sceneContext, 2, this.levelNumber, this.chunkNumber);
    }
}

class RatchetAndClank3SceneDesc implements SceneDesc {
    id: string;

    constructor(public levelNumber: number, public chunkNumber: number | null, public name: string) {
        if (chunkNumber === null) {
            this.id = String(levelNumber);
        } else {
            this.id = `${levelNumber}_${chunkNumber}`;
        }
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new RatchetAndClankScene(sceneContext, 3, this.levelNumber, this.chunkNumber);
    }
}

class RatchetAndClank4SceneDesc implements SceneDesc {
    id: string;

    constructor(public levelNumber: number, public chunkNumber: number | null, public name: string) {
        if (chunkNumber === null) {
            this.id = String(levelNumber);
        } else {
            this.id = `${levelNumber}_${chunkNumber}`;
        }
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new RatchetAndClankScene(sceneContext, 4, this.levelNumber, this.chunkNumber);
    }
}

const SPLITSCREEN_RAC3 = 10;
const SPLITSCREEN_RAC4 = 20;

export const sceneGroup1: SceneGroup = {
    id: "RatchetAndClank1",
    name: "Ratchet & Clank",
    sceneDescs: [
        new RatchetAndClank1SceneDesc(0, "Veldin (Tutorial)"),
        new RatchetAndClank1SceneDesc(1, "Novalis"),
        new RatchetAndClank1SceneDesc(2, "Aridia"),
        new RatchetAndClank1SceneDesc(3, "Metropolis"),
        new RatchetAndClank1SceneDesc(4, "Eudora"),
        new RatchetAndClank1SceneDesc(5, "Blackwater City"),
        new RatchetAndClank1SceneDesc(6, "Nebula G34"),
        new RatchetAndClank1SceneDesc(7, "Quark's HQ"),
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
        new RatchetAndClank1SceneDesc(18, "Veldin"),
    ],
};

export const sceneGroup2: SceneGroup = {
    id: "RatchetAndClank2",
    name: "Ratchet & Clank: Going Commando",
    hidden: !IS_DEVELOPMENT,
    sceneDescs: [
        "Main Game",
        new RatchetAndClank2SceneDesc(0, null, "Aranos (Tutorial)"),
        new RatchetAndClank2SceneDesc(1, 0, "Oozla"),
        new RatchetAndClank2SceneDesc(1, 1, "Oozla (Secret boss)"),
        new RatchetAndClank2SceneDesc(25, null, "Wupash Nebula (Space)"),
        new RatchetAndClank2SceneDesc(2, 0, "Maktar Resort"),
        new RatchetAndClank2SceneDesc(2, 1, "Maktar Resort (Arena)"),
        new RatchetAndClank2SceneDesc(26, null, "Jamming Array"),
        new RatchetAndClank2SceneDesc(3, null, "Megapolis"),
        new RatchetAndClank2SceneDesc(4, 0, "Barlow"),
        new RatchetAndClank2SceneDesc(4, 1, "Barlow (Race)"),
        new RatchetAndClank2SceneDesc(5, null, "Thug Rendezvous (Space)"),
        new RatchetAndClank2SceneDesc(6, null, "Notak"),
        new RatchetAndClank2SceneDesc(24, null, "Slip Cognito's Ship Shack"),
        new RatchetAndClank2SceneDesc(7, 0, "Siberius"),
        new RatchetAndClank2SceneDesc(7, 1, "Siberius (Chase sequence)"),
        new RatchetAndClank2SceneDesc(8, 0, "Tabora (Tunnel)"),
        new RatchetAndClank2SceneDesc(8, 1, "Tabora"),
        new RatchetAndClank2SceneDesc(9, null, "Dobbo"),
        new RatchetAndClank2SceneDesc(22, null, "Dobbo Orbit (Giant Clank)"),
        new RatchetAndClank2SceneDesc(10, null, "Deep Space Disposal (Space)"),
        new RatchetAndClank2SceneDesc(11, 0, "Joba"),
        new RatchetAndClank2SceneDesc(11, 1, "Joba (Race & arena)"),
        new RatchetAndClank2SceneDesc(12, null, "Todano"),
        new RatchetAndClank2SceneDesc(13, null, "Boldan"),
        new RatchetAndClank2SceneDesc(14, null, "Aranos"),
        new RatchetAndClank2SceneDesc(15, null, "Thugs-4-Less Fleet (Space)"),
        new RatchetAndClank2SceneDesc(16, null, "Snivelak"),
        new RatchetAndClank2SceneDesc(17, null, "Smolg"),
        new RatchetAndClank2SceneDesc(18, null, "Damosel"),
        new RatchetAndClank2SceneDesc(23, null, "Damosel Orbit (Giant Clank)"),
        new RatchetAndClank2SceneDesc(19, 0, "Grelbin"),
        new RatchetAndClank2SceneDesc(19, 1, "Grelbin (Glider)"),
        new RatchetAndClank2SceneDesc(19, 2, "Grelbin (Hypnomatic)"),
        new RatchetAndClank2SceneDesc(20, 0, "Yeedil"),
        new RatchetAndClank2SceneDesc(20, 1, "Yeedil (Interior)"),
        new RatchetAndClank2SceneDesc(20, 2, "Yeedil (Boss)"),

        "Extras",
        new RatchetAndClank2SceneDesc(30, null, "Insomniac Museum, Burbank"),
    ],
};

export const sceneGroup3: SceneGroup = {
    id: "RatchetAndClank3",
    name: "Ratchet & Clank: Up Your Arsenal",
    hidden: !IS_DEVELOPMENT,
    sceneDescs: [
        "Main Game",
        new RatchetAndClank3SceneDesc(1, null, "Veldin"),
        new RatchetAndClank3SceneDesc(2, null, "Florana"),
        new RatchetAndClank3SceneDesc(3, null, "Starship Pheonix"),
        new RatchetAndClank3SceneDesc(6, null, "Starship Pheonix (Under attack)"),
        new RatchetAndClank3SceneDesc(4, 0, "Marcadia"),
        new RatchetAndClank3SceneDesc(4, 1, "Marcadia (Refractor)"),
        new RatchetAndClank3SceneDesc(4, 2, "Marcadia (Ranger missions)"),
        new RatchetAndClank3SceneDesc(7, 0, "Annihilation Nation (Gauntlet)"),
        new RatchetAndClank3SceneDesc(7, 1, "Annihilation Nation (Mission select & arena)"),
        new RatchetAndClank3SceneDesc(8, null, "Aquatos"),
        new RatchetAndClank3SceneDesc(27, null, "Aquatos (Tyhrra-Guise / Clank)"),
        new RatchetAndClank3SceneDesc(28, null, "Aquatos (Sewer Crystals)"),
        new RatchetAndClank3SceneDesc(9, 0, "Tyhrranosis (First visit)"),
        new RatchetAndClank3SceneDesc(9, 2, "Tyhrranosis"),
        new RatchetAndClank3SceneDesc(9, 1, "Tyhrranosis (Boss)"),
        new RatchetAndClank3SceneDesc(29, null, "Tyhrranosis (Ranger Missions)"),
        new RatchetAndClank3SceneDesc(5, null, "Daxx"),
        new RatchetAndClank3SceneDesc(11, null, "Obani Gemini"),
        new RatchetAndClank3SceneDesc(23, null, "Holostar Studios (Clank)"),
        new RatchetAndClank3SceneDesc(13, null, "Holostar Studios (Ratchet)"),
        new RatchetAndClank3SceneDesc(12, null, "Blackwater City (Ranger missions)"),
        new RatchetAndClank3SceneDesc(21, null, "Obani Draco"),
        new RatchetAndClank3SceneDesc(10, 0, "Zeldrin Starport"),
        new RatchetAndClank3SceneDesc(10, 1, "Zeldrin Starport (The Leviathan)"),
        new RatchetAndClank3SceneDesc(10, 2, "Zeldrin Starport (Cutscene)"),
        new RatchetAndClank3SceneDesc(16, null, "Metropolis"),
        new RatchetAndClank3SceneDesc(26, null, "Metropolis (Ranger missions)"),
        new RatchetAndClank3SceneDesc(17, null, "Zeldrin"),
        new RatchetAndClank3SceneDesc(18, null, "Aridia"),
        new RatchetAndClank3SceneDesc(19, 0, "Quark's Hideout"),
        new RatchetAndClank3SceneDesc(19, 1, "Quark's Hideout (Clank)"),
        new RatchetAndClank3SceneDesc(14, null, "Koros"),
        new RatchetAndClank3SceneDesc(22, null, "Mylon"),
        new RatchetAndClank3SceneDesc(20, null, "Mylon (Boss)"),

        "Vid-Comics",
        new RatchetAndClank3SceneDesc(31, null, "Vid-Comic 1: Booty is in the Eye of the Beholder"),
        new RatchetAndClank3SceneDesc(33, null, "Vid-Comic 2: Arriba Amoeba!"),
        new RatchetAndClank3SceneDesc(34, null, "Vid-Comic 3: Shadow of the Robot"),
        new RatchetAndClank3SceneDesc(32, null, "Vid-Comic 4: Deja Q All Over Again"),
        new RatchetAndClank3SceneDesc(35, null, "Vid-Comic 5: The Shaming of the Q"),

        "Multiplayer",
        new RatchetAndClank3SceneDesc(40, null, "MP Bakisi Isles"),
        new RatchetAndClank3SceneDesc(41, null, "MP Hoven Gorge"),
        new RatchetAndClank3SceneDesc(42, null, "MP Outpost X12"),
        new RatchetAndClank3SceneDesc(43, null, "MP Korgon Outpost"),
        new RatchetAndClank3SceneDesc(44, null, "MP Metropolis"),
        new RatchetAndClank3SceneDesc(45, null, "MP Blackwater City"),
        new RatchetAndClank3SceneDesc(46, null, "MP Command Center"),
        new RatchetAndClank3SceneDesc(47, null, "MP Blackwater Docks"),
        new RatchetAndClank3SceneDesc(48, null, "MP Aquatos Sewers"),
        new RatchetAndClank3SceneDesc(49, null, "MP Marcadia Palace"),

        "Multiplayer (Splitscreen)",
        new RatchetAndClank3SceneDesc(SPLITSCREEN_RAC3 + 40, null, "Splitscreen MP Bakisi Isles"),
        new RatchetAndClank3SceneDesc(SPLITSCREEN_RAC3 + 41, null, "Splitscreen MP Hoven Gorge"),
        new RatchetAndClank3SceneDesc(SPLITSCREEN_RAC3 + 42, null, "Splitscreen MP Outpost X12"),
        new RatchetAndClank3SceneDesc(SPLITSCREEN_RAC3 + 43, null, "Splitscreen MP Korgon Outpost"),
        new RatchetAndClank3SceneDesc(SPLITSCREEN_RAC3 + 44, null, "Splitscreen MP Metropolis"),
        new RatchetAndClank3SceneDesc(SPLITSCREEN_RAC3 + 45, null, "Splitscreen MP Blackwater City"),

        "Extras",
        new RatchetAndClank3SceneDesc(24, 0, "Insomniac Museum"),
        new RatchetAndClank3SceneDesc(24, 1, "Insomniac Museum (Florana Race)"),
        new RatchetAndClank3SceneDesc(30, null, "Vid-Comic 0: Unnamed Prototype"),
        new RatchetAndClank3SceneDesc(36, null, "Vid-Comic 1: Special Edition"),

        // broken levels:
        // 39: a menu?
        // 8_1 and 8_2: misconfigured chunks with nothing in them
    ],
};

export const sceneGroup4: SceneGroup = {
    id: "RatchetAndClank4",
    name: "Ratchet: Deadlocked",
    hidden: !IS_DEVELOPMENT,
    sceneDescs: [
        "Main Game",
        new RatchetAndClank4SceneDesc(41, 0, "MP Battledome Tower (Tutorial)"),
        new RatchetAndClank4SceneDesc(1, 0, "DreadZone Station (Hub)"),
        new RatchetAndClank4SceneDesc(1, 1, "DreadZone Station (Arenas)"),
        new RatchetAndClank4SceneDesc(2, null, "Catacrom Graveyard"),
        new RatchetAndClank4SceneDesc(4, null, "Sarathos Swamp"),
        new RatchetAndClank4SceneDesc(5, 0, "Dark Cathedral"),
        new RatchetAndClank4SceneDesc(5, 1, "Dark Cathedral (Interior)"),
        new RatchetAndClank4SceneDesc(6, null, "Temple of Shaar"),
        new RatchetAndClank4SceneDesc(7, null, "Valix Lighthouse"),
        new RatchetAndClank4SceneDesc(8, null, "Mining Facility"),
        new RatchetAndClank4SceneDesc(10, null, "Torval Ruins"),
        new RatchetAndClank4SceneDesc(11, null, "Tempus Station"),
        new RatchetAndClank4SceneDesc(13, null, "Maraxus Prison"),
        new RatchetAndClank4SceneDesc(14, 0, "Ghost Station"),
        new RatchetAndClank4SceneDesc(14, 1, "Ghost Station (Interior)"),
        new RatchetAndClank4SceneDesc(15, 0, "DreadZone Station (Finale)"),
        new RatchetAndClank4SceneDesc(15, 1, "DreadZone Station (Boss)"),

        "Main Game (Splitscreen Coop)",
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 41, 0, "Splitscreen MP Battledome Tower (Tutorial)"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 1, 0, "Splitscreen DreadZone Station (Hub)"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 1, 1, "Splitscreen DreadZone Station (Arenas)"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 2, null, "Splitscreen Catacrom Graveyard"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 4, null, "Splitscreen Sarathos Swamp"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 5, 0, "Splitscreen Dark Cathedral"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 5, 1, "Splitscreen Dark Cathedral (Interior)"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 6, null, "Splitscreen Temple of Shaar"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 7, null, "Splitscreen Valix Lighthouse"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 8, null, "Splitscreen Mining Facility"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 10, null, "Splitscreen Torval Ruins"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 11, null, "Splitscreen Tempus Station"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 13, null, "Splitscreen Maraxus Prison"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 14, 0, "Splitscreen Ghost Station"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 14, 1, "Splitscreen Ghost Station (Interior)"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 15, 0, "Splitscreen DreadZone Station (Finale)"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 15, 1, "Splitscreen DreadZone Station (Boss)"),

        "Multiplayer",
        new RatchetAndClank4SceneDesc(41, 1, "MP Battledome Tower"),
        new RatchetAndClank4SceneDesc(42, null, "MP Catacrom Graveyard"),
        new RatchetAndClank4SceneDesc(44, null, "MP Sarathos Swamp"),
        new RatchetAndClank4SceneDesc(45, 0, "MP Dark Cathedral"),
        new RatchetAndClank4SceneDesc(46, null, "MP Temple of Shaar"),
        new RatchetAndClank4SceneDesc(47, null, "MP Valix Lighthouse"),
        new RatchetAndClank4SceneDesc(48, null, "MP Mining Facility"),
        new RatchetAndClank4SceneDesc(50, null, "MP Torval Ruins"),
        new RatchetAndClank4SceneDesc(51, null, "MP Tempus Station"),
        new RatchetAndClank4SceneDesc(53, null, "MP Maraxus Prison"),
        new RatchetAndClank4SceneDesc(54, 0, "MP Ghost Station"),

        "Multiplayer",
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 41, 1, "Splitscreen MP Battledome Tower"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 42, null, "Splitscreen MP Catacrom Graveyard"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 44, null, "Splitscreen MP Sarathos Swamp"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 45, 0, "Splitscreen MP Dark Cathedral"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 46, null, "Splitscreen MP Temple of Shaar"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 47, null, "Splitscreen MP Valix Lighthouse"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 48, null, "Splitscreen MP Mining Facility"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 50, null, "Splitscreen MP Torval Ruins"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 51, null, "Splitscreen MP Tempus Station"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 53, null, "Splitscreen MP Maraxus Prison"),
        new RatchetAndClank4SceneDesc(SPLITSCREEN_RAC4 + 54, 0, "Splitscreen MP Ghost Station"),

        // broken levels:
        // 0: a menu?
        // 45_1, 54_1, 65_1, 74_1: misconfigured chunks
    ],
};
