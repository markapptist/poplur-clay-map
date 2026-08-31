import { describe, expect, it } from 'vitest'
import { preferredLandmarkRendererId } from '../landmarkRendererSelection'
import {
  landmarkRendererCompanions,
  landmarkRendererRootId,
} from '../mapLandmarkCatalog'

const torontoLandmarks = [
  { id: 'cn-tower', coords: [-79.3871, 43.6426] as const },
  { id: 'rogers-centre', coords: [-79.38918212, 43.64161058] as const },
]

describe('preferredLandmarkRendererId', () => {
  it('keeps CN Tower for its authored search and tour framing', () => {
    expect(preferredLandmarkRendererId(
      [-79.38677, 43.64418],
      torontoLandmarks,
    )).toBe('cn-tower')
  })

  it('keeps Rogers Centre when its roof-first frame is selected', () => {
    expect(preferredLandmarkRendererId(
      [-79.38834927, 43.64200635],
      torontoLandmarks,
    )).toBe('rogers-centre')
  })

  it('returns null when no overlapping candidates exist', () => {
    expect(preferredLandmarkRendererId([0, 0], [])).toBeNull()
  })

  it('keeps both Toronto camera identities in one CN Tower renderer group', () => {
    expect(landmarkRendererRootId('cn-tower')).toBe('cn-tower')
    expect(landmarkRendererRootId('rogers-centre')).toBe('cn-tower')
    expect(landmarkRendererCompanions('cn-tower').map(item => item.id)).toEqual([
      'rogers-centre',
    ])
    expect(landmarkRendererCompanions('rogers-centre')).toEqual([])
  })
})
