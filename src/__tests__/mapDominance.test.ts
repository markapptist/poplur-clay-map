import { describe, expect, it } from 'vitest'
import {
  DOMINANCE_DETAIL_MIN_ZOOM,
  DOMINANCE_GROUND_SLOT,
  DOMINANCE_OVERVIEW_MAX_ZOOM,
  dominanceFillOpacityAtZoom,
  dominanceFillOpacityExpression,
  dominanceInsertBefore,
  dominancePaintOrder,
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

  it('makes the larger-radius overview winner visually exclusive', () => {
    const ordered = dominancePaintOrder([
      { id: 'small-pink', radiusKm: 8 },
      { id: 'large-blue', radiusKm: 30 },
    ])

    expect(ordered[ordered.length - 1]?.id).toBe('large-blue')
    expect(dominanceFillOpacityAtZoom(0)).toBe(1)
    expect(dominanceFillOpacityAtZoom(DOMINANCE_OVERVIEW_MAX_ZOOM)).toBe(1)
    expect(dominanceFillOpacityAtZoom(DOMINANCE_DETAIL_MIN_ZOOM)).toBe(0.78)
    expect(dominanceFillOpacityExpression()).toEqual([
      'interpolate', ['linear'], ['zoom'],
      DOMINANCE_OVERVIEW_MAX_ZOOM, 1,
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
})
