import { describe, expect, it } from 'vitest'
import {
  liveNewsEndpoint,
  liveNewsCameraFrame,
  newsTourEventsForSnapshot,
  parseLiveNewsCache,
  parseLiveNewsPayload,
  parseLiveNewsResponse,
  previewLiveNewsEvents,
  rankLiveNewsEvents,
  staleProviderStopsNewsTour,
  tourEligibleLiveNewsEvents,
  type LiveNewsEvent,
} from '../liveNews'

const NOW = Date.parse('2026-08-26T16:00:00.000Z')

function event(overrides: Partial<LiveNewsEvent> = {}): LiveNewsEvent {
  return {
    id: 'event-one',
    title: 'A verified event is happening downtown',
    summary: 'Two sources report the same live event in the provider-supplied area.',
    status: 'live',
    place: 'Toronto',
    country: 'Canada',
    coords: [-79.3832, 43.6532],
    scope: 'local',
    category: 'events',
    publishedAt: '2026-08-26T15:00:00.000Z',
    updatedAt: '2026-08-26T15:50:00.000Z',
    confidence: 0.93,
    sources: [
      { publisher: 'Source A', url: 'https://news.example/a', publishedAt: '2026-08-26T15:00:00.000Z' },
      { publisher: 'Source B', url: 'https://news.example/b', publishedAt: '2026-08-26T15:10:00.000Z' },
    ],
    media: [],
    ...overrides,
  }
}

describe('shared live news wire', () => {
  it('accepts sourced current records and de-duplicates canonical ids', () => {
    const older = event({ updatedAt: '2026-08-26T15:40:00.000Z', title: 'Older title' })
    const newer = event({ updatedAt: '2026-08-26T15:55:00.000Z', title: 'Latest title' })
    const parsed = parseLiveNewsPayload({ events: [older, newer] }, NOW)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.title).toBe('Latest title')
  })

  it('rejects unsafe, unsourced, stale, low-confidence and invented-coordinate records', () => {
    const candidates = [
      event({ id: 'http-source', sources: [{ publisher: 'Unsafe', url: 'http://news.example/a' }] }),
      event({ id: 'no-source', sources: [] }),
      event({ id: 'stale', updatedAt: '2026-08-01T15:00:00.000Z' }),
      event({ id: 'low-confidence', confidence: 0.2 }),
      event({ id: 'bad-coordinate', coords: [220, 95] }),
    ]
    expect(parseLiveNewsPayload(candidates, NOW)).toEqual([])
  })

  it.each([
    'https://user:secret@news.example/story',
    'https://localhost/story',
    'https://wire.local/story',
    'https://wire.internal/story',
    'https://0.0.0.1/story',
    'https://10.1.2.3/story',
    'https://127.0.0.1/story',
    'https://169.254.10.20/story',
    'https://172.16.4.2/story',
    'https://192.168.1.4/story',
    'https://224.0.0.1/story',
    'https://[::1]/story',
    'https://[::]/story',
    'https://[::ffff:7f00:1]/story',
    'https://[::ffff:127.0.0.1]/story',
    'https://[fc00::1]/story',
    'https://[fd12::1]/story',
    'https://[fe80::1]/story',
    'https://[fec0::1]/story',
    'https://[ff02::1]/story',
  ])('rejects a non-public source URL: %s', unsafeUrl => {
    expect(parseLiveNewsPayload([event({
      sources: [{ publisher: 'Unsafe', url: unsafeUrl }],
    })], NOW)).toEqual([])
  })

  it('validates endpoint overrides and permits loopback HTTP only in development', () => {
    expect(liveNewsEndpoint(undefined, false).protocol).toBe('https:')
    expect(liveNewsEndpoint('https://wire.example/live', false).toString()).toBe('https://wire.example/live')
    expect(liveNewsEndpoint('http://127.0.0.1:5001/live', true).toString()).toBe('http://127.0.0.1:5001/live')
    expect(liveNewsEndpoint('http://localhost:5001/live', true).hostname).toBe('localhost')
    expect(() => liveNewsEndpoint('http://127.0.0.1:5001/live', false)).toThrow(/HTTPS/)
    expect(() => liveNewsEndpoint('http://wire.example/live', true)).toThrow(/HTTPS/)
    expect(() => liveNewsEndpoint('https://localhost/live', true)).toThrow(/public HTTPS/)
    expect(() => liveNewsEndpoint('https://user:secret@wire.example/live', false)).toThrow(/invalid/)
  })

  it('preserves checkedAt and never turns an explicitly or chronologically stale wire fresh', () => {
    const recentCheckedAt = '2026-08-26T15:55:00.000Z'
    const oldCheckedAt = '2026-08-26T13:00:00.000Z'
    expect(parseLiveNewsResponse({
      events: [event()], generatedAt: recentCheckedAt, checkedAt: recentCheckedAt, stale: false,
    }, NOW)).toMatchObject({ checkedAt: recentCheckedAt, stale: false })
    expect(parseLiveNewsResponse({
      events: [event()], generatedAt: recentCheckedAt, checkedAt: recentCheckedAt, stale: true,
    }, NOW)).toMatchObject({ checkedAt: recentCheckedAt, stale: true })
    expect(parseLiveNewsResponse({
      events: [event()], generatedAt: oldCheckedAt, checkedAt: oldCheckedAt, stale: false,
    }, NOW)).toMatchObject({ checkedAt: oldCheckedAt, stale: true })
    expect(parseLiveNewsResponse({
      events: [event()], generatedAt: recentCheckedAt, checkedAt: recentCheckedAt, stale: 'false',
    }, NOW).stale).toBe(true)
    expect(parseLiveNewsResponse({
      events: [event()], generatedAt: recentCheckedAt, checkedAt: 'not-a-date', stale: false,
    }, NOW)).toMatchObject({ checkedAt: null, stale: true })
  })

  it('preserves backend staleness through a fresh local cache and expires old cache entries', () => {
    const recentCheckedAt = '2026-08-26T15:55:00.000Z'
    const cached = parseLiveNewsCache({
      storedAt: NOW - 60_000,
      generatedAt: recentCheckedAt,
      checkedAt: recentCheckedAt,
      stale: true,
      events: [event()],
    }, NOW)
    expect(cached).toMatchObject({ ageMs: 60_000, checkedAt: recentCheckedAt, stale: true })

    const chronologicallyStale = parseLiveNewsCache({
      storedAt: NOW - 60_000,
      generatedAt: '2026-08-26T13:00:00.000Z',
      checkedAt: '2026-08-26T13:00:00.000Z',
      stale: false,
      events: [event()],
    }, NOW)
    expect(chronologicallyStale?.stale).toBe(true)

    expect(parseLiveNewsCache({
      storedAt: NOW - 25 * 60 * 60_000,
      generatedAt: recentCheckedAt,
      checkedAt: recentCheckedAt,
      stale: false,
      events: [event()],
    }, NOW)).toBeNull()
  })

  it('keeps deterministic preview assets available without applying remote URL parsing', () => {
    const preview = previewLiveNewsEvents(NOW)
    expect(preview).toHaveLength(3)
    expect(preview.every(item => item.preview)).toBe(true)
    expect(preview.flatMap(item => item.media).every(item => item.rights === 'preview' && item.src.startsWith('/'))).toBe(true)
  })

  it('keeps an explicit Map News press interactive during empty or stale provider states', () => {
    const verified = event()
    expect(newsTourEventsForSnapshot({ events: [verified], stale: false }, NOW))
      .toEqual([verified])

    const emptyFallback = newsTourEventsForSnapshot({ events: [], stale: false }, NOW)
    expect(emptyFallback).toHaveLength(3)
    expect(emptyFallback.every(item => item.preview)).toBe(true)

    const staleFallback = newsTourEventsForSnapshot({ events: [verified], stale: true }, NOW)
    expect(staleFallback).toHaveLength(3)
    expect(staleFallback.every(item => item.preview)).toBe(true)
  })

  it('stops only a verified active tour when the provider becomes stale', () => {
    const verified = event()
    const preview = previewLiveNewsEvents(NOW)
    expect(staleProviderStopsNewsTour(false, true, [verified])).toBe(false)
    expect(staleProviderStopsNewsTour(true, false, [verified])).toBe(false)
    expect(staleProviderStopsNewsTour(true, true, preview)).toBe(false)
    expect(staleProviderStopsNewsTour(true, true, [verified])).toBe(true)
  })

  it('labels every deterministic fallback as simulated preview copy', () => {
    const preview = previewLiveNewsEvents(NOW)
    expect(preview.every(item => item.preview)).toBe(true)
    expect(preview.map(item => item.summary).join(' ')).not.toMatch(/a verified multi-source update/i)
  })

  it('drops media without an explicit publishable rights class', () => {
    const parsed = parseLiveNewsPayload([event({
      media: [{
        kind: 'photo',
        src: 'https://images.example/photo.jpg',
        credit: 'Unknown',
        sourceUrl: 'https://news.example/a',
        rights: 'preview',
      }],
    })], NOW)
    expect(parsed[0]?.media).toEqual([])
  })

  it('ranks breaking stories first and tours only recent corroborated events', () => {
    const top = event({ id: 'top', status: 'top' })
    const breaking = event({ id: 'breaking', status: 'breaking' })
    const weak = event({
      id: 'weak',
      status: 'breaking',
      confidence: 0.71,
      sources: [{ publisher: 'Source A', url: 'https://news.example/weak' }],
    })
    expect(rankLiveNewsEvents([top, breaking], NOW)[0]?.id).toBe('breaking')
    expect(tourEligibleLiveNewsEvents([top, breaking, weak], NOW).map(item => item.id))
      .toEqual(['breaking', 'top'])
  })

  it('frames a local event close enough to read without a landmark-scale crop', () => {
    expect(liveNewsCameraFrame(event())).toMatchObject({
      center: [-79.3832, 43.6532],
      zoom: 12.2,
      pitch: 54,
    })
    expect(liveNewsCameraFrame(event({ scope: 'global' })).zoom).toBe(3.1)
  })
})
