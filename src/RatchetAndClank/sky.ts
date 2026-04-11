import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { RatchetShaderLib } from "./shader-lib";
import { SkyShell } from "./structs-core";

export class SkyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_ST = 1;
    public static a_Rgba = 2;
    public static a_Alpha = 3;

    public static elementsPerVertex = 10; // xyz, st, rgba, a

    public static ub_SceneParams = 0;
    public static ub_SkyParams = 1;

    public override vert = `
${SkyProgram.Common}

layout(location = ${SkyProgram.a_Position}) in vec3 a_Position;
layout(location = ${SkyProgram.a_ST}) in vec2 a_ST;
layout(location = ${SkyProgram.a_Rgba}) in vec4 a_Rgba;
layout(location = ${SkyProgram.a_Alpha}) in float a_Alpha;

out vec2 v_ST;
out vec4 v_Rgba;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_SkyTransform) * vec4(a_Position.xyz, 1.0f);
    gl_Position = (UnpackMatrix(u_ClipFromWorld) * t_PositionWorld).xyww; // infinite depth

    if (u_Textured == 1.0) {
        v_ST = a_ST;
        v_Rgba = vec4(1.0, 1.0, 1.0, a_Alpha);
    } else {
        v_Rgba = vec4(a_Rgba.rgb, a_Alpha * a_Rgba.a);
    }
}
`;

    public override frag = `
${SkyProgram.Common}
${RatchetShaderLib.CommonFragmentShader}
in vec2 v_ST;
in vec4 v_Rgba;

void main() {
    if (u_Textured == 1.0) {
        gl_FragColor = v_Rgba * texture(SAMPLER_2D(u_Texture), v_ST);
    } else {
        gl_FragColor = v_Rgba;
    }
    gl_FragColor = vec4(adjustSaturation(gl_FragColor.xyz, SATURATION_ADJUST), gl_FragColor.a);
}
`;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_SkyParams {
    Mat4x4 u_SkyTransform;
    float u_Textured;
};

layout(location = 0) uniform sampler2D u_Texture;
`;

}

export class SkyGeometry {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public draws: { material: number, flags: { textured: boolean }, indexCount: number, startIndex: number }[] = [];
    public assembled: ReturnType<typeof assembleSkyShellGeometry>;

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, skyShell: SkyShell) {
        const device = cache.device;

        const assembled = assembleSkyShellGeometry(skyShell);
        this.assembled = assembled;

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.vertexArrayBuffer.buffer);
        device.setResourceName(this.vertexBuffer, `Sky (VB)`);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, assembled.indexArrayBuffer.buffer);
        device.setResourceName(this.indexBuffer, `Sky (IB)`);

        this.draws = assembled.draws;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                {
                    location: SkyProgram.a_Position,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 0,
                    bufferIndex: 0,
                },
                {
                    location: SkyProgram.a_ST,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 3 * 4,
                    bufferIndex: 0,
                },
                {
                    location: SkyProgram.a_Rgba,
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 5 * 4,
                    bufferIndex: 0,
                },
                {
                    location: SkyProgram.a_Alpha,
                    format: GfxFormat.F32_R,
                    bufferByteOffset: 9 * 4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                {
                    byteStride: SkyProgram.elementsPerVertex * 0x4,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                },
            ],

            indexBufferFormat: GfxFormat.U32_R,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
    }
}


function assembleSkyShellGeometry(skyShell: SkyShell) {
    const positionScale = 1 / 1024;
    const texcoordScale = 1 / 4096;

    const verts: {
        x: number,
        y: number,
        z: number,
        s: number,
        t: number,
        r: number,
        g: number,
        b: number,
        a1: number,
        a2: number,
    }[] = [];
    const draws: { material: number, flags: { textured: boolean }, indices: number[] }[] = [];

    let baseVertex = 0;
    for (let i = 0; i < skyShell.clusters.length; i++) {
        const cluster = skyShell.clusters[i];
        for (let j = 0; j < cluster.vertices.length; j++) {
            const vert = cluster.vertices[j];
            const st = cluster.texcoords[j];
            const rgba = cluster.rgbas[j];
            if (skyShell.header.flags.textured) {
                verts.push({
                    x: vert.x,
                    y: vert.y,
                    z: vert.z,
                    s: st.s,
                    t: st.t,
                    r: 0,
                    g: 0,
                    b: 0,
                    a1: 1,
                    a2: vert.alpha,
                });
            } else {
                verts.push({
                    x: vert.x,
                    y: vert.y,
                    z: vert.z,
                    s: 0,
                    t: 0,
                    r: rgba.r,
                    g: rgba.g,
                    b: rgba.b,
                    a1: rgba.a,
                    a2: vert.alpha,
                });
            }
        }
        for (let j = 0; j < cluster.triangles.length; j++) {
            const triangle = cluster.triangles[j];
            for (let k = 0; k < 3; k++) {
                draws.push({
                    material: triangle.texture,
                    flags: skyShell.header.flags,
                    indices: [
                        triangle.indices[0] + baseVertex,
                        triangle.indices[1] + baseVertex,
                        triangle.indices[2] + baseVertex,
                    ],
                });
            }
        }
        baseVertex += cluster.vertices.length;
    }

    const vertexArrayBuffer = new Float32Array(verts.length * SkyProgram.elementsPerVertex);
    let ptr = 0;
    for (let i = 0; i < verts.length; i++) {
        const vert = verts[i];
        vertexArrayBuffer[ptr++] = positionScale * vert.x;
        vertexArrayBuffer[ptr++] = positionScale * vert.y;
        vertexArrayBuffer[ptr++] = positionScale * vert.z;
        vertexArrayBuffer[ptr++] = texcoordScale * vert.s;
        vertexArrayBuffer[ptr++] = texcoordScale * vert.t;
        vertexArrayBuffer[ptr++] = (vert.r / 0xFF);
        vertexArrayBuffer[ptr++] = (vert.g / 0xFF);
        vertexArrayBuffer[ptr++] = (vert.b / 0xFF);
        vertexArrayBuffer[ptr++] = (vert.a1 / 0xFF * 2);
        vertexArrayBuffer[ptr++] = (vert.a2 / 0xFF);
    }

    const indexArrayBuffer = new Uint32Array(draws.length * 3);
    let lastMaterial = 0;
    const draws2: { material: number, flags: { textured: boolean }, startIndex: number, indexCount: number }[] = [];
    for (let i = 0; i < draws.length; i++) {
        if (draws[i].material !== 0xff) lastMaterial = draws[i].material;
        const draw = draws[i];
        indexArrayBuffer[i * 3 + 0] = draw.indices[0];
        indexArrayBuffer[i * 3 + 1] = draw.indices[1];
        indexArrayBuffer[i * 3 + 2] = draw.indices[2];
        draws2.push({
            material: lastMaterial,
            flags: draw.flags,
            startIndex: i * 3,
            indexCount: 3,
        });
    }

    // merge adjacent draws with the same material
    for (let i = 0; i < draws2.length - 1; i++) {
        const d0 = draws2[i]!;
        const d1 = draws2[i + 1]!;
        if (d0.material === d1.material) {
            d1.indexCount += d0.indexCount;
            d1.startIndex = d0.startIndex;
            d0.indexCount = 0;
        }
    }
    const draws3 = draws2.filter(draw => draw.indexCount > 0);

    return { vertexArrayBuffer, indexArrayBuffer, draws: draws3 };
}
