/**
 * Runtime-safe navigator models for shell contexts that are not tied to one
 * ordinary subscreen. Keeping the state-to-model decision pure lets the map
 * document and Home shell share an explicit contract without loading React.
 */
export const HOME_CUBE_MODEL = 'poplur_cube_home.glb'
export const FEED_TV_CUBE_MODEL = 'clay_tv.glb'
export const BROWSER_CUBE_MODEL = 'poplur_cube_at_sign.glb'
export const BREAKING_NEWS_CUBE_MODEL = 'poplur_cube_breaking_news.glb'
export const RAIN_CUBE_MODEL = 'poplur_cube_rain_cloud.glb'
export const THUNDER_CUBE_MODEL = 'poplur_cube_thunder_cloud.glb'
export const SNOW_CUBE_MODEL = 'poplur_cube_snow_cloud.glb'
export const HAIL_CUBE_MODEL = 'poplur_cube_hail_cloud.glb'
export const FOG_CUBE_MODEL = 'poplur_cube_fog_cloud.glb'
export const WIND_CUBE_MODEL = 'poplur_cube_wind_cloud.glb'

export type WeatherCubeKind = 'rain' | 'thunder' | 'snow' | 'hail' | 'fog' | 'wind'
export type MapNewsCubeStatus = 'breaking' | 'live' | 'developing' | 'top'

export interface MapNewsCubeEvent {
  id: string
  status: MapNewsCubeStatus
}

/** Only genuinely breaking/live focused stories borrow the exclamation cube. */
export function isBreakingNewsCubeEvent(
  event: MapNewsCubeEvent | null | undefined,
): boolean {
  return event?.status === 'breaking' || event?.status === 'live'
}

/** Validate the stable map-document → Home-shell story-card signal. */
export function readMapNewsCubeEvent(value: unknown): MapNewsCubeEvent | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { active?: unknown; id?: unknown; status?: unknown }
  if (candidate.active !== true || typeof candidate.id !== 'string') return null
  const id = candidate.id.trim().slice(0, 180)
  if (!id) return null
  const status = candidate.status
  if (status !== 'breaking' && status !== 'live'
    && status !== 'developing' && status !== 'top') return null
  return { id, status }
}

export function weatherCubeKind(mode: unknown, _windy = false): WeatherCubeKind | null {
  if (mode === 'rain' || mode === 'snow' || mode === 'hail' || mode === 'fog') return mode
  // Open-Meteo's thunder codes normalize to both thunder and storm.
  if (mode === 'thunder' || mode === 'storm') return 'thunder'
  // Wind no longer takes the cube. It is a speed reading rather than a
  // condition, and it sits above the advisory bar for hours at a time — so on
  // a clear day the navigator quietly became a cloud and stayed one, which
  // reads as a stuck cube rather than as weather. The cube now changes only
  // when something is actually falling out of the sky.
  return null
}

export function weatherCubeModel(kind: WeatherCubeKind | null | undefined): string | null {
  switch (kind) {
    case 'rain': return RAIN_CUBE_MODEL
    case 'thunder': return THUNDER_CUBE_MODEL
    case 'snow': return SNOW_CUBE_MODEL
    case 'hail': return HAIL_CUBE_MODEL
    case 'fog': return FOG_CUBE_MODEL
    case 'wind': return WIND_CUBE_MODEL
    default: return null
  }
}

/** A focused breaking-news stop must remain legible even during precipitation. */
export function mapContextCubeModel(
  breakingNewsActive: boolean,
  weatherKind: WeatherCubeKind | null | undefined,
): string | null {
  if (breakingNewsActive) return BREAKING_NEWS_CUBE_MODEL
  return weatherCubeModel(weatherKind)
}

/**
 * The Map navigator's own objects. All four are the shipped mobile-sized
 * "lite" assets at bundle root. They are chosen by the map's sky rather than
 * by a second clock, so the cube and the map palette never disagree about
 * the hour, and each change flows through the ordinary one-shot POP swap.
 */
export const MAP_GLOBE_CUBE_MODEL = 'poplur-globe-lite.glb'
export const MAP_SUN_CUBE_MODEL = 'poplur_sun_lite.glb'
export const MAP_MOON_FULL_CUBE_MODEL = 'poplur_moon_full_lite.glb'
export const MAP_MOON_CRESCENT_CUBE_MODEL = 'poplur_moon_crescent_lite.glb'

/**
 * How long a weather cube holds the navigator. A weather cube is an
 * announcement, not a mode: it pops in when a condition begins and then hands
 * the cube back to the day's object, while the temperature chip carries on
 * reporting the weather for as long as it lasts. A steady rain that kept the
 * cloud for hours read as a stuck cube, not as weather.
 */
export const WEATHER_CUBE_DISPLAY_MS = 4_000

export type MapDaypart = 'day' | 'night' | 'twilight'
export type MapSkyLightPreset = 'dawn' | 'day' | 'dusk' | 'night'

/** Fold the sky's four light presets into the three the cube can wear. Dawn
 * and dusk are twilight: neither the sun nor the moon owns that sky, so the
 * globe does. */
export function mapDaypart(lightPreset: MapSkyLightPreset): MapDaypart {
  if (lightPreset === 'day') return 'day'
  if (lightPreset === 'night') return 'night'
  return 'twilight'
}

/** The sun by day, the phase-matched moon by night, the globe in between. */
export function mapDaypartCubeModel(
  daypart: MapDaypart,
  moon: 'full' | 'crescent',
): string {
  if (daypart === 'day') return MAP_SUN_CUBE_MODEL
  if (daypart === 'night') {
    return moon === 'full' ? MAP_MOON_FULL_CUBE_MODEL : MAP_MOON_CRESCENT_CUBE_MODEL
  }
  return MAP_GLOBE_CUBE_MODEL
}
