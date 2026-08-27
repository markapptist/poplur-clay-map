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

export type WeatherCubeKind = 'rain' | 'thunder' | 'snow' | 'hail'
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

export function weatherCubeKind(mode: unknown): WeatherCubeKind | null {
  if (mode === 'rain' || mode === 'snow' || mode === 'hail') return mode
  // Open-Meteo's thunder codes normalize to both thunder and storm.
  if (mode === 'thunder' || mode === 'storm') return 'thunder'
  return null
}

export function weatherCubeModel(kind: WeatherCubeKind | null | undefined): string | null {
  switch (kind) {
    case 'rain': return RAIN_CUBE_MODEL
    case 'thunder': return THUNDER_CUBE_MODEL
    case 'snow': return SNOW_CUBE_MODEL
    case 'hail': return HAIL_CUBE_MODEL
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
