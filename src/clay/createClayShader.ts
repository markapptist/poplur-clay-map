import type { ClayMapSettings } from './clayMapConfig'

type CesiumNamespace = any
type CesiumTileset = { customShader?: unknown }
type CesiumCustomShader = unknown

const CLAY_FRAGMENT_SHADER = `
// Stable scalar noise. The input is model-space so grain stays glued to the
// Google tile geometry instead of swimming as the camera moves.
float clayHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.47));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float clayNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = clayHash(i + vec3(0.0, 0.0, 0.0));
  float n100 = clayHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = clayHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = clayHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = clayHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = clayHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = clayHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = clayHash(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 softQuantize(vec3 color, float steps, float softness) {
  vec3 low = floor(color * steps) / steps;
  vec3 high = ceil(color * steps) / steps;
  vec3 local = fract(color * steps);
  vec3 eased = smoothstep(vec3(0.5 - softness), vec3(0.5 + softness), local);
  return mix(low, high, eased);
}

float saturationOf(vec3 color) {
  float cMax = max(color.r, max(color.g, color.b));
  float cMin = min(color.r, min(color.g, color.b));
  return cMax - cMin;
}

float ridgeFingerprint(vec3 p, float closeFade) {
  vec2 plane = p.xy * 0.045;
  vec2 cell = floor(plane);
  vec2 local = fract(plane) - 0.5;
  float sparse = smoothstep(0.78, 0.98, clayHash(vec3(cell, 2.7)));
  vec2 offset = vec2(
    clayHash(vec3(cell, 5.1)) - 0.5,
    clayHash(vec3(cell, 9.4)) - 0.5
  ) * 0.45;
  float radius = length(local + offset);
  float rings = sin(radius * 58.0 + clayNoise(p * 0.08) * 3.0);
  float ridge = smoothstep(0.86, 1.0, rings);
  return ridge * sparse * closeFade;
}

void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 original = clamp(material.diffuse, vec3(0.0), vec3(1.0));
  float luma = dot(original, vec3(0.299, 0.587, 0.114));
  float chroma = saturationOf(original);

  vec3 normal = normalize(fsInput.attributes.normalEC);
  vec3 position = fsInput.attributes.positionMC;
  float cameraDistance = length(fsInput.attributes.positionEC);
  float closeFade = 1.0 - smoothstep(900.0, 4200.0, cameraDistance);
  float detailFade = 1.0 - smoothstep(2200.0, 36000.0, cameraDistance);

  // Classification is gated by chroma: near-neutral photo pixels (most walls,
  // roofs and streets) must NOT trip the vegetation/water paths, or the whole
  // city smears into olive mud. Only genuinely colourful pixels classify.
  float chromaGate = smoothstep(0.05, 0.17, chroma);
  float blueDominance = original.b - max(original.r, original.g) * 0.72;
  float greenDominance = original.g - max(original.r, original.b) * 0.68;
  float waterMask = smoothstep(0.05, 0.24, blueDominance) * smoothstep(0.15, 0.75, luma) * chromaGate;
  float vegetationMask = smoothstep(0.06, 0.22, greenDominance) * (1.0 - waterMask) * chromaGate;
  float neutralDark = (1.0 - smoothstep(0.10, 0.30, luma)) * (1.0 - smoothstep(0.08, 0.22, chroma));
  float roadMask = neutralDark * (1.0 - waterMask) * (1.0 - vegetationMask * 0.65);
  float horizontal = smoothstep(0.28, 0.92, normal.z);
  float terrainMask = horizontal * (1.0 - waterMask) * (1.0 - vegetationMask) * (1.0 - roadMask);

  vec3 surfaceTint = u_buildingTint;
  surfaceTint = mix(surfaceTint, u_terrainTint, terrainMask * 0.55);
  surfaceTint = mix(surfaceTint, u_vegetationTint, vegetationMask);
  surfaceTint = mix(surfaceTint, u_waterTint, waterMask);
  surfaceTint = mix(surfaceTint, u_roadTint, roadMask);

  // The coat: clay palette carries the COLOUR, the photo's luminance carries
  // the STRUCTURE — like matte paint over a detailed relief. Windows, shadows,
  // lane markings and rooftops keep reading through the clay.
  float structure = smoothstep(0.0, 1.0, luma);
  vec3 clayLit = surfaceTint * (0.30 + structure * 1.10);

  vec3 desaturated = mix(vec3(luma), original, u_saturation);
  vec3 warmed = desaturated + vec3(u_warmth, u_warmth * 0.52, -u_warmth * 0.22);

  // Keep enough real texture that users can still recognize the city, then
  // gently cluster the result into a hand-mixed modeling-clay palette.
  vec3 clayBase = mix(clayLit, warmed, u_textureDetail);
  clayBase = softQuantize(clayBase, 10.0, 0.34 + u_edgeSoftness);

  float broadNoise = clayNoise(position * 0.018);
  float fineNoise = clayNoise(position * 0.17);
  float grain = ((broadNoise - 0.5) * 0.55 + (fineNoise - 0.5) * 0.45) * u_grainStrength;
  grain *= mix(0.12, 1.0, detailFade);
  float finger = ridgeFingerprint(position, closeFade) * u_fingerprintStrength;

  // The photo luminance already carries the scene's real lighting, so the
  // normal-based term is only a gentle top-light sweetener — doubling up on
  // full-strength ambient here is what washed the coat out to mud.
  float topLight = smoothstep(-0.15, 0.85, normal.z);
  float softHighlight = pow(max(topLight, 0.0), mix(2.4, 0.72, u_highlightSoftness));
  vec3 litClay = clayBase * (u_ambientLight * 0.5 + 0.84 + softHighlight * 0.14);

  if (u_enableClayGrain > 0.5) {
    litClay += vec3(grain + finger);
  }

  // Clay gloss: the waxy glint of a photographed model. The photo's brightest
  // spots (sunlit roofs, pale facades) catch a warm-white sheen — reading as
  // specular without needing real normals.
  float gloss = pow(structure, 5.0) * 0.30;
  litClay += vec3(gloss * 1.05, gloss, gloss * 0.92);

  // The coat belongs to the diorama, not the planet: it fades out above city
  // altitudes so the globe reads as the real Earth (real oceans, real night),
  // and hand-dips back in as the camera descends toward the streets.
  float coatFade = 1.0 - smoothstep(120000.0, 900000.0, cameraDistance);
  vec3 finalColor = mix(original, clamp(litClay, vec3(0.0), vec3(1.0)), u_clayStrength * coatFade);
  material.diffuse = clamp(finalColor, vec3(0.0), vec3(1.0));
  material.roughness = u_roughness;
}
`

export interface ClayShaderHandle {
  shader: CesiumCustomShader
  applyTo: (tileset: CesiumTileset) => void
  update: (settings: ClayMapSettings) => void
  destroy: (tileset: CesiumTileset) => void
}

function color3(Cesium: CesiumNamespace, hex: string) {
  const color = Cesium.Color.fromCssColorString(hex)
  return new Cesium.Cartesian3(color.red, color.green, color.blue)
}

export function createClayShader(
  Cesium: CesiumNamespace,
  settings: ClayMapSettings,
): ClayShaderHandle {
  const uniforms = {
    u_clayStrength: { type: Cesium.UniformType.FLOAT, value: settings.clayStrength },
    u_textureDetail: { type: Cesium.UniformType.FLOAT, value: settings.textureDetail },
    u_saturation: { type: Cesium.UniformType.FLOAT, value: settings.saturation },
    u_roughness: { type: Cesium.UniformType.FLOAT, value: settings.roughness },
    u_warmth: { type: Cesium.UniformType.FLOAT, value: settings.warmth },
    u_grainStrength: { type: Cesium.UniformType.FLOAT, value: settings.grainStrength },
    u_fingerprintStrength: { type: Cesium.UniformType.FLOAT, value: settings.fingerprintStrength },
    u_edgeSoftness: { type: Cesium.UniformType.FLOAT, value: settings.edgeSoftness },
    u_ambientLight: { type: Cesium.UniformType.FLOAT, value: settings.ambientLight },
    u_highlightSoftness: { type: Cesium.UniformType.FLOAT, value: settings.highlightSoftness },
    u_enableClayGrain: { type: Cesium.UniformType.FLOAT, value: settings.enableClayGrain ? 1 : 0 },
    // Reference-diorama palette: saturated moss land, rich blue clay water,
    // charcoal roads, pink-blushed buildings — the hand-mixed Poplur batch.
    u_terrainTint: { type: Cesium.UniformType.VEC3, value: color3(Cesium, '#c9b184') },
    u_buildingTint: { type: Cesium.UniformType.VEC3, value: color3(Cesium, '#dfb3a2') },
    u_vegetationTint: { type: Cesium.UniformType.VEC3, value: color3(Cesium, '#6fae3f') },
    u_waterTint: { type: Cesium.UniformType.VEC3, value: color3(Cesium, '#3f7fb8') },
    u_roadTint: { type: Cesium.UniformType.VEC3, value: color3(Cesium, '#221e22') },
  }

  const shader = new Cesium.CustomShader({
    mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
    // Google's photorealistic tiles are UNLIT (KHR_materials_unlit): the photo
    // texture only reaches material.diffuse on the unlit path. Under PBR the
    // shader receives a blank material and paints featureless mud. Our GLSL
    // fakes the clay lighting itself, so unlit is also the correct output.
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms,
    fragmentShaderText: CLAY_FRAGMENT_SHADER,
  })

  const update = (next: ClayMapSettings) => {
    uniforms.u_clayStrength.value = next.clayStrength
    uniforms.u_textureDetail.value = next.textureDetail
    uniforms.u_saturation.value = next.saturation
    uniforms.u_roughness.value = next.roughness
    uniforms.u_warmth.value = next.warmth
    uniforms.u_grainStrength.value = next.grainStrength
    uniforms.u_fingerprintStrength.value = next.fingerprintStrength
    uniforms.u_edgeSoftness.value = next.edgeSoftness
    uniforms.u_ambientLight.value = next.ambientLight
    uniforms.u_highlightSoftness.value = next.highlightSoftness
    uniforms.u_enableClayGrain.value = next.enableClayGrain ? 1 : 0
  }

  return {
    shader,
    applyTo: tileset => {
      tileset.customShader = shader
    },
    update,
    destroy: tileset => {
      if (tileset.customShader === shader) tileset.customShader = undefined
    },
  }
}
