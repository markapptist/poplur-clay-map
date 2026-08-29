import { describe, expect, it, vi } from 'vitest'
import {
  createNearbyRadioController,
  createRadioPlaybackStore,
  mapRadioStatusLabel,
  shouldUseRichRadioBed,
} from '../mapRadioControl'

describe('map radio resource policy', () => {
  it('keeps Map and boot tuning media-only even when a rich context already exists', () => {
    expect(shouldUseRichRadioBed('listener')).toBe(true)
    expect(shouldUseRichRadioBed('map')).toBe(false)
    expect(shouldUseRichRadioBed('boot')).toBe(false)
  })
})

describe('map radio playback store', () => {
  it('publishes only real playback edges and stops notifying after unsubscribe', () => {
    const store = createRadioPlaybackStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.publish('fallback')
    store.publish('fallback')
    store.publish('live')
    store.publish('off')

    expect(store.getSnapshot()).toBe('off')
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    store.publish('muted')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe('map radio location label', () => {
  it('stays absent while Radio is off and identifies every active state', () => {
    expect(mapRadioStatusLabel('off', 'Jazz FM')).toBeNull()
    expect(mapRadioStatusLabel('fallback', null)).toBe('Poplur Radio · ON AIR')
    expect(mapRadioStatusLabel('live', '  Jazz FM  ')).toBe('Jazz FM · LIVE')
    expect(mapRadioStatusLabel('muted', 'Jazz FM')).toBe('Jazz FM · MUTED')
  })
})

describe('nearby map radio controller', () => {
  it('selects the first secure nearby station', async () => {
    const play = vi.fn()
    const controller = createNearbyRadioController({
      lookup: vi.fn(async () => [
        { url: 'http://unsafe.example/radio' },
        { url: 'https://nearby.example/radio' },
      ]),
      isActive: () => true,
      play,
    })

    const station = await controller.start(43.65, -79.38)

    expect(station?.url).toBe('https://nearby.example/radio')
    expect(play).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledWith(station)
  })

  it('cannot resurrect a late station after the listener stops Radio', async () => {
    let resolveLookup!: (stations: Array<{ url: string }>) => void
    let lookupSignal!: AbortSignal
    const play = vi.fn()
    const controller = createNearbyRadioController({
      lookup: vi.fn((_lat, _lng, signal) => {
        lookupSignal = signal
        return new Promise<Array<{ url: string }>>(resolve => { resolveLookup = resolve })
      }),
      isActive: () => false,
      play,
    })

    const pending = controller.start(43.65, -79.38)
    controller.stop()
    resolveLookup([{ url: 'https://late.example/radio' }])

    await expect(pending).resolves.toBeNull()
    expect(lookupSignal.aborted).toBe(true)
    expect(play).not.toHaveBeenCalled()
  })

  it('cannot overwrite a newer manual choice with a late Map result', async () => {
    let resolveLookup!: (stations: Array<{ url: string }>) => void
    let selectionGeneration = 4
    const play = vi.fn()
    const controller = createNearbyRadioController({
      lookup: vi.fn(() => new Promise<Array<{ url: string }>>(resolve => {
        resolveLookup = resolve
      })),
      isActive: () => true,
      readSelectionGeneration: () => selectionGeneration,
      play,
    })

    const pending = controller.start(43.65, -79.38)
    selectionGeneration += 1
    resolveLookup([{ url: 'https://late-map.example/radio' }])

    await expect(pending).resolves.toBeNull()
    expect(play).not.toHaveBeenCalled()
  })
})
