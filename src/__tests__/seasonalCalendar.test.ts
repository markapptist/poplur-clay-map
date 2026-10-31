// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeHoliday } from '../seasonalCalendar'
import { MAP_THEMES, seasonalMapTheme } from '../data'
import { listLocalRadioStations } from '../mapRadio'

// Local-time dates, the way the phone's clock reads them.
const at = (iso: string) => new Date(iso)
const holidayOn = (iso: string) => activeHoliday(at(iso))?.id ?? null

describe('the holiday calendar', () => {
  it('runs Halloween from 1 October through all of the 31st, every year', () => {
    expect(holidayOn('2026-09-30T23:59:59')).toBeNull()
    expect(holidayOn('2026-10-01T00:00:00')).toBe('halloween')
    expect(holidayOn('2026-10-31T23:59:59')).toBe('halloween')
    expect(holidayOn('2026-11-01T00:00:00')).toBeNull()
    expect(holidayOn('2027-10-31T20:00:00')).toBe('halloween')
  })

  it('wires the other holidays the map already has themes for', () => {
    expect(holidayOn('2026-12-01T09:00:00')).toBe('christmas')
    expect(holidayOn('2026-12-26T23:00:00')).toBe('christmas')
    expect(holidayOn('2026-12-27T09:00:00')).toBeNull()
    expect(holidayOn('2027-02-14T12:00:00')).toBe('valentine')
    expect(holidayOn('2027-02-13T12:00:00')).toBeNull()
    expect(holidayOn('2027-06-15T12:00:00')).toBe('pride')
    expect(holidayOn('2027-07-01T00:00:00')).toBeNull()
  })

  it('follows the moving Lunar New Year for a week, and lets Valentine\'s win the overlap', () => {
    expect(holidayOn('2027-02-05T12:00:00')).toBeNull()
    expect(holidayOn('2027-02-06T00:00:00')).toBe('lunar-new-year')
    expect(holidayOn('2027-02-12T23:59:59')).toBe('lunar-new-year')
    expect(holidayOn('2027-02-13T00:00:00')).toBeNull()
    expect(holidayOn('2029-02-13T12:00:00')).toBe('lunar-new-year')
    expect(holidayOn('2029-02-14T12:00:00')).toBe('valentine')
    expect(holidayOn('2029-02-15T12:00:00')).toBe('lunar-new-year')
  })

  it('is an ordinary day the rest of the year', () => {
    for (const iso of ['2026-11-15T12:00:00', '2027-01-10T12:00:00', '2027-04-01T12:00:00', '2027-08-20T12:00:00']) {
      expect(holidayOn(iso)).toBeNull()
    }
  })

  it('can be pinned by ?holiday= for previews, and only when no date is given', () => {
    window.history.replaceState(null, '', '/?holiday=christmas')
    expect(activeHoliday()?.id).toBe('christmas')
    expect(activeHoliday(at('2026-10-31T12:00:00'))?.id).toBe('halloween')
    window.history.replaceState(null, '', '/?holiday=none')
    expect(activeHoliday()).toBeNull()
    window.history.replaceState(null, '', '/')
  })
})

describe('the seasonal map palette', () => {
  it('wears the Halloween palette on Halloween and the clay palette otherwise', () => {
    const halloween = seasonalMapTheme(at('2026-10-31T21:00:00'))
    expect(halloween.id).toBe('halloween')
    expect(halloween.accent).toBe('#F28A25')
    expect(halloween.night?.land).toBeDefined()
    expect(seasonalMapTheme(at('2026-11-02T12:00:00'))).toBe(MAP_THEMES[0])
  })

  it('has a palette for every holiday on the calendar', () => {
    for (const iso of ['2026-12-10T12:00:00', '2027-02-14T12:00:00', '2027-02-08T12:00:00', '2027-06-10T12:00:00']) {
      const holiday = activeHoliday(at(iso))!
      expect(seasonalMapTheme(at(iso)).id).toBe(holiday.mapThemeId)
    }
  })
})

describe('holiday radio', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    stationuuid: id, name: id, url_resolved: `https://stream.invalid/${id}`, codec: 'MP3',
    lastcheckok: 1, clickcount: 1, tags: 'halloween', geo_lat: null, geo_long: null, ...extra,
  })

  function stubDirectory() {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      requests.push(url)
      if (url.searchParams.get('tag') === 'halloween') {
        return new Response(JSON.stringify([
          row('Cauldron', { clickcount: 900 }),
          row('Spooky Near', { clickcount: 5, geo_lat: 43.7, geo_long: -79.4 }),
          row('Insecure', { url_resolved: 'http://stream.invalid/x' }),
          row('Local FM', { clickcount: 50 }),
        ]))
      }
      return new Response(JSON.stringify([
        row('Local FM', { tags: 'news', geo_lat: 43.65, geo_long: -79.38 }),
        row('Classic Rock', { tags: 'rock', geo_lat: 43.66, geo_long: -79.39 }),
      ]))
    }))
    return requests
  }

  it('puts real Halloween streams first on Halloween, nearest then most played, locals after without repeats', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-10-31T19:00:00') })
    const requests = stubDirectory()
    const stations = await listLocalRadioStations(43.65, -79.38)
    expect(stations.map(station => station.name)).toEqual(['Spooky Near', 'Cauldron', 'Local FM', 'Classic Rock'])
    expect(stations[0].holiday).toBe('Halloween')
    expect(stations[1].distanceKm).toBe(Infinity)
    expect(stations[3].holiday).toBeUndefined()
    const tagSearch = requests.find(url => url.searchParams.get('tag'))!
    expect(tagSearch.searchParams.get('is_https')).toBe('true')
    expect(tagSearch.searchParams.get('hidebroken')).toBe('true')
  })

  it('plays the ordinary local stations on an ordinary day without a tag search', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-11-15T12:00:00') })
    const requests = stubDirectory()
    const stations = await listLocalRadioStations(43.65, -79.38)
    expect(stations.map(station => station.name)).toEqual(['Local FM', 'Classic Rock'])
    expect(requests.some(url => url.searchParams.has('tag'))).toBe(false)
  })
})
