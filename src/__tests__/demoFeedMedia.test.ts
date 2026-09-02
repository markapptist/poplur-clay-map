import { afterEach, describe, expect, it } from 'vitest'
import {
  DEMO_CREATIVES,
  DEMO_PHOTOS,
  availableDemoPhotos,
  blendedDemoPostsForChannel,
  demoFeedEnabled,
  demoPhotosForChannel,
  demoPosterFile,
  demoPostsForChannel,
} from '../demoFeedMedia'
import { setLiveSimulationEnabled } from '../simulationControl'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// FeedTwin is read as source rather than imported: importing it pulls in the
// audio gate, which touches `window` at module scope. Same approach as
// sideControlIcons.test.ts, and it still catches channel-id drift.
const FEED_CHANNEL_IDS = new Set(
  [...readFileSync(resolve(__dirname, '../FeedTwin.tsx'), 'utf8')
    .matchAll(/\{\s*id:\s*'([a-z-]+)',\s*number:\s*\d+/g)].map(match => match[1]),
)

afterEach(() => setLiveSimulationEnabled(false))

const FOOD = { id: 'food', user: '@sauceboss', caption: 'late-night poutine run downtown' }

describe('demo creatives', () => {
  it('only names channels the Feed actually carries', () => {
    expect(FEED_CHANNEL_IDS.size).toBeGreaterThan(10)
    DEMO_CREATIVES.forEach(creative => {
      expect(FEED_CHANNEL_IDS.has(creative.channelId), `unknown channel ${creative.channelId}`).toBe(true)
    })
  })

  it('never fills the live channel, which carries real broadcasts only', () => {
    expect(DEMO_CREATIVES.some(creative => creative.channelId === 'live')).toBe(false)
  })

  it('keeps every creative id unique so counters stay stable per clip', () => {
    const ids = DEMO_CREATIVES.map(creative => creative.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('derives the poster from the clip stem', () => {
    expect(demoPosterFile('ad-food.mp4')).toBe('posters/ad-food.jpg')
  })
})

describe('demo feed posts', () => {
  it('marks every row demo and points at the packed creative', () => {
    const posts = demoPostsForChannel(FOOD, 1_800_000_000_000)
    expect(posts).toHaveLength(1)
    expect(posts[0].demo).toBe(true)
    expect(posts[0].video).toContain('ad-food.mp4')
    expect(posts[0].poster).toContain('posters/ad-food.jpg')
  })

  it('carries the native creative metadata through unchanged', () => {
    const [post] = demoPostsForChannel(FOOD)
    expect(post.place).toBe('Tokyo')
    expect(post.viewCount).toBe(1_010)
    expect(post.reachKm).toBe(135)
    expect(post.originLatitude).toBe(35.6762)
    expect(post.originLongitude).toBe(139.6503)
    expect(post.caption).toBe('Poplur Food is serving nearby')
  })

  it('derives counters from the creative id, not from the clock', () => {
    const first = demoPostsForChannel(FOOD, 1_800_000_000_000)
    const second = demoPostsForChannel(FOOD, 1_900_000_000_000)
    expect(first.map(p => p.likeCount)).toEqual(second.map(p => p.likeCount))
    expect(first[0].likeCount).toBeGreaterThan(0)
    expect(first[0].likeCount).toBeLessThan(first[0].viewCount)
  })

  it('returns the three Spanish creatives widest-reaching first', () => {
    const posts = demoPostsForChannel({ id: 'spanish', user: '@vibra.cdmx', caption: 'x' })
    expect(posts.map(post => post.place)).toEqual(['Mexico City', 'Madrid', 'Bogotá'])
    expect(posts[0].reachKm).toBeGreaterThanOrEqual(posts[1].reachKm)
    expect(posts[1].reachKm).toBeGreaterThanOrEqual(posts[2].reachKm)
  })

  it('leaves a channel with no creative genuinely empty', () => {
    expect(demoPostsForChannel({ id: 'live', user: '@you', caption: 'live' })).toEqual([])
    expect(demoPostsForChannel({ id: 'beauty', user: '@glowgetter', caption: 'x' })).toEqual([])
  })

  it('stays off until the workbench simulation is explicitly enabled', () => {
    expect(demoFeedEnabled()).toBe(false)
    setLiveSimulationEnabled(true)
    expect(demoFeedEnabled()).toBe(true)
  })
})

describe('photo card mapping', () => {
  it('maps every card onto a channel the Feed carries', () => {
    DEMO_PHOTOS.forEach(photo => {
      expect(FEED_CHANNEL_IDS.has(photo.channelId), `${photo.category} -> ${photo.channelId}`).toBe(true)
    })
  })

  it('covers all seventeen cards with unique ids and files', () => {
    expect(DEMO_PHOTOS).toHaveLength(17)
    expect(new Set(DEMO_PHOTOS.map(p => p.id)).size).toBe(17)
    expect(new Set(DEMO_PHOTOS.map(p => p.file)).size).toBe(17)
  })

  it('fills the channels the video creatives never reached', () => {
    const photoChannels = new Set(DEMO_PHOTOS.map(p => p.channelId))
    const videoChannels = new Set(DEMO_CREATIVES.map(c => c.channelId))
    expect([...photoChannels].filter(id => !videoChannels.has(id)).sort())
      .toEqual(['beauty', 'fashion', 'news', 'tech'])
  })

  it('never routes a card to the live channel', () => {
    expect(DEMO_PHOTOS.some(photo => photo.channelId === 'live')).toBe(false)
  })

  it('keeps the printed like count, which is burned into the artwork', () => {
    expect(DEMO_PHOTOS.find(p => p.category === 'SELFIES')?.likeCount).toBe(15_700)
    expect(DEMO_PHOTOS.find(p => p.category === 'WOMEN')?.likeCount).toBe(8_300)
  })

  it('shows no photo rows until a card file is actually present', () => {
    expect(availableDemoPhotos()).toEqual([])
    expect(demoPhotosForChannel({ id: 'sports', user: '@pitchside', caption: 'x' })).toEqual([])
  })

  it('falls back to videos alone while no card file exists', () => {
    const blended = blendedDemoPostsForChannel(
      { id: 'food', user: '@sauceboss', caption: 'x' },
      { photos: 50, videos: 50, ads: 0 },
    )
    expect(blended.every(post => post.mediaType === 'video')).toBe(true)
  })
})
