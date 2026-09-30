import { describe, expect, it } from 'vitest'
import { HERE_RADIUS_KM, postSpotGate } from '../postSpotGate'

const fix = { latitude: 43.6487, longitude: -79.3811 }

describe('free posting is where you are', () => {
  it('passes a spot within a walk of the fix', () => {
    const gate = postSpotGate({ target: { lat: 43.652, lng: -79.385 }, fix })
    expect(gate.allowed).toBe(true)
    expect(gate.reason).toBe('here')
    expect(gate.distanceKm).toBeLessThan(HERE_RADIUS_KM)
  })

  it('refuses a spot across town, with the distance to explain it', () => {
    const gate = postSpotGate({ target: { lat: 43.729, lng: -79.607 }, fix })
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toBe('remote')
    expect(gate.distanceKm).toBeGreaterThan(15)
  })

  it('refuses the other side of the planet', () => {
    expect(postSpotGate({ target: { lat: -33.87, lng: 151.21 }, fix }).allowed).toBe(false)
  })

  it('allows a local spot across the date line without interpreting it as a global jump', () => {
    const gate = postSpotGate({ target: { lat: 0, lng: -179.999 }, fix: { latitude: 0, longitude: 179.999 } })
    expect(gate.allowed).toBe(true)
    expect(gate.distanceKm).toBeCloseTo(0.222, 2)
  })

  it('cannot judge without a fix, and does not guess', () => {
    const gate = postSpotGate({ target: { lat: 43.652, lng: -79.385 }, fix: null })
    expect(gate).toEqual({ allowed: false, distanceKm: null, reason: 'no-fix' })
  })

  it('needs a spot at all', () => {
    expect(postSpotGate({ target: null, fix }).allowed).toBe(false)
  })

  it('lets the synthetic harness post at cohort spots', () => {
    const far = { lat: 43.729, lng: -79.607 }
    expect(postSpotGate({ target: far, fix, viewerUid: 'sim-daily-2026-01' }).reason).toBe('harness')
    expect(postSpotGate({ target: far, fix, viewerUid: 'synthetic-conquer-3' }).allowed).toBe(true)
    expect(postSpotGate({ target: far, fix: null, harness: true }).allowed).toBe(true)
    expect(postSpotGate({ target: far, fix, viewerUid: 'simeon-real-person' }).allowed).toBe(false)
  })
})
