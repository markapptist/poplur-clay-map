import type { ClayMapSettings, ClayQualityPreset } from './clayMapConfig'

type CesiumNamespace = any
type CesiumViewer = any
type CesiumPostStage = any

const CLAY_POST_SHADER = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_focusDepth;
uniform float u_dofStrength;
uniform float u_vignetteStrength;
uniform float u_highlightRolloff;
in vec2 v_textureCoordinates;

vec3 sampleColor(vec2 uv) {
  return texture(colorTexture, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

float safeDepth(vec2 uv) {
  float depth = czm_readDepth(depthTexture, clamp(uv, vec2(0.0), vec2(1.0)));
  return clamp(depth, 0.0, 1.0);
}

void main(void) {
  vec2 uv = v_textureCoordinates;
  vec3 color = sampleColor(uv);
  float depth = safeDepth(uv);

  vec2 texel = 1.0 / czm_viewport.zw;
  float focusDelta = abs(depth - u_focusDepth);
  float depthBlur = smoothstep(0.035, 0.22, focusDelta) * u_dofStrength;

  // A small separable-looking box blur is enough for miniature depth without
  // making the map unusable. The selected landmark remains sharp by keeping the
  // blur low and focus near the camera's current street-level composition.
  vec3 blur =
    sampleColor(uv + vec2( 1.5,  0.0) * texel) +
    sampleColor(uv + vec2(-1.5,  0.0) * texel) +
    sampleColor(uv + vec2( 0.0,  1.5) * texel) +
    sampleColor(uv + vec2( 0.0, -1.5) * texel) +
    sampleColor(uv + vec2( 1.1,  1.1) * texel) +
    sampleColor(uv + vec2(-1.1, -1.1) * texel);
  blur /= 6.0;
  color = mix(color, blur, depthBlur);

  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  float rolloff = smoothstep(0.62, 1.0, luminance) * u_highlightRolloff;
  color = mix(color, vec3(luminance), rolloff * 0.18);
  color = pow(max(color, vec3(0.0)), vec3(0.96));
  color *= vec3(1.035, 1.015, 0.965);

  float vignette = smoothstep(0.92, 0.24, distance(uv, vec2(0.5, 0.48)));
  color *= mix(1.0 - u_vignetteStrength, 1.0, vignette);

  out_FragColor = vec4(color, 1.0);
}
`

const CLAY_AO_SHADER = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_aoStrength;
in vec2 v_textureCoordinates;

float safeDepth(vec2 uv) {
  return clamp(czm_readDepth(depthTexture, clamp(uv, vec2(0.0), vec2(1.0))), 0.0, 1.0);
}

void main(void) {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  vec2 texel = 1.0 / czm_viewport.zw;
  float center = safeDepth(uv);
  float occlusion = 0.0;

  for (int i = 0; i < 6; i++) {
    float angle = 6.2831853 * (float(i) / 6.0);
    vec2 dir = vec2(cos(angle), sin(angle));
    float nearDepth = safeDepth(uv + dir * texel * 2.0);
    occlusion += smoothstep(0.0005, 0.013, center - nearDepth);
  }

  occlusion = clamp(occlusion / 6.0, 0.0, 1.0);
  color.rgb *= 1.0 - occlusion * u_aoStrength;
  out_FragColor = color;
}
`

export interface ClayPostProcessingHandle {
  enabled: boolean
  modelCount: number
  update: (settings: ClayMapSettings) => void
  destroy: () => void
}

export function createClayPostProcessing(
  Cesium: CesiumNamespace,
  viewer: CesiumViewer,
  settings: ClayMapSettings,
  quality: ClayQualityPreset,
  onWarning?: (message: string) => void,
): ClayPostProcessingHandle {
  const stages: CesiumPostStage[] = []
  const addStage = (stage: CesiumPostStage) => {
    viewer.scene.postProcessStages.add(stage)
    stages.push(stage)
  }

  try {
    if (settings.enableAmbientOcclusion && quality !== 'low') {
      addStage(new Cesium.PostProcessStage({
        name: 'poplur-clay-soft-ao',
        fragmentShader: CLAY_AO_SHADER,
        uniforms: {
          u_aoStrength: quality === 'high' ? 0.18 : 0.1,
        },
      }))
    }

    addStage(new Cesium.PostProcessStage({
      name: 'poplur-clay-grade-diorama',
      fragmentShader: CLAY_POST_SHADER,
      uniforms: {
        u_focusDepth: 0.52,
        u_dofStrength: settings.enableDepthOfField && quality === 'high' ? 0.42 : 0,
        u_vignetteStrength: quality === 'low' ? 0.08 : 0.14,
        u_highlightRolloff: 0.55,
      },
    }))
  } catch (error) {
    stages.forEach(stage => {
      try { viewer.scene.postProcessStages.remove(stage) } catch { /* already gone */ }
    })
    onWarning?.(`Clay post-processing disabled: ${(error as Error).message}`)
    return {
      enabled: false,
      modelCount: 0,
      update: () => {},
      destroy: () => {},
    }
  }

  return {
    enabled: stages.length > 0,
    modelCount: 0,
    update: next => {
      stages.forEach(stage => {
        if (stage.name === 'poplur-clay-grade-diorama') {
          stage.uniforms.u_dofStrength = next.enableDepthOfField && quality === 'high' ? 0.42 : 0
          stage.uniforms.u_highlightRolloff = next.highlightSoftness * 0.76
        }
        if (stage.name === 'poplur-clay-soft-ao') {
          stage.enabled = next.enableAmbientOcclusion
        }
      })
    },
    destroy: () => {
      stages.forEach(stage => {
        try { viewer.scene.postProcessStages.remove(stage) } catch { /* scene destroyed */ }
      })
      stages.length = 0
    },
  }
}
