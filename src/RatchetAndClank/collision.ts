import { vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { CollisionOctant } from "./structs-core";

const collisionTypeMap = Object.fromEntries([
    [0b0000, vec3.fromValues(0.3, 0.3, 0.9)], // 0 water
    [0b0001, vec3.fromValues(0.9, 0.1, 0.1)], // 1 take damage, bounce (hot objects, lava, goo)
    [0b0010, vec3.fromValues(0.9, 0.9, 0.2)], // 2 mag boots
    [0b0011, vec3.fromValues(0.6, 0.5, 0.3)], // 3 drown (mud)
    [0b0100, vec3.fromValues(0.2, 0.4, 0.2)], // 4 slippy slide
    [0b0101, vec3.fromValues(0.9, 0.6, 0.3)], // 5 hoverbike or grindrail jump
    [0b0110, vec3.fromValues(0.4, 0.7, 0.4)], // 6 unused
    [0b0111, vec3.fromValues(0.7, 0.9, 1.0)], // 7 ice
    [0b1000, vec3.fromValues(0.2, 0.2, 0.3)], // 8 out of bounds, can wall-jump
    [0b1001, vec3.fromValues(0.8, 0.5, 0.5)], // 9 cannot mantle
    [0b1010, vec3.fromValues(0.8, 0.6, 0.9)], // 10 cannot wall-jump
    [0b1011, vec3.fromValues(0.4, 0.3, 0.3)], // 11 drown (mud again)
    [0b1100, vec3.fromValues(0.2, 0.2, 0.2)], // 12 out of bounds, cannot wall-jump
    [0b1101, vec3.fromValues(0.3, 0.9, 0.6)], // 13 drown (ocean)
    [0b1110, vec3.fromValues(0.3, 0.3, 0.9)], // 14 unswimmable shallow water
    [0b1111, vec3.fromValues(0.8, 0.8, 0.8)], // 15 normal terrain
]);

const collisionColorLutCode = `
const vec3 colors[16] = vec3[16](
    ${[...Array(16)].map((_, i) => {
    const color = collisionTypeMap[i] || vec3.fromValues(1.0, 0.0, 1.0);
    return `vec3(${color[0]}, ${color[1]}, ${color[2]})`;
}).join(',\n')}
);
`

export class CollisionProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_CollisionType = 1;

    public static elementsPerVertex = 4; // position(3) + type(1) = 4

    public static ub_SceneParams = 0;
    public static ub_CollisionParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_CollisionParams {
    Mat4x4 u_CollisionTransform;
};
`;

    public override vert = `
layout(location = ${CollisionProgram.a_Position}) in vec3 a_Position;
layout(location = ${CollisionProgram.a_CollisionType}) in vec3 a_CollisionType;

out vec3 v_Rgb;
out vec3 v_PositionWorld;

${collisionColorLutCode}

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_CollisionTransform) * vec4(a_Position, 1.0f);
    gl_Position = (UnpackMatrix(u_ClipFromWorld) * t_PositionWorld);

    v_Rgb = colors[int(a_CollisionType.r)];
    v_PositionWorld = t_PositionWorld.xyz;
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}
in vec3 v_Rgb;
in vec3 v_PositionWorld;

void main() {
    vec3 tangentX = dFdx(v_PositionWorld);
    vec3 tangentY = dFdy(v_PositionWorld);
    vec3 faceNormal = normalize(cross(tangentX, tangentY));
    float light = 0.5 + 0.5 * dot(faceNormal, u_DirectionLights[0].directionA);

    gl_FragColor = vec4(v_Rgb * light, 1.0);
}
`;

}

export class CollisionGeometry {
    public vertexBuffer: GfxBuffer;
    public vertexCount: number;

    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, collisionOctants: CollisionOctant[]) {
        const device = cache.device;

        const assembled = assembleCollisionGeometry(collisionOctants);

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, assembled.vertexArrayBuffer.buffer);
        device.setResourceName(this.vertexBuffer, `Collision (VB)`);
        this.vertexCount = assembled.vertexCount;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: CollisionProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: CollisionProgram.a_CollisionType, format: GfxFormat.F32_R, bufferByteOffset: 3 * 4, bufferIndex: 0, },
            ],
            vertexBufferDescriptors: [
                { byteStride: CollisionProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
            ],
            indexBufferFormat: null,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
    }
}


function assembleCollisionGeometry(collisionOctants: CollisionOctant[]) {
    const positionScale = 1;
    const octantScale = 1;

    const verts: {
        x: number,
        y: number,
        z: number,
        type: number,
    }[] = [];

    for (let i = 0; i < collisionOctants.length; i++) {
        const octant = collisionOctants[i];

        function pushVertex(idx: number, type: number) {
            const vert = octant.verts[idx];
            const { x, y, z } = vert;
            verts.push({
                x: positionScale * x + octantScale * octant.pos.x,
                y: positionScale * y + octantScale * octant.pos.y,
                z: positionScale * z + octantScale * octant.pos.z,
                type: type & 0xF, // only the bottom 4 bits seem important, the rest are related to footsteps or something
            });
        }

        for (let j = 0; j < octant.faces.length; j++) {
            const face = octant.faces[j];
            const type = face.type;
            pushVertex(face.v0, type);
            pushVertex(face.v1, type);
            pushVertex(face.v2, type);
            if (face.quad) {
                pushVertex(face.v0, type);
                pushVertex(face.v3!, type);
                pushVertex(face.v2, type);
            }
        }
    }

    const vertexArrayBuffer = new Float32Array(verts.length * CollisionProgram.elementsPerVertex);
    let ptr = 0;
    for (let i = 0; i < verts.length; i++) {
        const vert = verts[i];
        vertexArrayBuffer[ptr++] = vert.x;
        vertexArrayBuffer[ptr++] = vert.y;
        vertexArrayBuffer[ptr++] = vert.z;
        vertexArrayBuffer[ptr++] = vert.type;
    }

    assert(ptr === vertexArrayBuffer.length);

    return { vertexArrayBuffer, vertexCount: verts.length };
}
