import { describe, expect, it } from 'vitest'
import { DEFAULT_CUBE_MODEL } from '../navigatorContract'
import { HALLOWEEN_CUBE_MODEL, defaultCubeModel, halloweenCubeActive, seasonalDefaultCubeModel } from '../seasonalCube'

// Local-time dates, the way the phone's clock reads them.
const at = (iso: string) => new Date(iso)

describe('Halloween 2026 default cube', () => {
  it('wears the jack-o-lantern from 1 October through all of 31 October', () => {
    expect(halloweenCubeActive(at('2026-10-01T00:00:00'))).toBe(true)
    expect(halloweenCubeActive(at('2026-10-11T12:00:00'))).toBe(true)
    expect(halloweenCubeActive(at('2026-10-31T00:00:00'))).toBe(true)
    expect(halloweenCubeActive(at('2026-10-31T23:59:59'))).toBe(true)
  })

  it('returns the plain cube from 1 November, and before October', () => {
    expect(halloweenCubeActive(at('2026-11-01T00:00:00'))).toBe(false)
    expect(halloweenCubeActive(at('2026-09-30T23:59:59'))).toBe(false)
    expect(halloweenCubeActive(at('2027-10-15T12:00:00'))).toBe(false)
  })

  it('resolves the worn default and the AVATAR fallback from the same window', () => {
    expect(seasonalDefaultCubeModel(at('2026-10-20T09:00:00'))).toBe(HALLOWEEN_CUBE_MODEL)
    expect(defaultCubeModel(at('2026-10-20T09:00:00'))).toBe(HALLOWEEN_CUBE_MODEL)
    expect(seasonalDefaultCubeModel(at('2026-11-02T09:00:00'))).toBeNull()
    expect(defaultCubeModel(at('2026-11-02T09:00:00'))).toBe(DEFAULT_CUBE_MODEL)
  })

  it('reads as a date gate the way the bake and tests expect the model name', () => {
    expect(HALLOWEEN_CUBE_MODEL).toBe('poplur_cube_jackolantern.glb')
  })
})
