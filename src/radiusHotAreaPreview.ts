/**
 * Deterministic, preview-only Hot Area fixtures for the Radius design lab.
 *
 * This module never reads private media, captions, precise location history,
 * or live economy state. A production multiplier must be resolved and applied
 * by the server after the post and its engagement are verified.
 */

export const HOT_AREA_RADIUS_MULTIPLIER = 1.5 as const
export const HOT_AREA_VIRAL_GATE = Object.freeze({
  uniqueViewers: 8,
  highIntentActions: 3,
  velocityMultiple: 2,
})

export type HotAreaCategory = 'music' | 'food' | 'style' | 'sports'
export type HotAreaCategoryFilter = HotAreaCategory | 'all'

export interface HotAreaPreviewArea {
  id: string
  category: HotAreaCategory
  categoryLabel: string
  channelId: string
  label: string
  city: string
  distanceKm: number
  center: readonly [number, number]
  radiusKm: number
  color: string
  outline: string
  expiresLabel: string
  minutesRemaining: number
  demandGap: number
  multiplier: typeof HOT_AREA_RADIUS_MULTIPLIER
  active: boolean
}

export interface HotAreaPreferenceSignal {
  category: HotAreaCategory
  recentPostCount: number
  engagementScore: number
}

export interface HotAreaRecommendation {
  area: HotAreaPreviewArea
  reason: string
  score: number
  generic: boolean
}

export interface HotAreaViralOutcomeInput {
  area: HotAreaPreviewArea
  contentCategory: HotAreaCategory
  baseRadiusGrowthKm: number
  postedInsideArea: boolean
  uniqueViewers: number
  highIntentActions: number
  velocityMultiple: number
  alreadyRewarded: boolean
}

export interface HotAreaViralOutcome {
  eligible: boolean
  multiplier: 1 | typeof HOT_AREA_RADIUS_MULTIPLIER
  baseRadiusGrowthKm: number
  bonusRadiusGrowthKm: number
  totalRadiusGrowthKm: number
  reason: 'active' | 'not-viral' | 'wrong-category' | 'outside-area' | 'expired' | 'already-rewarded' | 'non-positive'
}

export interface HotAreaFeatureProperties {
  id: string
  category: HotAreaCategory
  categoryLabel: string
  channelId: string
  label: string
  city: string
  multiplier: typeof HOT_AREA_RADIUS_MULTIPLIER
  multiplierLabel: string
  color: string
  outline: string
  selected: boolean
  active: boolean
  recommendationRank: number
}

export const HOT_AREA_PREVIEW_AREAS: readonly HotAreaPreviewArea[] = Object.freeze([
  Object.freeze({
    id: 'kensington-music',
    category: 'music',
    categoryLabel: 'MUSIC',
    channelId: 'music',
    label: 'Kensington Market',
    city: 'Toronto',
    distanceKm: 1.8,
    center: [-79.4007, 43.6543] as const,
    radiusKm: 0.72,
    color: '#EC3E91',
    outline: '#FFD0E8',
    expiresLabel: 'hot for 23 min',
    minutesRemaining: 23,
    demandGap: 0.96,
    multiplier: HOT_AREA_RADIUS_MULTIPLIER,
    active: true,
  }),
  Object.freeze({
    id: 'st-lawrence-food',
    category: 'food',
    categoryLabel: 'FOOD',
    channelId: 'food',
    label: 'St. Lawrence Market',
    city: 'Toronto',
    distanceKm: 2.6,
    center: [-79.3716, 43.6487] as const,
    radiusKm: 0.58,
    color: '#F2A11D',
    outline: '#FFE3A2',
    expiresLabel: 'hot for 18 min',
    minutesRemaining: 18,
    demandGap: 0.88,
    multiplier: HOT_AREA_RADIUS_MULTIPLIER,
    active: true,
  }),
  Object.freeze({
    id: 'yorkville-style',
    category: 'style',
    categoryLabel: 'STYLE',
    channelId: 'fashion',
    label: 'Yorkville',
    city: 'Toronto',
    distanceKm: 3.1,
    center: [-79.3908, 43.6709] as const,
    radiusKm: 0.55,
    color: '#9560E4',
    outline: '#E1CFFF',
    expiresLabel: 'hot for 27 min',
    minutesRemaining: 27,
    demandGap: 0.79,
    multiplier: HOT_AREA_RADIUS_MULTIPLIER,
    active: true,
  }),
  Object.freeze({
    id: 'scotiabank-sports',
    category: 'sports',
    categoryLabel: 'SPORTS',
    channelId: 'sports',
    label: 'Scotiabank Arena',
    city: 'Toronto',
    distanceKm: 2.2,
    center: [-79.3791, 43.6435] as const,
    radiusKm: 0.64,
    color: '#34BEEB',
    outline: '#C9F5FF',
    expiresLabel: 'hot for 16 min',
    minutesRemaining: 16,
    demandGap: 0.84,
    multiplier: HOT_AREA_RADIUS_MULTIPLIER,
    active: true,
  }),
])

export const HOT_AREA_DEMO_SIGNALS: readonly HotAreaPreferenceSignal[] = Object.freeze([
  Object.freeze({ category: 'music', recentPostCount: 3, engagementScore: 18 }),
  Object.freeze({ category: 'food', recentPostCount: 1, engagementScore: 12 }),
  Object.freeze({ category: 'style', recentPostCount: 1, engagementScore: 8 }),
  Object.freeze({ category: 'sports', recentPostCount: 0, engagementScore: 6 }),
])

function preferenceScore(signal: HotAreaPreferenceSignal | undefined, area: HotAreaPreviewArea): number {
  const personal = signal
    ? signal.recentPostCount * 4 + signal.engagementScore
    : 0
  return personal + area.demandGap * 10
}

export function isHotAreaAvailable(area: HotAreaPreviewArea): boolean {
  return area.active && area.minutesRemaining > 0
}

export function firstHotAreaForCategory(
  category: HotAreaCategoryFilter,
  areas: readonly HotAreaPreviewArea[] = HOT_AREA_PREVIEW_AREAS,
): HotAreaPreviewArea | null {
  return areas.find((area) => (
    isHotAreaAvailable(area) && (category === 'all' || area.category === category)
  )) ?? null
}

export function recommendHotArea(
  signals: readonly HotAreaPreferenceSignal[],
  areas: readonly HotAreaPreviewArea[] = HOT_AREA_PREVIEW_AREAS,
): HotAreaRecommendation | null {
  const activeAreas = areas.filter(isHotAreaAvailable)
  if (!activeAreas.length) return null

  const byCategory = new Map(signals.map((signal) => [signal.category, signal]))
  const ranked = activeAreas
    .map((area) => ({ area, score: preferenceScore(byCategory.get(area.category), area) }))
    .sort((left, right) => right.score - left.score || left.area.id.localeCompare(right.area.id))
  const winner = ranked[0]
  const signal = byCategory.get(winner.area.category)
  const generic = !signal || (signal.recentPostCount <= 0 && signal.engagementScore <= 0)

  return {
    area: winner.area,
    score: winner.score,
    generic,
    reason: generic
      ? `${winner.area.categoryLabel} has strong local demand with less fresh content nearby.`
      : `${winner.area.categoryLabel} is ${signal.recentPostCount} of your last 5 posts, and it is what you engage with most.`,
  }
}

export function hotAreaViralOutcome(input: HotAreaViralOutcomeInput): HotAreaViralOutcome {
  const base = Math.max(0, input.baseRadiusGrowthKm)
  let reason: HotAreaViralOutcome['reason'] = 'active'

  if (input.baseRadiusGrowthKm <= 0) reason = 'non-positive'
  else if (!isHotAreaAvailable(input.area)) reason = 'expired'
  else if (!input.postedInsideArea) reason = 'outside-area'
  else if (input.contentCategory !== input.area.category) reason = 'wrong-category'
  else if (input.alreadyRewarded) reason = 'already-rewarded'
  else if (
    input.uniqueViewers < HOT_AREA_VIRAL_GATE.uniqueViewers
    || input.highIntentActions < HOT_AREA_VIRAL_GATE.highIntentActions
    || input.velocityMultiple < HOT_AREA_VIRAL_GATE.velocityMultiple
  ) reason = 'not-viral'

  const eligible = reason === 'active'
  const bonus = eligible
    ? base * (HOT_AREA_RADIUS_MULTIPLIER - 1)
    : 0
  return {
    eligible,
    multiplier: eligible ? HOT_AREA_RADIUS_MULTIPLIER : 1,
    baseRadiusGrowthKm: base,
    bonusRadiusGrowthKm: bonus,
    totalRadiusGrowthKm: base + bonus,
    reason,
  }
}

function hotAreaParcelHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Produce a small, deterministic opportunity parcel. Radius is only an input
 * to its approximate area; the result is angular and is consumed as a
 * `within` mask, never drawn as a circle or translucent radius blob.
 */
function closedHotAreaParcel(
  id: string,
  center: readonly [number, number],
  radiusKm: number,
): [number, number][] {
  const [longitude, latitude] = center
  const kmPerDegreeLatitude = 110.574
  const kmPerDegreeLongitude = Math.max(18, 111.32 * Math.cos((latitude * Math.PI) / 180))
  const seed = hotAreaParcelHash(id)
  const steps = 7 + (seed % 3)
  const phase = (((seed >>> 8) % 360) * Math.PI) / 180
  const longitudeScale = 0.8 + ((seed >>> 17) % 21) / 100
  const latitudeScale = 0.76 + ((seed >>> 23) % 25) / 100
  const ring = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2
    const vertexSeed = hotAreaParcelHash(`${id}:${index}`)
    const shapedRadius = radiusKm * (0.72 + (vertexSeed % 34) / 100)
    return [
      longitude + (shapedRadius * longitudeScale / kmPerDegreeLongitude) * Math.cos(angle + phase),
      latitude + (shapedRadius * latitudeScale / kmPerDegreeLatitude) * Math.sin(angle + phase),
    ] as [number, number]
  })
  ring.push([...ring[0]])
  return ring
}

export function hotAreaFeatureCollection(
  filter: HotAreaCategoryFilter = 'all',
  selectedAreaId: string | null = null,
  areas: readonly HotAreaPreviewArea[] = HOT_AREA_PREVIEW_AREAS,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, HotAreaFeatureProperties> {
  const visible = areas.filter((area) => (
    isHotAreaAvailable(area) && (filter === 'all' || area.category === filter)
  ))
  return {
    type: 'FeatureCollection',
    features: visible.map((area, index) => ({
      type: 'Feature',
      properties: {
        id: area.id,
        category: area.category,
        categoryLabel: area.categoryLabel,
        channelId: area.channelId,
        label: area.label,
        city: area.city,
        multiplier: area.multiplier,
        multiplierLabel: `${area.multiplier.toFixed(1)}× RADIUS`,
        color: area.color,
        outline: area.outline,
        selected: area.id === selectedAreaId,
        active: area.active,
        recommendationRank: index + 1,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [closedHotAreaParcel(area.id, area.center, area.radiusKm)],
      },
    })),
  }
}

export function hotAreaById(id: string | null | undefined): HotAreaPreviewArea | null {
  return HOT_AREA_PREVIEW_AREAS.find((area) => area.id === id) ?? null
}
