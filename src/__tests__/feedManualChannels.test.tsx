// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeedTwin from '../FeedTwin'
import { setUserMuted } from '../audioGate'
import { isPostSeen } from '../seenPosts'

const store = vi.hoisted(() => ({ posts: [] as any[], listeners: new Set<() => void>() }))
vi.mock('../nativeFeedPosts', () => ({
  nativeFeedPostsSnapshot: () => store.posts,
  onNativeFeedPosts: (listener: () => void) => { store.listeners.add(listener); return () => store.listeners.delete(listener) },
  requestNativeFeedPosts: vi.fn(),
}))
vi.mock('../feedPostComments', () => ({ useFeedPostComments: () => [] }))
vi.mock('../feedEngagements', () => ({ recordPostEngagement: vi.fn(), recordVisiblePostView: vi.fn(async () => undefined) }))
vi.mock('firebase/firestore', async original => ({
  ...await original<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(() => () => {}),
}))
// Exercise Feed's real channel setter while the wheel animation is tested
// separately in the browser. The D-pad below is the actual production cluster.
vi.mock('../FeedChannelRail', () => ({
  default: ({ activeIndex, onPick }: { activeIndex: number; onPick: (index: number) => void }) =>
    <div data-test-channel={activeIndex}><button onClick={() => onPick(6)}>Select Music on dial</button></div>,
}))

let root: Root
let host: HTMLDivElement
function Harness() {
  const [index, setIndex] = useState(0)
  return <FeedTwin index={index} onIndexChange={setIndex} autoPlayOnMount />
}
function channel() { return Number(host.querySelector('[data-test-channel]')?.getAttribute('data-test-channel')) }
function arrow(label: string) {
  const dock = host.querySelector('[data-poplur-gesture-navigation]')!
  act(() => dock.dispatchEvent(new KeyboardEvent('keydown', { key: label === 'Channel up' ? 'ArrowUp' : 'ArrowDown', bubbles: true })))
}

beforeEach(async () => {
  window.localStorage?.removeItem('poplur.feed.muted')
  setUserMuted(false)
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  // happy-dom omits the constructor constants that browsers expose.
  Object.assign(HTMLMediaElement, { HAVE_NOTHING: 0, HAVE_CURRENT_DATA: 2, NETWORK_EMPTY: 0 })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store.posts = [{ id: 'only-food-post', channelId: 'food', username: '@fixture', mediaURL: 'https://example.invalid/food.webp', mediaType: 'photo',
    radiusMeters: 6_371_000, createdAtMillis: Date.now(), locationVisibility: 'approximate', originLatitude: 43.6487, originLongitude: -79.3811 }]
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Harness />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); store.listeners.clear(); vi.restoreAllMocks(); vi.useRealTimers()
})

describe('manual Feed tuning with one populated channel', () => {
  it('marks only the displayed post seen and keeps other arriving pins NEW', async () => {
    await act(async () => {
      store.posts = ['arrival-displayed', 'arrival-unopened'].map(id => ({ ...store.posts[0], id }))
      store.listeners.forEach(listener => listener())
    })
    const displayed = host.querySelector('[data-feed-post-id]')!.getAttribute('data-feed-post-id')!
    expect(isPostSeen(displayed)).toBe(true)
    const unopened = store.posts.find(post => post.id !== displayed)!
    expect(isPostSeen(unopened.id)).toBe(false)
  })
  it('keeps background arrivals NEW until Feed is in front', async () => {
    await act(async () => root.render(<FeedTwin index={0} frontMost={false} />))
    await act(async () => {
      store.posts = [{ ...store.posts[0], id: 'arrival-background' }]
      store.listeners.forEach(listener => listener())
    })
    expect(isPostSeen('arrival-background')).toBe(false)
    await act(async () => root.render(<FeedTwin index={0} frontMost />))
    expect(isPostSeen('arrival-background')).toBe(true)
  })
  it('automatically tunes through active channels after an unlimited photo, with static between channels', async () => {
    await act(async () => {
      store.posts = [
        { ...store.posts[0], id: 'food', radiusMeters: 6_371_000 },
        { ...store.posts[0], id: 'music', channelId: 'music', radiusMeters: 6_370_000 },
        { ...store.posts[0], id: 'sports', channelId: 'sports', radiusMeters: 6_369_000 },
      ]
      store.listeners.forEach(listener => listener())
    })
    const ready = () => host.querySelector('img[data-feed-media]')!.dispatchEvent(new Event('load'))
    await act(async () => ready())
    await act(async () => vi.advanceTimersByTime(12_000))
    expect(channel()).toBe(6)
    expect(host.querySelector('[data-channel-tuning="true"]')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(250))
    expect(host.querySelector('[data-channel-tuning="true"]')).toBeNull()
    await act(async () => ready())
    await act(async () => vi.advanceTimersByTime(12_000))
    expect(channel()).toBe(3)
  })

  it('parks a photo countdown in the native background and resumes its remaining time', async () => {
    await act(async () => host.querySelector('img[data-feed-media]')!.dispatchEvent(new Event('load')))
    await act(async () => vi.advanceTimersByTime(4_000))
    await act(async () => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: false } })))
    const before = host.querySelector('img[data-feed-media]')
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(host.querySelector('img[data-feed-media]')).toBe(before)
    await act(async () => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: true } })))
    await act(async () => vi.advanceTimersByTime(8_000))
    expect(host.querySelector('img[data-feed-media]')).not.toBe(before)
  })

  it('steps to empty channels and back using gesture navigation keyboard controls', () => {
    expect(channel()).toBe(0)
    arrow('Channel up')
    expect(channel()).toBe(1)
    expect(host.textContent).toContain('No posts in this channel')
    arrow('Channel down')
    expect(channel()).toBe(0)
  })

  it('keeps a direct dial selection after posts and location refresh', async () => {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent === 'Select Music on dial')!
    act(() => button.click())
    expect(channel()).toBe(6)
    await act(async () => {
      store.posts = store.posts.map(post => ({ ...post, viewCount: 5 }))
      store.listeners.forEach(listener => listener())
      window.dispatchEvent(new CustomEvent('poplur-native-location'))
    })
    expect(channel()).toBe(6)
    expect(host.textContent).toContain('No posts in this channel')
  })
})

// Use the real Feed component so a play promise cannot silently consume its
// decoder recovery budget before the first timeupdate arrives.
describe('Feed startup and interruption recovery', () => {
  async function mountVideo() {
    await act(async () => {
      store.posts = [{ ...store.posts[0], id: 'fixture-video', mediaType: 'video',
        mediaURL: 'https://example.invalid/clip.mp4', posterURL: 'https://example.invalid/poster.jpg' }]
      store.listeners.forEach(listener => listener())
    })
    return host.querySelector<HTMLVideoElement>('video[data-feed-media]')!
  }
  it('starts a newly granted decoder with sound without a video tap', async () => {
    const video = await mountVideo()
    expect(video).not.toBeNull()
    expect(video.muted).toBe(false)
    expect(host.querySelector('button[aria-label="Mute feed video"]')).not.toBeNull()
  })
  it('replays the only video after completion without remounting Feed', async () => {
    const video = await mountVideo()
    const feed = host.querySelector('[data-poplur-screen="feed"]')
    await act(async () => video.dispatchEvent(new Event('ended')))
    expect(host.querySelector('[data-poplur-screen="feed"]')).toBe(feed)
    expect(host.querySelector('video[data-feed-media]')).not.toBe(video)
    expect(host.querySelector('video[data-feed-media]')).not.toBeNull()
  })
  it('keeps Feed audible when Map audio is muted', async () => {
    await act(async () => setUserMuted(true))
    const video = await mountVideo()
    expect(video.muted).toBe(false)
    await act(async () => { setUserMuted(false); setUserMuted(true) })
    expect(video.muted).toBe(false)
  })
  it('unmutes the video from the sound button without requiring a second tap', async () => {
    const video = await mountVideo()
    let button = host.querySelector<HTMLButtonElement>('button[aria-label="Unmute feed video"]')
    if (!button) {
      const mute = host.querySelector<HTMLButtonElement>('button[aria-label="Mute feed video"]')!
      await act(async () => mute.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, button: 0, bubbles: true })))
      button = host.querySelector<HTMLButtonElement>('button[aria-label="Unmute feed video"]')
    }
    expect(button).toBeTruthy()
    await act(async () => button!.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, button: 0, bubbles: true })))
    expect(video.muted).toBe(false)
  })
  it('keeps an interrupted play request on its original source', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('new load', 'AbortError'))
    const video = await mountVideo()
    expect(video).not.toBeNull()
    await act(async () => { video.dispatchEvent(new Event('waiting')); await Promise.resolve() })
    expect(host.querySelector('video[data-feed-media]')).toBe(video)
    expect(host.textContent).not.toContain('Video couldn’t start')
  })
  it('does not reload a healthy late first frame', async () => {
    const video = await mountVideo()
    const loads = vi.mocked(HTMLMediaElement.prototype.load)
    loads.mockClear()
    await act(async () => vi.advanceTimersByTime(5_500))
    expect(loads).not.toHaveBeenCalled()
    Object.defineProperties(video, { paused: { configurable: true, value: false }, readyState: { configurable: true, value: 4 }, currentTime: { configurable: true, value: 0.01 } })
    await act(async () => video.dispatchEvent(new Event('playing')))
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(loads).not.toHaveBeenCalled()
    expect(host.querySelector('video[data-feed-media]')).toBe(video)
  })
  it('resumes an unexpected foreground pause but not a covered Feed', async () => {
    const video = await mountVideo()
    const play = vi.mocked(HTMLMediaElement.prototype.play); play.mockClear()
    await act(async () => video.dispatchEvent(new Event('pause')))
    await act(async () => vi.advanceTimersByTime(200))
    expect(play).toHaveBeenCalled()
    await act(async () => root.render(<FeedTwin index={0} frontMost={false} />))
    play.mockClear()
    await act(async () => vi.advanceTimersByTime(10_000))
    expect(play).not.toHaveBeenCalled()
  })
})
