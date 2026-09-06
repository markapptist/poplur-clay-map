import { describe, expect, it } from 'vitest'
import {
  DOMINANCE_DETAIL_MIN_ZOOM,
  DOMINANCE_GROUND_SLOT,
  DOMINANCE_OVERVIEW_MAX_ZOOM,
  DOMINANCE_SCOREBOARD_OUTLINE_ZOOM,
  dominanceFillOpacityAtZoom,
  dominanceFillOpacityExpression,
  dominanceFameScore,
  dominanceInsertBefore,
  dominanceLeaders,
  dominancePaintOrder,
  groundPaintOrder,
  dominancePower,
  effectiveDominanceLevel,
  isDominanceOverviewZoom,
} from '../mapDominance'

describe('map dominance overview', () => {
  it('shows the whole colour board only at settled regional/world zooms', () => {
    expect(effectiveDominanceLevel('mine', DOMINANCE_OVERVIEW_MAX_ZOOM)).toBe('all')
    expect(effectiveDominanceLevel('others', 2)).toBe('all')
    expect(effectiveDominanceLevel('mine', DOMINANCE_OVERVIEW_MAX_ZOOM + 0.01)).toBe('mine')
    expect(effectiveDominanceLevel('others', 14)).toBe('others')
    expect(effectiveDominanceLevel('all', 14)).toBe('all')
    expect(isDominanceOverviewZoom(Number.NaN)).toBe(false)
  })

  it('paints the larger-radius holder last in every overlap', () => {
    const ordered = dominancePaintOrder([
      { id: 'medium', radiusKm: 20 },
      { id: 'largest', radiusKm: 80 },
      { id: 'small', radiusKm: 5 },
    ])
    expect(ordered.map(claim => claim.id)).toEqual(['small', 'medium', 'largest'])
  })

  it('places terrain and its rim above land but under the water mask', () => {
    const layers = [
      { id: 'clay-grass-fill', type: 'fill', slot: 'bottom' },
      { id: 'clay-water-fill', type: 'fill', slot: 'bottom' },
      { id: 'clay-real-road-body', type: 'line', slot: 'middle' },
    ]
    const beforeId = dominanceInsertBefore(layers)
    expect(beforeId).toBe('clay-water-fill')

    // Model Mapbox's slot-aware insertion rule: beforeId is honoured only
    // when the new and target layers share a slot. This catches the regression
    // where claims lost `slot: bottom` and were appended outside clay ground.
    const target = layers.find(layer => layer.id === beforeId)
    expect(DOMINANCE_GROUND_SLOT).toBe(target?.slot)

    expect(dominanceInsertBefore([
      { id: 'base-water', type: 'fill' },
      { id: 'regional-lakes', type: 'fill' },
      { id: 'roads', type: 'line' },
    ])).toBe('regional-lakes')
  })

  it('draws held ground as an OUTLINE at scoreboard zooms, never a fill', () => {
    // This used to assert the opposite: a fully opaque fill out here, so the
    // largest holder painted last and replaced every smaller one in an
    // overlap. Clean rule, unusable picture — opaque neighbours merge with no
    // seam, so a city's claims become one shape and a continent's become one
    // colour. Measured 6 Sep: 22 claims in view at z5 painted the whole of
    // eastern North America a single flat pink, which is the "just a blob when
    // I zoom out" report. Outlines cannot merge, so they carry it instead.
    const ordered = dominancePaintOrder([
      { id: 'small-pink', radiusKm: 8 },
      { id: 'large-blue', radiusKm: 30 },
    ])
    // Paint order still resolves overlaps wherever there IS a fill.
    expect(ordered[ordered.length - 1]?.id).toBe('large-blue')

    expect(dominanceFillOpacityAtZoom(0)).toBe(0)
    expect(dominanceFillOpacityAtZoom(DOMINANCE_SCOREBOARD_OUTLINE_ZOOM)).toBe(0)
    // And it comes back as ground by the detail zoom.
    expect(dominanceFillOpacityAtZoom(DOMINANCE_DETAIL_MIN_ZOOM)).toBe(0.78)
    expect(dominanceFillOpacityAtZoom(7)).toBeGreaterThan(0)
    expect(dominanceFillOpacityAtZoom(7)).toBeLessThan(0.78)
    expect(dominanceFillOpacityExpression()).toEqual([
      'interpolate', ['linear'], ['zoom'],
      DOMINANCE_SCOREBOARD_OUTLINE_ZOOM, 0,
      DOMINANCE_DETAIL_MIN_ZOOM, 0.78,
    ])
  })

  it('keeps equal-radius paint order deterministic', () => {
    const ordered = dominancePaintOrder([
      { id: 'zulu', radiusKm: 20 },
      { id: 'alpha', radiusKm: 20 },
    ])
    expect(ordered.map(claim => claim.id)).toEqual(['alpha', 'zulu'])
  })

  it('rewards returning attention and lets downvotes reduce fame', () => {
    const passive = dominanceFameScore(10, { views: 25 })
    const returning = dominanceFameScore(10, { views: 25, repeatViews: 9 })
    const rejected = dominanceFameScore(10, { views: 25, repeatViews: 9, downvotes: 20 })
    expect(returning).toBeGreaterThan(passive)
    expect(rejected).toBeLessThan(returning)
    expect(dominanceFameScore(0, { downvotes: 10_000 })).toBe(0)
  })

  it('uses one fame power contract for overlap order', () => {
    const quietLarge = { id: 'quiet-large', radiusKm: 30, fameScore: 3_000 }
    const famousLocal = { id: 'famous-local', radiusKm: 12, fameScore: 9_000 }
    const ordered = dominancePaintOrder([famousLocal, quietLarge])
    expect(ordered.map(claim => claim.id)).toEqual(['quiet-large', 'famous-local'])
    expect(dominancePower(famousLocal)).toBeGreaterThan(dominancePower(quietLarge))
  })

  it('builds a deterministic fame board and takes the selfie from the top area', () => {
    const rows = dominanceLeaders([
      { id: 'a-small', ownerId: 'a', user: '@alpha', name: 'Small', radiusKm: 4, color: '#f00', avatar: '/small.jpg', mine: false, engagement: { upvotes: 2 } },
      { id: 'a-large', ownerId: 'a', user: '@alpha-renamed', name: 'Large', radiusKm: 20, color: '#f00', avatar: '/large.jpg', mine: false, engagement: { repeatViews: 8 } },
      { id: 'b', ownerId: 'b', user: '@beta', name: 'Beta', radiusKm: 8, color: '#0af', avatar: '/beta.jpg', mine: false },
    ], '#F63B9A')
    expect(rows[0]?.owner).toBe('a')
    expect(rows[0]?.territories).toBe(2)
    expect(rows[0]?.topPlace).toBe('Large')
    expect(rows[0]?.avatar).toBe('/large.jpg')
  })
})

describe('ground paint order', () => {
  it('is the reverse of the dominance order: widest first, most local on top', () => {
    const claims = [
      { id: 'local', radiusKm: 9.3 },
      { id: 'wide', radiusKm: 157.9 },
      { id: 'tiny', radiusKm: 1.9 },
    ]
    expect(groundPaintOrder(claims).map(claim => claim.id)).toEqual(['wide', 'local', 'tiny'])
    // The dominance order itself is untouched — other readers still get it.
    expect(dominancePaintOrder(claims).map(claim => claim.id)).toEqual(['tiny', 'local', 'wide'])
  })
})
