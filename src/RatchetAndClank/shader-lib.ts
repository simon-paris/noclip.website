export const RatchetShaderLib = {
    SceneParamsSizeInFloats: [
        16, // camera transform
        4, // camera position
        4, // near/far clip
        4, // background color
        4, // sky color
        4 + 4, // fog params
        (4 + 4 + 4 + 4) * 16, // directional lights
        3 * 256 * 4, // texture remaps (3 arrays of 256 vec4s)
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

struct TextureRemaps {
    // x = size bucket, y = index within bucket, z/w unused padding
    vec4 tfrags[256];
    vec4 ties[256];
    vec4 shrubs[256];
};

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec3 u_CameraPosWorld;
    float u_EnableTextures;
    vec2 u_NearFarClip; // x = near, y = far
    vec2 u_LodSettings; // x = lod preset, y = lod bias
    vec4 u_BackgroundColor;
    vec4 u_SkyColor;
    FogParams u_FogParams;
    DirectionLight u_DirectionLights[16];
    TextureRemaps u_TextureRemaps;
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
    rgba *= textureSample;

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
    // if (rgba.a > 1.0) {
    //     rgba.rgb *= 1.0 + (rgba.a - 1.0);
    //     rgba.a = 1.0;
    // }

    // with saturation filter (not authentic but looks washed out without it)
    rgba.rgb = adjustSaturation(rgba.rgb, 1.15);

    return rgba;
}

    `,
    Sampler: `
/*
Custom texture sampling function that can dynamically select textures and sampling parameters.
- bucket: the atlas to read from
- slice: the slice within the atlas
- clampRegister: bit 1 = S clamp, bit 3 = T clamp (other bits are used for region clamp, not supported)
- st: the texture coordinates
- grad: the magnitude of the derivative of the texture coordinates in texels, for mip selection
*/
vec4 ratchetSampler(float bucket, float slice, int clampRegister, vec2 st) {
    float worldDepth = linearizeDepth(1.0 - gl_FragCoord.z, u_NearFarClip.x, u_NearFarClip.y);
    float linear01Depth = (worldDepth - u_NearFarClip.x) / (u_NearFarClip.y - u_NearFarClip.x);

    // ps2 selects mips based on depth not texcoords, but the bias is configurable (in TEX1), I know where the data is in the meshes but I don't know how to decode it.
    float bias = log2(bucket) + 1.0 - (u_LodSettings.y / 20.0);

    float maxLod = log2(bucket);
    float lodLevel = clamp(log2(linear01Depth) + bias, 0.0, maxLod - 2.0);
    int lod = int(lodLevel);

    vec2 texSize = vec2(bucket) / pow(2.0, float(lod));
    vec2 texelCoord = st * texSize - 0.5;
    
    vec2 texelFloor = floor(texelCoord);
    vec2 frac = texelCoord - texelFloor;
    
    ivec2 tc00 = ivec2(texelFloor);
    ivec2 tc10 = tc00 + ivec2(1, 0);
    ivec2 tc01 = tc00 + ivec2(0, 1);
    ivec2 tc11 = tc00 + ivec2(1, 1);
    
    int iTexSize = int(texSize.x);
    bool clampS = (clampRegister & 1) != 0;
    bool clampT = (clampRegister & 4) != 0;
    
    if (clampS) {
        tc00.x = clamp(tc00.x, 0, iTexSize - 1);
        tc10.x = clamp(tc10.x, 0, iTexSize - 1);
        tc01.x = clamp(tc01.x, 0, iTexSize - 1);
        tc11.x = clamp(tc11.x, 0, iTexSize - 1);
    } else {
        tc00.x = int(mod(float(tc00.x), texSize.x));
        tc10.x = int(mod(float(tc10.x), texSize.x));
        tc01.x = int(mod(float(tc01.x), texSize.x));
        tc11.x = int(mod(float(tc11.x), texSize.x));
    }
    
    if (clampT) {
        tc00.y = clamp(tc00.y, 0, iTexSize - 1);
        tc10.y = clamp(tc10.y, 0, iTexSize - 1);
        tc01.y = clamp(tc01.y, 0, iTexSize - 1);
        tc11.y = clamp(tc11.y, 0, iTexSize - 1);
    } else {
        tc00.y = int(mod(float(tc00.y), texSize.x));
        tc10.y = int(mod(float(tc10.y), texSize.x));
        tc01.y = int(mod(float(tc01.y), texSize.x));
        tc11.y = int(mod(float(tc11.y), texSize.x));
    }
    
    vec4 s00, s10, s01, s11;
    if (bucket == 16.0) {
        s00 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc11, slice), lod);
    } else if (bucket == 32.0) {
        s00 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc11, slice), lod);
    } else if (bucket == 64.0) {
        s00 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc11, slice), lod);
    } else if (bucket == 128.0) {
        s00 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc11, slice), lod);
    } else if (bucket == 256.0) {
        s00 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc11, slice), lod);
    } else {
        return vec4(1.0, 0.0, 1.0, 1.0);
    }

    vec4 s0 = mix(s00, s10, frac.x);
    vec4 s1 = mix(s01, s11, frac.x);
    vec4 res = mix(s0, s1, frac.y);
    return res;
}
`
};

