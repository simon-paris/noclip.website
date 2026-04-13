export const RatchetShaderLib = {
    SceneParamsSizeInFloats: [
        16, // camera transform
        4, // camera position
        4, // near/far clip
        4, // background color
        4, // sky color
        4 + 4, // fog params
        (4 + 4 + 4 + 4) * 16, // directional lights
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
    float unknown1;
    vec3 directionB;
    float pad2;
    vec3 colorB;
    float unknown2;
};

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec3 u_CameraPosWorld;
    float u_EnableTextures;
    vec2 u_NearFarClip;
    vec2 pad2;
    vec4 u_BackgroundColor;
    vec4 u_SkyColor;
    FogParams u_FogParams;
    DirectionLight u_DirectionLights[16];
};

    `,
    LightingFunctions: `

float ENVIRONMENT_LIGHT = 1.8;
float DIRECTIONAL_LIGHT = 1.4;

vec3 applyDirectionalLight(vec3 normal, int dirLightIndex) {
    DirectionLight dirlight = u_DirectionLights[dirLightIndex];
    if (dirLightIndex == 15) return vec3(0.0);

    vec3 light = vec3(0.0);
    float nDotL_A = dot(normal, dirlight.directionA);
    if (nDotL_A > 0.0) light += DIRECTIONAL_LIGHT * nDotL_A * dirlight.colorA;
    float nDotL_B = dot(normal, dirlight.directionB);
    if (nDotL_B > 0.0) light += DIRECTIONAL_LIGHT * nDotL_B * dirlight.colorB;
    return light;
}

vec3 commonVertexLighting(vec3 rgb, vec3 normal, vec4 dirLightIndices, float environmentalLightMultiplier) {
    vec3 light = vec3(0.0);

    // directional
    int lightCount = 0;
    for(int i = 0; i < 4; i++) {
        int dirLightIndex = int(dirLightIndices[i]);
        if (dirLightIndex == 15) break;
        if (i > 0 && int(dirLightIndex) == 0) break;
        lightCount++;
    }
    for(int i = 0; i < 4; i++) {
        int dirLightIndex = int(dirLightIndices[i]);
        if (dirLightIndex == 15) break;
        if (i > 0 && int(dirLightIndex) == 0) break;
        light += applyDirectionalLight(normalize(normal), dirLightIndex);
    }

    // make total directional light constant
    light *= float(4 - lightCount) * (DIRECTIONAL_LIGHT / 4.0);
    
    // environmental
    float environmentLightAmount = ENVIRONMENT_LIGHT * environmentalLightMultiplier;
    light += environmentLightAmount * rgb;

    return light;
}

    `,
    CommonFragmentShader: `

const float SATURATION_ADJUST = 1.15;

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

vec3 adjustSaturation(vec3 color, float adjustment) {
    const vec3 luminanceWeights = vec3(0.2125, 0.7154, 0.0721);
    float luminance = dot(color, luminanceWeights);
    vec3 grayscale = vec3(luminance);
    return mix(grayscale, color, adjustment);
}

vec4 commonFragmentShader(vec4 rgba, vec4 textureSample) {
    if (u_EnableTextures == 0.0) {
        textureSample = vec4(0.5, 0.5, 0.5, 1.0);
    }
    vec3 textureColor = vec3(textureSample.r, textureSample.g, textureSample.b);
    if (textureSample.a < 0.01) { discard; }

    float fogFactor = fogFactor();
    vec3 fogColor = u_FogParams.color.rgb;

    // initial color
    vec3 color1 = textureColor * rgba.rgb;

    // with fog
    vec3 color2 = mix(color1, fogColor, fogFactor);

    // with saturation filter (not authentic but looks more accurate, not sure why)
    vec3 color3 = adjustSaturation(color2, SATURATION_ADJUST);

    return vec4(color3, textureSample.a * rgba.a);
}

    `,
};