import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  normalizeSimulationFeed,
  simulationPlaceCoordinates,
  unseenSimulationEngagements,
} from '../betaSyntheticCohort'

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('closed-beta synthetic cohort', () => {
  it('accepts only labelled event fields and derives coordinates from a coarse place', () => {
    const feed = normalizeSimulationFeed({
      enabled: true,
      events: [{
        eventId: 'sim-food-001:42',
        actorId: 'sim-food-001',
        actor: 'SIM · @sauceboss',
        kind: 'like',
        place: 'Toronto region',
        radiusKm: 6.4,
        eventAtMs: 100_000,
        coords: [12.3, 45.6],
      }],
    })

    expect(feed.events).toHaveLength(1)
    expect(feed.latestEventAtMs).toBe(100_000)
    expect(feed.events[0]).not.toHaveProperty('coords')
    expect(simulationPlaceCoordinates(feed.events[0].place)).toEqual([-79.3832, 43.6532])
    expect(simulationPlaceCoordinates('World beta region')).toBeUndefined()
  })

  it('orders fresh events and never returns a stable event ID twice', () => {
    const feed = normalizeSimulationFeed({
      enabled: true,
      events: [
        { eventId: 'newer', actorId: 'sim-news-005', actor: 'SIM · @citydesk', kind: 'view', place: 'New York', radiusKm: 12, eventAtMs: 99_000 },
        { eventId: 'older', actorId: 'sim-food-001', actor: 'SIM · @sauceboss', kind: 'comment', place: 'Toronto', radiusKm: 7, eventAtMs: 98_000 },
        { eventId: 'stale', actorId: 'sim-tech-004', actor: 'SIM · @shipit', kind: 'like', place: 'London', radiusKm: 2, eventAtMs: 1_000 },
      ],
    })

    const first = unseenSimulationEngagements(feed, new Set(), 100_000)
    expect(first.map(event => event.eventId)).toEqual(['older', 'newer'])
    expect(unseenSimulationEngagements(feed, new Set(['older', 'newer']), 100_000)).toEqual([])
    expect(unseenSimulationEngagements({ ...feed, enabled: false }, new Set(), 100_000)).toEqual([])
  })

  it('delivers radius movement through the app without inventing a new notice verb', () => {
    const feed = normalizeSimulationFeed({
      enabled: true,
      events: [{ eventId: 'radius-1', actorId: 'sim-sports-002', actor: 'SIM · @pitchside', kind: 'radius-up', place: 'London', radiusKm: 18.4, eventAtMs: 100_000 }],
    })
    expect(feed.events).toMatchObject([{ eventId: 'radius-1', kind: 'view', radiusKm: 18.4 }])
    expect(unseenSimulationEngagements(feed, new Set(), 100_000)).toHaveLength(1)
  })

  it('uses one authenticated visible feed instead of local demo generators', () => {
    const activity = source('testActivity.ts')
    const home = source('HomeTwin.tsx')
    const map = source('MapApp.tsx')

    expect(activity).toContain("action: 'simulationFeed'")
    expect(activity).toContain('afterEventAtMs')
    expect(activity).toContain('rememberSimulationCursor(uid, feed.latestEventAtMs)')
    expect(activity).toContain('SIMULATION_FEED_REFRESH_MS = 15_000')
    expect(activity).toContain('document.hidden || !accountSnapshot().authenticated')
    expect(activity).toContain('window.parent !== window')
    expect(home).not.toContain('startEngagementChips(')
    expect(map).toContain('demo: false,')
  })

  it('keeps tester consent explicit, account-owned and narrowly disclosed', () => {
    const settings = source('SettingsScreen.tsx')

    expect(settings).toContain('<b>Share closed-beta activity</b>')
    expect(settings).toContain('off by default and belongs only to this signed-in account')
    expect(settings).toContain('up to 14 days')
    expect(settings).toContain('never includes message text, media, precise coordinates, microphone or camera data')
    expect(settings).toContain('await setTestActivityConsent(next)')
  })
})
