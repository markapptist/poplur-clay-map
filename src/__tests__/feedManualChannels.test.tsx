// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeedTwin from '../FeedTwin'

const store = vi.hoisted(() => ({ posts: [] as any[], listeners: new Set<() => void>() }))
vi.mock('../nativeFeedPosts', () => ({
  nativeFeedPostsSnapshot: () => store.posts,
  onNativeFeedPosts: (listener: () => void) => { store.listeners.add(listener); return () => store.listeners.delete(listener) },
  requestNativeFeedPosts: vi.fn(),
}))
vi.mock('../feedPostComments', () => ({ useFeedPostComments: () => [] }))
vi.mock('../feedEngagements', () => ({ recordPostEngagement: vi.fn(), recordVisiblePostView: vi.fn(() => () => {}) }))
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
  return <FeedTwin index={index} onIndexChange={setIndex} />
}
function channel() { return Number(host.querySelector('[data-test-channel]')?.getAttribute('data-test-channel')) }
function arrow(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  act(() => button.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, button: 0, bubbles: true })))
}

beforeEach(async () => {
  vi.useFakeTimers()
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
  it('steps to empty channels and back using the D-pad', () => {
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
