import { describe, expect, it, vi } from 'vitest'
import { radioShareText, shareRadioStation } from '../radioShare'
import type { LocalStation } from '../mapRadio'

const station: LocalStation = {
  id: 'station-1',
  name: 'City Radio',
  url: 'https://radio.example/live',
  genre: 'Pop',
  distanceKm: 3.2,
  bitrate: 128,
  listeners: 24,
  logo: null,
  source: 'radio',
}

describe('Radio share control', () => {
  it('uses the native share sheet first with the tuned station', async () => {
    const postNative = vi.fn((_message: Record<string, unknown>) => true)
    const share = vi.fn(async () => {})
    await expect(shareRadioStation(station, { postNative, share })).resolves.toBe('Opening share sheet')
    expect(postNative).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sharePost',
      stationId: 'station-1',
      title: 'Listen to City Radio on Poplur Radio',
      link: station.url,
    }))
    expect(postNative.mock.calls[0]?.[0]).not.toHaveProperty('postId')
    expect(share).not.toHaveBeenCalled()
  })

  it('uses Web Share outside native and reports a completed share', async () => {
    const share = vi.fn(async () => {})
    await expect(shareRadioStation(station, { postNative: () => false, share })).resolves.toBe('Station shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: station.name,
      url: station.url,
    }))
  })

  it('falls back to an honest clipboard copy when Web Share fails', async () => {
    const copy = vi.fn(async () => {})
    await expect(shareRadioStation(station, {
      postNative: () => false,
      share: async () => { throw new Error('not supported') },
      copy,
    })).resolves.toBe('Station link copied')
    expect(copy).toHaveBeenCalledWith(radioShareText(station))
  })
})
