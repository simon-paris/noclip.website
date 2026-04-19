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
    vec4 colorA;
    vec3 directionB;
    float pad2;
    vec4 colorB;
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

bool isNullLight(int position, int dirLightIndex) {
    if (dirLightIndex == 15) return true;
    if (position > 0 && dirLightIndex == 0) return true;
    return false;
}

vec4 applyDirectionalLight(vec3 normal, int dirLightIndex) {
    DirectionLight dirlight = u_DirectionLights[dirLightIndex];

    const vec4 NEGATIVE_ALPHA = vec4(1.0, 1.0, 1.0, -1.0);

    vec4 light = vec4(0.0);
    float nDotL_A = dot(normal, dirlight.directionA);
    if (nDotL_A > 0.0) light += nDotL_A * dirlight.colorA * NEGATIVE_ALPHA;
    float nDotL_B = dot(normal, dirlight.directionB);
    if (nDotL_B > 0.0) light += nDotL_B * dirlight.colorB * NEGATIVE_ALPHA;
    return light;
}

vec4 commonVertexLighting(vec4 rgba, vec3 normal, vec4 dirLightIndices) {
    vec4 light = rgba;

    // directional
    int lightCount = 0;
    for(int i = 0; i < 4; i++) {
        int dirLightIndex = int(dirLightIndices[i]);
        if (isNullLight(i, dirLightIndex)) lightCount++;
    }
    for(int i = 0; i < 4; i++) {
        int dirLightIndex = int(dirLightIndices[i]);
        if (isNullLight(i, dirLightIndex)) continue;
        light += applyDirectionalLight(normalize(normal), dirLightIndex);
    }

    if (rgba.a >= 1.0 && light.a < 1.0) {
        light.a = rgba.a;
    }
    
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
    // texture color is multiplied with vertex color immediately
    if (u_EnableTextures == 1.0) { rgba *= textureSample; }

    // fog step (ignores alpha)
    vec3 rgb = rgba.rgb;
    float fogFactor = fogFactor();
    vec3 fogColor = u_FogParams.color.rgb;
    rgb = mix(rgb, fogColor, fogFactor);

    // bring back alpha
    rgba = vec4(rgb, rgba.a);

    // alpha test
    if (rgba.a < 0.01) discard;

    // blend over-alpha with color
    if (rgba.a > 1.0) {
        rgba.rgb *= 1.0 + (rgba.a - 1.0);
        rgba.a = 1.0;
    }

    // with saturation filter (not authentic but looks washed out without it)
    rgba.rgb = adjustSaturation(rgba.rgb, 1.15);

    return rgba;
}

    `,
};