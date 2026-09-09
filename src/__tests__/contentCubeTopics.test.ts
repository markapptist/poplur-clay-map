import { describe, expect, it } from 'vitest'
import {
  CONTENT_CUBE_DISPLAY_MS,
  contentCubeModel,
  topicForFeedChannel,
  topicForSpokenTour,
} from '../contentCubeTopics'
import { readFileSync } from 'node:fs'
import { MAP_TOUR_TOPICS } from '../mapTourPreferences'
import navigatorSprites from '../navigatorSprites.json'
import {
  emptyContentCubeSession,
  reconcileContentCubeSession,
} from '../contentCubeSession'

describe('what earns the cube', () => {
  it('reads the feed channel rather than guessing at a caption', () => {
    expect(topicForFeedChannel('sports')).toBe('sports')
    expect(topicForFeedChannel('news')).toBeNull()
    expect(topicForFeedChannel(undefined)).toBeNull()
  })

  // Read as source: importing FeedTwin pulls the whole component tree into a
  // node environment. The point is only that the id this maps on is real.
  it('is anchored to a channel that actually exists', () => {
    const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')
    expect(feed).toContain("id: 'sports'")
    expect(feed).toContain("id: 'food'")
  })

  it('reads the tour narration topic, which the app authored itself', () => {
    expect(topicForSpokenTour('sports')).toBe('sports')
    expect(topicForSpokenTour('landmarks')).toBeNull()
    expect(topicForSpokenTour(null)).toBeNull()
  })

  // The one signal this feature refuses. A station-name regex misses The Fan
  // 590, TSN 1050, talkSPORT and BBC Radio 5 Live, and false-positives on
  // "fan", "live" and "talk". If a future change makes a name the trigger,
  // this is the test that should stop it.
  it('never takes a station name as evidence', () => {
    for (const name of ['The Fan 590', 'TSN 1050', 'talkSPORT', 'Sports Radio 610']) {
      expect(topicForSpokenTour(name)).toBeNull()
      expect(topicForFeedChannel(name)).toBeNull()
    }
  })

  it('borrows the tour topic vocabulary instead of inventing one', () => {
    const tourTopics = MAP_TOUR_TOPICS.map(t => t.id)
    expect(tourTopics).toContain('sports')
    expect(tourTopics).toContain('food')
  })
})

describe('the model behind the topic', () => {
  it('gives sports the basketball, and it is a model that ships baked', () => {
    const model = contentCubeModel('sports')
    expect(model).toBe('poplur_cube_basketball.glb')
    // Unbaked, the cube is invisible on the sprite path the phones use.
    expect((navigatorSprites as Record<string, unknown[]>)[model!]?.length).toBeGreaterThan(0)
  })

  it('leaves food unwired until its triggers exist', () => {
    expect(contentCubeModel('food')).toBeNull()
  })
})

describe('the appearance is bounded', () => {
  it('holds for ten seconds and then hands the cube back', () => {
    const t0 = 1_000
    let decision = reconcileContentCubeSession(emptyContentCubeSession(), true, t0, CONTENT_CUBE_DISPLAY_MS)
    expect(decision.active).toBe(true)
    expect(decision.remainingMs).toBe(CONTENT_CUBE_DISPLAY_MS)
    decision = reconcileContentCubeSession(decision.session, true, t0 + CONTENT_CUBE_DISPLAY_MS, CONTENT_CUBE_DISPLAY_MS)
    expect(decision.active).toBe(false)
  })

  // Sitting inside the context must not re-trigger it every ten seconds — the
  // stuck-cube failure the weather cube's comment records.
  it('does not come back while you stay in the same context', () => {
    const t0 = 1_000
    let d = reconcileContentCubeSession(emptyContentCubeSession(), true, t0, CONTENT_CUBE_DISPLAY_MS)
    d = reconcileContentCubeSession(d.session, true, t0 + CONTENT_CUBE_DISPLAY_MS, CONTENT_CUBE_DISPLAY_MS)
    d = reconcileContentCubeSession(d.session, true, t0 + 60_000, CONTENT_CUBE_DISPLAY_MS)
    expect(d.active).toBe(false)
  })

  it('re-arms once you leave the context and come back', () => {
    const t0 = 1_000
    let d = reconcileContentCubeSession(emptyContentCubeSession(), true, t0, CONTENT_CUBE_DISPLAY_MS)
    d = reconcileContentCubeSession(d.session, true, t0 + CONTENT_CUBE_DISPLAY_MS, CONTENT_CUBE_DISPLAY_MS)
    d = reconcileContentCubeSession(d.session, false, t0 + 20_000, CONTENT_CUBE_DISPLAY_MS)
    d = reconcileContentCubeSession(d.session, true, t0 + 30_000, CONTENT_CUBE_DISPLAY_MS)
    expect(d.active).toBe(true)
  })

  it('is ten seconds, like the radio cube it sits beside', () => {
    expect(CONTENT_CUBE_DISPLAY_MS).toBe(10_000)
  })
})
