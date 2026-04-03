export const RatchetShaderLib = {
    SceneParamsSizeInFloats: [
        16, // camera transform
        4, // camera position
        4, // near/far clip
        4 + 4, // fog params
        (4 + 4 + 4 + 4) * 8, // directional lights
    ].reduce((a, b) => a + b, 0),
    SceneParams: `

struct FogParams {
    vec4 color;
    float nearDist;
    float farDist;
    float nearIntensity;
    float farIntensity;
};

struct DirectionLight {
    vec3 directionA;
    float pad1;
    vec3 colorA;
    float pad2;
    vec3 directionB;
    float pad3;
    vec3 colorB;
    float pad4;
};

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec3 u_CameraPosWorld;
    float pad1;
    vec2 u_NearFarClip;
    vec2 pad2;
    FogParams u_FogParams;
    DirectionLight u_DirectionLight[8];
};

    `,
    LightingFunctions: `

float AMBIENT_LIGHT = 1.0;
float ENVIRONMENT_LIGHT = 1.0;
float DIRECTIONAL_LIGHT_A = 1.0;
float DIRECTIONAL_LIGHT_B = 1.0;

vec3 commonVertexLighting(vec3 rgb, vec3 normal, int lightIndex) {
    vec3 light = vec3(0.0);

    // ambient
    light += AMBIENT_LIGHT;

    // environment probe
    light += ENVIRONMENT_LIGHT * rgb;

    // directional
    DirectionLight dirlight = u_DirectionLight[lightIndex];

    float nDotL_A = dot(normal, -dirlight.directionA);
    light += DIRECTIONAL_LIGHT_A * nDotL_A * dirlight.colorA;

    float nDotL_B = dot(normal, -dirlight.directionB);
    light += DIRECTIONAL_LIGHT_B * nDotL_B * dirlight.colorB;

    return light;
}

    `,
    CommonFragmentShader: `

float linearizeDepth(float depth, float near, float far) {
    float z = depth * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - z * (far - near));
}

float fogFactor() {
    float worldDepth = linearizeDepth(1.0 - gl_FragCoord.z, u_NearFarClip.x, u_NearFarClip.y);

    float fogFactor = 1.0 - clamp((u_FogParams.farDist - worldDepth) / (u_FogParams.farDist - u_FogParams.nearDist), 0.0, 1.0);
    fogFactor = u_FogParams.nearIntensity + fogFactor * (u_FogParams.farIntensity - u_FogParams.nearIntensity);
    return fogFactor;
}

vec4 commonFragmentShader(vec4 rgba, sampler2D sampler, vec2 uv) {
    vec4 tex = texture(SAMPLER_2D(sampler), uv);
    vec3 texColor = vec3(tex.r, tex.g, tex.b);
    if (tex.a < 0.01) {
        discard;
    }

    float fogFactor = fogFactor();
    vec3 fogColor = u_FogParams.color.rgb;

    vec3 finalColor = mix(texColor * rgba.rgb, fogColor, fogFactor);
    return vec4(finalColor, tex.a);
}

    `,
};