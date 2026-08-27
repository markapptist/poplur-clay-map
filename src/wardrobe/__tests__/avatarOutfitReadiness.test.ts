import { describe, expect, it } from 'vitest'
import { retainedOutfitParts, type AvatarOutfitSelection } from '../../avatarOutfitReadiness'

const initial: AvatarOutfitSelection = {
  gender: 'female',
  top: 'tailored-blazer',
  bottom: 'tailored-trousers',
}

describe('avatar fitted-outfit readiness', () => {
  it('retains a loaded bottom during a top-only change', () => {
    const retained = retainedOutfitParts(
      initial,
      { ...initial, top: 'clo-new-jacket' },
      new Set(['top', 'bottom']),
    )
    expect([...retained]).toEqual(['bottom'])
  })

  it('retains a loaded top during a bottom-only change', () => {
    const retained = retainedOutfitParts(
      initial,
      { ...initial, bottom: 'clo-new-trousers' },
      new Set(['top', 'bottom']),
    )
    expect([...retained]).toEqual(['top'])
  })

  it('requires both garments again when the body gender changes', () => {
    const retained = retainedOutfitParts(
      initial,
      { ...initial, gender: 'male' },
      new Set(['top', 'bottom']),
    )
    expect(retained.size).toBe(0)
  })
})
