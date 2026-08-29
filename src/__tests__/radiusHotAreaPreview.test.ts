import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  firstHotAreaForCategory,
  HOT_AREA_DEMO_SIGNALS,
  HOT_AREA_PREVIEW_AREAS,
  HOT_AREA_RADIUS_MULTIPLIER,
  hotAreaFeatureCollection,
  hotAreaViralOutcome,
  recommendHotArea,
} from '../radiusHotAreaPreview'
import { radiusPreviewHotAreaPaintExpression } from '../radiusPreviewMapPresentation'

describe('radius Hot Area preview', () => {
  it('recommends the strongest matching category deterministically', () => {
    const recommendation = recommendHotArea(HOT_AREA_DEMO_SIGNALS)
    expect(recommendation?.area.id).toBe('kensington-music')
    expect(recommendation?.generic).toBe(false)
    expect(recommendation?.reason).toContain('3 of your last 5 posts')

    const tieAreas = [
      { ...HOT_AREA_PREVIEW_AREAS[0], id: 'z-area', demandGap: 0.5 },
      { ...HOT_AREA_PREVIEW_AREAS[0], id: 'a-area', demandGap: 0.5 },
    ]
    expect(recommendHotArea([], tieAreas)?.area.id).toBe('a-area')
  })

  it('uses a generic local-demand explanation when there is no personal signal', () => {
    const recommendation = recommendHotArea([])
    expect(recommendation?.generic).toBe(true)
    expect(recommendation?.reason).toContain('local demand')
    expect(recommendHotArea([], HOT_AREA_PREVIEW_AREAS.map((area) => ({ ...area, active: false })))).toBeNull()
  })

  it('applies exactly 1.5x to positive verified viral growth in a matching active area', () => {
    const outcome = hotAreaViralOutcome({
      area: HOT_AREA_PREVIEW_AREAS[0],
      contentCategory: 'music',
      baseRadiusGrowthKm: 2,
      postedInsideArea: true,
      uniqueViewers: 8,
      highIntentActions: 3,
      velocityMultiple: 2,
      alreadyRewarded: false,
    })
    expect(outcome).toEqual({
      eligible: true,
      multiplier: HOT_AREA_RADIUS_MULTIPLIER,
      baseRadiusGrowthKm: 2,
      bonusRadiusGrowthKm: 1,
      totalRadiusGrowthKm: 3,
      reason: 'active',
    })
  })

  it('keeps the advertised multiplier exact for a large positive payout', () => {
    const outcome = hotAreaViralOutcome({
      area: HOT_AREA_PREVIEW_AREAS[0],
      contentCategory: 'music',
      baseRadiusGrowthKm: 30,
      postedInsideArea: true,
      uniqueViewers: 80,
      highIntentActions: 30,
      velocityMultiple: 4,
      alreadyRewarded: false,
    })
    expect(outcome.multiplier).toBe(1.5)
    expect(outcome.bonusRadiusGrowthKm).toBe(15)
    expect(outcome.totalRadiusGrowthKm).toBe(45)
  })

  it.each([
    ['wrong-category', { contentCategory: 'food' as const }],
    ['outside-area', { postedInsideArea: false }],
    ['not-viral', { uniqueViewers: 7 }],
    ['not-viral', { highIntentActions: 2 }],
    ['not-viral', { velocityMultiple: 1.9 }],
    ['already-rewarded', { alreadyRewarded: true }],
    ['non-positive', { baseRadiusGrowthKm: -1 }],
  ])('does not multiply an ineligible result: %s', (reason, override) => {
    const outcome = hotAreaViralOutcome({
      area: HOT_AREA_PREVIEW_AREAS[0],
      contentCategory: 'music',
      baseRadiusGrowthKm: 2,
      postedInsideArea: true,
      uniqueViewers: 8,
      highIntentActions: 3,
      velocityMultiple: 2,
      alreadyRewarded: false,
      ...override,
    })
    expect(outcome.eligible).toBe(false)
    expect(outcome.multiplier).toBe(1)
    expect(outcome.bonusRadiusGrowthKm).toBe(0)
    expect(outcome.reason).toBe(reason)
  })

  it('keeps map data coarse, finite, angular, deterministic and category-filterable', () => {
    const authoredBefore = JSON.stringify(HOT_AREA_PREVIEW_AREAS)
    const all = hotAreaFeatureCollection('all', 'kensington-music')
    expect(hotAreaFeatureCollection('all', 'kensington-music')).toEqual(all)
    expect(all.features.length).toBeLessThanOrEqual(6)
    expect(new Set(all.features.map(({ properties }) => properties.id)).size).toBe(all.features.length)
    expect(all.features.every(({ properties }) => properties.multiplier === 1.5)).toBe(true)

    for (const feature of all.features) {
      const ring = feature.geometry.coordinates[0]
      const unique = ring.slice(0, -1)
      expect(unique.length).toBeGreaterThanOrEqual(7)
      expect(unique.length).toBeLessThanOrEqual(9)
      expect(ring[0]).toEqual(ring[ring.length - 1])
      expect(ring.flat().every(Number.isFinite)).toBe(true)
      const center = unique.reduce(
        ([longitude, latitude], point) => [longitude + point[0], latitude + point[1]],
        [0, 0],
      ).map((value) => value / unique.length)
      const distances = new Set(unique.map(([longitude, latitude]) => (
        Math.hypot(longitude - center[0], latitude - center[1]).toFixed(6)
      )))
      expect(distances.size).toBeGreaterThanOrEqual(3)
    }

    const music = hotAreaFeatureCollection('music')
    expect(music.features).toHaveLength(1)
    expect(music.features[0].properties.category).toBe('music')
    expect(JSON.stringify(HOT_AREA_PREVIEW_AREAS)).toBe(authoredBefore)
  })

  it('gives the selected Hot Area stable paint precedence without rendering a disc', () => {
    const collection = hotAreaFeatureCollection('all', 'scotiabank-sports')
    const reversed = { ...collection, features: [...collection.features].reverse() }
    const expression = radiusPreviewHotAreaPaintExpression(collection, '#fallback') as unknown[]

    expect(radiusPreviewHotAreaPaintExpression(reversed, '#fallback')).toEqual(expression)
    expect(expression[0]).toBe('case')
    expect(expression[expression.length - 1]).toBe('#fallback')
    const selected = collection.features.find(({ properties }) => properties.selected)
    expect(selected).toBeDefined()
    expect((expression[1] as unknown[])[1]).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: selected?.geometry }],
    })
  })

  it('never recommends, selects, or paints an expired Hot Area', () => {
    const areas = HOT_AREA_PREVIEW_AREAS.map((area, index) => ({
      ...area,
      minutesRemaining: index === 0 ? 0 : area.minutesRemaining,
    }))
    expect(recommendHotArea(HOT_AREA_DEMO_SIGNALS, areas)?.area.id).not.toBe('kensington-music')
    expect(firstHotAreaForCategory('music', areas)).toBeNull()
    expect(firstHotAreaForCategory('all', areas)?.id).toBe('st-lawrence-food')
    expect(hotAreaFeatureCollection('all', null, areas).features.map(({ properties }) => properties.id))
      .not.toContain('kensington-music')
  })

  it('wires the AI recommendation dialog for focus, Escape, and focus restoration', () => {
    const source = readFileSync(new URL('../RadiusPreviewExperience.tsx', import.meta.url), 'utf8')
    expect(source).toContain('aria-labelledby="poplur-hot-area-title"')
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).toContain('hotRecommendationPrimaryRef.current?.focus()')
    expect(source).toContain('restoreTarget?.focus()')
  })
})
