import { describe, expect, it } from 'vitest'
import {
  createNativeMapConquerSnapshot,
  nativeConquerScopeForZoom,
} from '../nativeMapConquerSnapshot'

describe('native MapKit Conquer snapshot', () => {
  it('uses the same bounded board contract as the Mapbox renderer', () => {
    const snapshot = createNativeMapConquerSnapshot({
      level: 'all',
      zoom: 0.9,
      ownAvatar: null,
      generatedAt: 42,
    })
    expect(snapshot).toMatchObject({ scope: 'LOCAL', generatedAt: 42 })
    expect(snapshot.rows.length).toBeGreaterThan(2)
    expect(snapshot.rows.length).toBeLessThanOrEqual(24)
    expect(snapshot.rows.some(row => row.mine)).toBe(true)
    expect(snapshot.rows.some(row => row.label === '@pitchside')).toBe(true)
  })

  it('switches regional and city challengers with the native camera', () => {
    expect(nativeConquerScopeForZoom(0)).toBe('WORLD')
    expect(nativeConquerScopeForZoom(0.44)).toBe('WORLD')
    expect(nativeConquerScopeForZoom(0.45)).toBe('LOCAL')

    const world = createNativeMapConquerSnapshot({ level: 'others', zoom: 0.1, ownAvatar: null, generatedAt: 1 })
    const local = createNativeMapConquerSnapshot({ level: 'others', zoom: 0.9, ownAvatar: null, generatedAt: 2 })
    expect(world.scope).toBe('WORLD')
    expect(local.scope).toBe('LOCAL')
    expect(world.rows.some(row => row.label === '@citydesk')).toBe(true)
    expect(local.rows.some(row => row.label === '@pitchside')).toBe(true)
    expect(local.rows.some(row => row.label === '@citydesk')).toBe(false)
  })
})
