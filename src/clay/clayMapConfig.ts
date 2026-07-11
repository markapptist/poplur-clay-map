export type MapVisualMode = 'photoreal' | 'clay'

export type ClayQualityPreset = 'low' | 'medium' | 'high'

export type ClayWeatherMode =
  | 'clear'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'thunder'
  | 'storm'
  | 'snow'
  | 'hail'

export interface ClayMapSettings {
  clayStrength: number
  textureDetail: number
  saturation: number
  warmth: number
  roughness: number
  grainStrength: number
  fingerprintStrength: number
  ambientLight: number
  highlightSoftness: number
  edgeSoftness: number
  enableDepthOfField: boolean
  enableAmbientOcclusion: boolean
  enableClayGrain: boolean
  enableLandmarkReplacement: boolean
}

export interface ClayRuntimeOptions {
  quality: ClayQualityPreset
  reducedMotion: boolean
  weatherMode: ClayWeatherMode
  dayTime: boolean
}

// v3: reference-diorama push (saturated palette, gloss glint, heavier coat) —
// settings saved against older shader revisions would fight the new look.
export const CLAY_SETTINGS_STORAGE_KEY = 'poplur.clayRealm.settings.v3'
export const CLAY_MODE_STORAGE_KEY = 'poplur.clayRealm.mode.v1'

export const DEFAULT_CLAY_MAP_SETTINGS: ClayMapSettings = {
  clayStrength: 0.9,
  textureDetail: 0.3,
  saturation: 0.72,
  warmth: 0.12,
  roughness: 0.9,
  grainStrength: 0.035,
  fingerprintStrength: 0.018,
  ambientLight: 0.32,
  highlightSoftness: 0.72,
  edgeSoftness: 0.2,
  enableDepthOfField: true,
  enableAmbientOcclusion: true,
  enableClayGrain: true,
  enableLandmarkReplacement: true,
}

export const LOW_CLAY_MAP_SETTINGS: Partial<ClayMapSettings> = {
  clayStrength: 0.72,
  textureDetail: 0.34,
  grainStrength: 0.012,
  fingerprintStrength: 0.004,
  enableDepthOfField: false,
  enableAmbientOcclusion: false,
  enableClayGrain: true,
  enableLandmarkReplacement: false,
}

export const MEDIUM_CLAY_MAP_SETTINGS: Partial<ClayMapSettings> = {
  enableDepthOfField: false,
  enableAmbientOcclusion: true,
  enableLandmarkReplacement: false,
}

export function mergeClaySettings(
  settings: ClayMapSettings,
  patch: Partial<ClayMapSettings>,
): ClayMapSettings {
  return { ...settings, ...patch }
}

export function settingsForQuality(
  quality: ClayQualityPreset,
  settings: ClayMapSettings,
): ClayMapSettings {
  if (quality === 'low') return mergeClaySettings(settings, LOW_CLAY_MAP_SETTINGS)
  if (quality === 'medium') return mergeClaySettings(settings, MEDIUM_CLAY_MAP_SETTINGS)
  return settings
}

export function selectClayQualityPreset(): ClayQualityPreset {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  const pointer = window.matchMedia('(pointer: coarse)').matches
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 720
  const reducedData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData

  if (reducedData || pointer || narrow || memory <= 3 || cores <= 4) return 'medium'
  if (memory >= 8 && cores >= 8 && window.devicePixelRatio <= 2) return 'high'
  return 'medium'
}

export function effectiveResolutionScale(quality: ClayQualityPreset): number {
  const ratio = window.devicePixelRatio || 1
  const cap = quality === 'high' ? 1.35 : quality === 'medium' ? 1.1 : 1
  return Math.min(1, cap / ratio)
}

export function loadClaySettings(): ClayMapSettings {
  try {
    const raw = window.localStorage.getItem(CLAY_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_CLAY_MAP_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ClayMapSettings>
    return { ...DEFAULT_CLAY_MAP_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_CLAY_MAP_SETTINGS
  }
}

export function saveClaySettings(settings: ClayMapSettings) {
  try {
    window.localStorage.setItem(CLAY_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage can be disabled in embedded web views.
  }
}

export function loadVisualMode(): MapVisualMode {
  // The Poplur signature map IS the fused look: real photogrammetry under a
  // clay coat, always. 'photoreal' survives as an internal fallback state
  // (shader failure) — it is not a user-facing mode.
  return 'clay'
}

export function saveVisualMode(mode: MapVisualMode) {
  try {
    window.localStorage.setItem(CLAY_MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage can be disabled in embedded web views.
  }
}
