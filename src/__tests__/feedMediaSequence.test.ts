import { describe, expect, it } from 'vitest'
import {
  mixPublishedMediaWithPromotions,
  nextFeedPostIndex,
  shouldResumeFeedAfterFocus,
} from '../feedMediaSequence'

describe('Feed TV media sequence', () => {
  it('keeps uploaded photos, uploaded videos, and ads in the same channel', () => {
    const uploaded = [
      { id: 'photo', kind: 'photo' },
      { id: 'video', kind: 'video' },
      { id: 'second-photo', kind: 'photo' },
    ]
    const ads = [{ id: 'ad-one', kind: 'ad' }, { id: 'ad-two', kind: 'ad' }]

    expect(mixPublishedMediaWithPromotions(uploaded, ads).map(item => item.id))
      .toEqual(['photo', 'video', 'ad-one', 'second-photo', 'ad-two'])
  })

  it('still shows an ad after a channel containing just one uploaded photo', () => {
    expect(mixPublishedMediaWithPromotions(
      [{ id: 'my-photo' }],
      [{ id: 'sponsored-video' }],
    ).map(item => item.id)).toEqual(['my-photo', 'sponsored-video'])
  })

  it('continues through repeated clip completions instead of resting', () => {
    let index = 0
    const visited: number[] = []
    for (let completion = 0; completion < 12; completion += 1) {
      index = nextFeedPostIndex(index, 3)
      visited.push(index)
    }
    expect(visited).toEqual([1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0])
  })

  it('resumes a visible focus-paused clip but honors a viewer pause', () => {
    const visible = {
      hasSource: true,
      paused: true,
      documentVisible: true,
      displayActive: true,
      completed: false,
    }
    expect(shouldResumeFeedAfterFocus({ ...visible, userPaused: false })).toBe(true)
    expect(shouldResumeFeedAfterFocus({ ...visible, userPaused: true })).toBe(false)
    expect(shouldResumeFeedAfterFocus({ ...visible, userPaused: false, documentVisible: false })).toBe(false)
  })
})
