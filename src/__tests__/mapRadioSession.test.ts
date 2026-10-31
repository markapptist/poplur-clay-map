// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { isMapRadioActive, nowPlayingStation, setMapRadioEnabled, startDefaultMapRadio, stopMapRadio, tuneMapRadioLocation } from '../mapRadio'
import { isUserMuted, setUserMuted } from '../audioGate'

afterEach(() => { stopMapRadio(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('starts audible by default, tunes selected coordinates, and preserves an explicit stop', async () => {
  // An ordinary day: on a holiday the tuner leads with holiday stations.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-15T12:00:00') })
  const values = new Map<string, string>([['poplur.mapRadio.enabled', '0']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const lookup = vi.fn(async (input: string) => {
    const url = new URL(input)
    if (!url.pathname.endsWith('/search')) return new Response('{}')
    const lat = Number(url.searchParams.get('geo_lat')), lng = Number(url.searchParams.get('geo_long'))
    return new Response(JSON.stringify([{ stationuuid: `${lat}`, name: `Local ${lat}`, url_resolved: `https://station.invalid/${lat}`,
      codec: 'AAC', lastcheckok: 1, geo_lat: lat, geo_long: lng }]))
  })
  vi.stubGlobal('fetch', lookup)
  setUserMuted(true)
  startDefaultMapRadio(43.65, -79.38)
  await vi.waitFor(() => expect(nowPlayingStation()?.name).toBe('Local 43.65'))
  expect(isUserMuted()).toBe(false)
  expect(isMapRadioActive()).toBe(true)
  tuneMapRadioLocation(-36.85, 174.76)
  await vi.waitFor(() => expect(nowPlayingStation()?.name).toBe('Local -36.85'))
  const count = lookup.mock.calls.length
  tuneMapRadioLocation(-36.85, 174.76)
  await Promise.resolve()
  expect(lookup).toHaveBeenCalledTimes(count)
  setMapRadioEnabled(false)
  stopMapRadio()
  startDefaultMapRadio(43.65, -79.38)
  tuneMapRadioLocation(51.5, -0.12)
  expect(isMapRadioActive()).toBe(false)
  expect(nowPlayingStation()).toBeNull()
  expect(lookup).toHaveBeenCalledTimes(count)
})
