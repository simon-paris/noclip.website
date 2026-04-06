export const RatchetShaderLib = {
    SceneParamsSizeInFloats: [
        16, // camera transform
        4, // camera position
        4, // near/far clip
        4, // ambient color
        4, // sky color
        4, // pit color
        4 + 4, // fog params
        (4 + 4 + 4 + 4) * 8, // directional lights
        4, // debugSelectedDirLight
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
    vec4 u_AmbientColor;
    vec4 u_SkyColor;
    vec4 u_PitColor;
    FogParams u_FogParams;
    DirectionLight u_DirectionLight[8];
    vec4 u_DebugSelectedDirLight; // x = index
};

    `,
    LightingFunctions: `

float WHITE_AMBIENT_LIGHT = 0.7;
float AMBIENT_LIGHT = 0.0;
float ENVIRONMENT_LIGHT = 1.0;
float DIRECTIONAL_LIGHT_A = 0.4;
float DIRECTIONAL_LIGHT_B = 0.4;

vec3 commonVertexLighting(vec3 rgb, vec3 normal, int lightIndex) {
    vec3 light = vec3(0.0);

    // ambient
    light += WHITE_AMBIENT_LIGHT;
    light += AMBIENT_LIGHT * u_AmbientColor.rgb;

    // environment probe
    light += ENVIRONMENT_LIGHT * rgb;

    // directional
    DirectionLight dirlight = u_DirectionLight[lightIndex];
    float nDotL_A = dot(normal, dirlight.directionA);
    light += DIRECTIONAL_LIGHT_A * nDotL_A * dirlight.colorA;
    float nDotL_B = dot(normal, dirlight.directionB);
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

vec3 adjustSaturation(vec3 color, float adjustment) {
    const vec3 luminanceWeights = vec3(0.2125, 0.7154, 0.0721);
    float luminance = dot(color, luminanceWeights);
    vec3 grayscale = vec3(luminance);
    return mix(grayscale, color, adjustment);
}

vec4 commonFragmentShader(vec4 rgba, sampler2D sampler, vec2 uv) {
    vec4 tex = texture(SAMPLER_2D(sampler), uv);
    vec3 texColor = vec3(tex.r, tex.g, tex.b);
    if (tex.a < 0.01) { discard; }

    float fogFactor = fogFactor();
    vec3 fogColor = u_FogParams.color.rgb;

    // initial color
    vec3 color1 = texColor * rgba.rgb;

    // with fog
    vec3 color2 = mix(color1, fogColor, fogFactor);

    // with saturation filter (not authentic but looks more accurate, not sure why)
    vec3 color3 = adjustSaturation(color2, 1.15);

    return vec4(color3, tex.a * rgba.a);
}

    `,
};