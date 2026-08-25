import { describe, expect, it } from 'vitest'
import { declaredMusicSource } from '../musicPlayback'

describe('music playback classification', () => {
  it('ignores ordinary audible video', () => {
    expect(declaredMusicSource({ dataset: {} } as Pick<HTMLMediaElement, 'dataset'>)).toBeNull()
  })

  it('accepts an explicitly declared music source', () => {
    expect(declaredMusicSource({
      dataset: { poplurMusic: 'feed' } as DOMStringMap,
    })).toBe('feed')
  })
})
