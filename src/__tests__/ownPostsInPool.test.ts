import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  LIVE_FEED_FETCH_LIMIT,
  LIVE_FEED_POST_LIMIT,
  isSyntheticPostRow,
  mergeFeedDocuments,
  normalizeNativeFeedPosts,
  windowFeedDocuments,
} from '../nativeFeedPosts'
import { normalizeLiveMapDocuments } from '../mapLivePosts'

const doc = (id: string, data: Record<string, unknown> = {}) => ({ id, data: () => data })

/** Newest first, like the Firestore query: `count` posts starting at `newestMillis`. */
function series(prefix: string, count: number, newestMillis: number, data: Record<string, unknown>) {
  return Array.from({ length: count }, (_, index) => doc(`${prefix}-${index}`, {
    ...data,
    createdAtMillis: newestMillis - index,
  }))
}
const person = (count: number, newest: number, uid = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4') =>
  series(`${uid}-post`, count, newest, { userID: uid })
const simulation = (count: number, newest: number) =>
  series('post-sim', count, newest, { userID: 'sim-daily-0001', syntheticBeta: true, syntheticCohort: true })

describe('the shared post pool keeps the account\'s own posts', () => {
  it('folds own posts into the newest window without duplicates', () => {
    const merged = mergeFeedDocuments([doc('new-1'), doc('new-2')], [doc('new-2'), doc('old-mine')])
    expect(merged.map(d => d.id)).toEqual(['new-1', 'new-2', 'old-mine'])
  })

  it('subscribes to the account\'s own posts by uid alongside the newest window', () => {
    const src = readFileSync(new URL('../nativeFeedPosts.ts', import.meta.url), 'utf8')
    expect(src).toContain("where('userID', '==', uid)")
    expect(src).toContain('watchAccountForOwnPosts()')
  })

  it('still folds own posts back in when synthetic volume pushes them out of the fetch', () => {
    const latest = [...simulation(400, 10_000), ...person(20, 9_000)]
    const own = person(3, 1_000, 'me')
    const merged = mergeFeedDocuments(latest, own, 'me')
    expect(merged.filter(d => d.data().userID === 'me').map(d => d.id)).toEqual(own.map(d => d.id))
    expect(merged.filter(d => d.data().userID !== 'me' && !d.data().syntheticBeta)).toHaveLength(20)
  })
})

describe('the shared post pool windows people and the simulation separately', () => {
  it('keeps every one of 20 human posts under 400 newer synthetic posts', () => {
    const humans = person(20, 9_000)
    const latest = [...simulation(400, 10_000), ...humans]
    const pool = windowFeedDocuments(latest)
    expect(pool.filter(d => !d.data().syntheticBeta).map(d => d.id)).toEqual(humans.map(d => d.id))
    expect(pool.filter(d => d.data().syntheticBeta)).toHaveLength(LIVE_FEED_POST_LIMIT)
    // The newest of each population, in the order the query delivered them.
    expect(pool.slice(0, LIVE_FEED_POST_LIMIT).every(d => d.data().syntheticBeta)).toBe(true)
    expect(pool[pool.length - 1]?.id).toBe(humans[humans.length - 1]?.id)
  })

  it('gives people exactly the window they would have with no synthetic posts at all', () => {
    const humans = person(LIVE_FEED_POST_LIMIT + 5, 9_000)
    const alone = windowFeedDocuments(humans).map(d => d.id)
    const mixed = windowFeedDocuments([...simulation(300, 10_000), ...humans])
      .filter(d => !d.data().syntheticBeta).map(d => d.id)
    expect(alone).toEqual(humans.slice(0, LIVE_FEED_POST_LIMIT).map(d => d.id))
    expect(mixed).toEqual(alone)
  })

  it('never counts the account\'s own posts against either window', () => {
    const own = person(3, 100, 'me')
    const pool = windowFeedDocuments([...person(LIVE_FEED_POST_LIMIT, 9_000), ...own], 'me')
    expect(pool.filter(d => d.data().userID === 'me')).toHaveLength(3)
    expect(pool).toHaveLength(LIVE_FEED_POST_LIMIT + 3)
  })

  it('fetches wider than it emits, on both the Feed and the Map listener', () => {
    expect(LIVE_FEED_FETCH_LIMIT).toBeGreaterThanOrEqual(4 * LIVE_FEED_POST_LIMIT)
    const feed = readFileSync(new URL('../nativeFeedPosts.ts', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../mapLivePosts.ts', import.meta.url), 'utf8')
    expect(feed).toContain('limit(LIVE_FEED_FETCH_LIMIT)')
    expect(feed).not.toContain('limit(LIVE_FEED_POST_LIMIT)')
    expect(map).toContain('limit(LIVE_FEED_FETCH_LIMIT)')
    expect(map).toContain('windowFeedDocuments(documents, ownUid)')
  })

  it('windows the Map snapshot the same way', () => {
    const publicPost = (userID: string, createdAtMillis: number, synthetic = false) => ({
      userID, createdAtMillis, latitude: 43.6, longitude: -79.4, locationVisibility: 'approximate',
      mediaURL: 'https://cdn.example/p.jpg', radiusMeters: 2_500,
      ...(synthetic ? { syntheticBeta: true } : {}),
    })
    const documents = [
      ...Array.from({ length: 400 }, (_, i) => doc(`post-sim-${i}`, publicPost('sim-daily-0002', 10_000 - i, true))),
      ...Array.from({ length: 20 }, (_, i) => doc(`human-${i}`, publicPost('a1B2c3D4e5F6g7H8', 9_000 - i))),
    ]
    const pins = normalizeLiveMapDocuments(documents)
    expect(pins.filter(pin => !pin.syntheticCohort)).toHaveLength(20)
    expect(pins.filter(pin => pin.syntheticCohort)).toHaveLength(LIVE_FEED_POST_LIMIT)
  })

  it('windows a native forward the same way, own posts exempt', () => {
    const row = (id: string, ownerId: string, createdAtMillis: number, extra: Record<string, unknown> = {}) => ({
      id, ownerId, createdAtMillis, mediaURL: 'https://cdn.example/p.jpg', channelId: 'food', ...extra,
    })
    const posts = normalizeNativeFeedPosts({ posts: [
      ...Array.from({ length: 400 }, (_, i) => row(`sim-${i}`, 'sim-food-001', 10_000 - i, { syntheticBeta: true })),
      ...Array.from({ length: 20 }, (_, i) => row(`human-${i}`, 'a1B2c3D4e5F6g7H8', 9_000 - i)),
      ...Array.from({ length: 200 }, (_, i) => row(`crowd-${i}`, `crowd-${i}`, 8_000 - i)),
      row('mine-old', 'me', 1),
    ] }, { ownUid: 'me' })
    expect(posts.filter(post => post.syntheticCohort)).toHaveLength(LIVE_FEED_POST_LIMIT)
    const people = posts.filter(post => !post.syntheticCohort && post.ownerId !== 'me')
    expect(people).toHaveLength(LIVE_FEED_POST_LIMIT)
    expect(people.slice(0, 20).every(post => post.id.startsWith('human-'))).toBe(true)
    expect(posts[posts.length - 1]?.id).toBe('mine-old')
  })
})

describe('synthetic post classification mirrors functions/src/syntheticIdentity.ts', () => {
  it('recognises every way a simulation post announces itself', () => {
    expect(isSyntheticPostRow('p', { userID: 'sim-food-001' })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'sim-daily-20260915-03' })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'synthetic-conquer-red' })).toBe(true)
    expect(isSyntheticPostRow('p', { ownerId: 'sim-food-001' })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'a1B2', syntheticBeta: true })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'a1B2', syntheticCohort: true })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'a1B2', syntheticActorId: 'sim-food-001' })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'a1B2', syntheticSource: 'sim-daily' })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'a1B2', syntheticJourney: 'five-actor-live' })).toBe(true)
    expect(isSyntheticPostRow('p', { userID: 'a1B2', source: 'synthetic-browser' })).toBe(true)
    expect(isSyntheticPostRow('post-sim-1', { userID: 'a1B2' })).toBe(true)
    expect(isSyntheticPostRow('synthetic-1', { userID: 'a1B2' })).toBe(true)
    expect(isSyntheticPostRow('post-radius-lab-1', { userID: 'a1B2' })).toBe(true)
  })

  it('leaves people and official content alone', () => {
    expect(isSyntheticPostRow('abc123', { userID: 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4' })).toBe(false)
    expect(isSyntheticPostRow('abc123', { userID: 'a1B2', syntheticBeta: false, syntheticActorId: '', syntheticSource: '' })).toBe(false)
    expect(isSyntheticPostRow('abc123', { userID: 'a1B2', officialContent: true })).toBe(false)
    expect(isSyntheticPostRow('simple-id', { userID: 'simone' })).toBe(false)
  })
})
