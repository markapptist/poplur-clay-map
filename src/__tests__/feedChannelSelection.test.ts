import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { autoTunedFeedChannelIndex, interceptingChannelIndexes, nextInterceptingChannelIndex } from '../feedChannelSelection'

const channels = [{ id: 'food' }, { id: 'music' }, { id: 'sports' }]

describe('feed channel selection', () => {
  it('prefers channels with posts that are currently reaching the viewer', () => {
    const posts = [
      { id: 'food-near', channelId: 'food', radiusMeters: 1_000, createdAtMillis: 1 },
      { id: 'music-zero', channelId: 'music', radiusMeters: 0, createdAtMillis: 2 },
      { id: 'sports-near', channelId: 'sports', radiusMeters: 3_000, createdAtMillis: 3 },
    ]
    expect(interceptingChannelIndexes(channels, posts)).toEqual([0, 2])
  })

  it('rotates to a different eligible channel when Feed is entered again', () => {
    const posts = [
      { id: 'food', channelId: 'food', radiusMeters: 1_000, createdAtMillis: 1 },
      { id: 'music', channelId: 'music', radiusMeters: 1_000, createdAtMillis: 2 },
    ]
    const next = nextInterceptingChannelIndex(channels, posts, 0, 5)
    expect([0, 1]).toContain(next)
    expect(next).not.toBe(0)
  })
})

// The App Review demo account, 14 Oct 2026: the Feed opened on CH 110 French,
// empty, while CH 108 Tech and CH 113 Cartoon held posts reaching the viewer.
// The catalogue below is the real channel order; the posts arrive late.
const catalogue = ['food', 'live', 'beauty', 'sports', 'modelling', 'fashion', 'music', 'tech', 'news',
  'french', 'spanish', 'shopping', 'cartoon', 'kids', 'comedy'].map(id => ({ id }))
const TECH = catalogue.findIndex(channel => channel.id === 'tech')
const CARTOON = catalogue.findIndex(channel => channel.id === 'cartoon')
const FRENCH = catalogue.findIndex(channel => channel.id === 'french')
const post = (id: string, channelId: string) => ({ id, channelId, createdAtMillis: 1 })

/** Home's ownership of the dial, as HomeTwin's two effects run it: entry
 *  takes the dial, every later input retunes only while Home still owns it,
 *  and a deliberate pick releases it. */
function feedDial(start: number) {
  let index = start
  let owned: number | null = null
  let visit = 0
  return {
    get index() { return index },
    enter(reaching: ReturnType<typeof post>[]) {
      visit += 1
      index = autoTunedFeedChannelIndex(catalogue, reaching, index, visit, true)
      owned = index
    },
    arrive(reaching: ReturnType<typeof post>[]) {
      if (!reaching.length || owned !== index) return
      index = autoTunedFeedChannelIndex(catalogue, reaching, index, visit, false)
      owned = index
    },
    pick(next: number) { owned = null; index = next },
  }
}

describe('Feed auto-tune with late-arriving posts', () => {
  it('leaves an empty channel for a filled one when the posts land after the Feed opened', () => {
    const dial = feedDial(0)
    dial.enter([])                                   // native bridge has not answered yet
    dial.arrive([post('own-tech', 'tech')])          // first batch: your own pop
    expect(dial.index).toBe(TECH)
    // The world-radius @poplur posts follow once the location fix lands. Tech is
    // already showing something, so the dial is not pulled away from it.
    dial.arrive([post('own-tech', 'tech'), post('poplur-cartoon', 'cartoon'), post('poplur-tech', 'tech')])
    expect(dial.index).toBe(TECH)
  })

  it('keeps retuning while every arrival still leaves the channel empty', () => {
    // Posts were in the snapshot but none reached yet (no fix, no account):
    // the arrival had nothing to choose from. An input that still reaches
    // nothing leaves the tune pending instead of spending it, and the late
    // fix that makes Cartoon reach is what finally tunes.
    const dial = feedDial(FRENCH)
    dial.enter([])
    const standing = dial.index
    dial.arrive([])
    expect(dial.index).toBe(standing)
    dial.arrive([post('poplur-cartoon', 'cartoon')])
    expect(dial.index).toBe(CARTOON)
  })

  it('never lands on a channel without a reaching post once one exists', () => {
    for (let start = 0; start < catalogue.length; start += 1) {
      const dial = feedDial(start)
      dial.enter([post('tech-1', 'tech'), post('cartoon-1', 'cartoon')])
      expect([TECH, CARTOON]).toContain(dial.index)
    }
  })

  it('does not override a channel the viewer picked', () => {
    const dial = feedDial(0)
    dial.enter([])
    dial.pick(FRENCH)
    dial.arrive([post('poplur-tech', 'tech')])
    expect(dial.index).toBe(FRENCH)
  })

  it('counts a zero-radius pop of your own, which the reach test already let through', () => {
    // interceptingChannelIndexes drops radius-0 rows and then falls back to the
    // whole catalogue; the auto-tune input is already reach-filtered.
    const reaching = [{ ...post('own-decayed', 'cartoon'), radiusMeters: 0 }]
    expect(autoTunedFeedChannelIndex(catalogue, reaching, FRENCH, 1, true)).toBe(CARTOON)
  })
})

describe('HomeTwin wiring', () => {
  const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')

  it('measures reach from the Feed\'s own viewer fix and retunes on late fix/account', () => {
    expect(home).toContain('feedPostReachesViewer(post, viewer)')
    expect(home).toMatch(/const viewer = currentViewerCoords\(\)\s+return posts\.filter/)
    expect(home).toContain('autoTunedFeedChannelIndex(CHANNELS, reaching, current, visit, false)')
    expect(home).toMatch(/\[activeTab, interceptingFeedPosts, feedPostsReachingViewer, liveSimulationForTune, accountUidForTune, blockedUsersForTune, viewerFixRevision\]/)
  })

  it('reads 0, not the account total, under POST RADIUS when the Feed has no playing post', () => {
    expect(home).toMatch(/: activeTab === 'feed'\s+\? feedReachKm \?\? 0/)
  })
})
