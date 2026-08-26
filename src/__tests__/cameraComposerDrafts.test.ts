import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPendingMapPost,
  setPendingAICompose,
  setPendingMapPost,
  takePendingAICompose,
  takePendingMapPost,
} from '../cameraStore'

const media = { kind: 'photo' as const, src: 'data:image/jpeg;base64,fixture' }

afterEach(() => {
  clearPendingMapPost()
  takePendingAICompose()
})

describe('camera composer draft hand-offs', () => {
  it('keeps the full camera draft through the one location-picker detour', () => {
    setPendingMapPost({
      media,
      caption: 'Sunset pop',
      channelId: 'food',
      filterId: 'smooth-glow',
      effectId: 'clay-globe',
      usedAI: true,
      rightsAttested: true,
      aiPrompt: 'Make this cinematic',
    })

    expect(takePendingMapPost()).toMatchObject({
      caption: 'Sunset pop',
      usedAI: true,
      rightsAttested: true,
      aiPrompt: 'Make this cinematic',
    })
    expect(takePendingMapPost()).toBeNull()
  })

  it('keeps a map-first target attached during the AI conversation hand-off', () => {
    setPendingAICompose({
      media,
      prompt: 'Make this cinematic',
      aiPrompt: 'Make this cinematic',
      caption: '',
      channelId: 'food',
      filterId: 'none',
      usedAI: true,
      rightsAttested: true,
      target: { lat: 43.6532, lng: -79.3832, radiusKm: 4.5 },
    })

    expect(takePendingAICompose()).toMatchObject({
      prompt: 'Make this cinematic',
      rightsAttested: true,
      target: { lat: 43.6532, lng: -79.3832, radiusKm: 4.5 },
    })
    expect(takePendingAICompose()).toBeNull()
  })
})
