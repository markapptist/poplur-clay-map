// @vitest-environment happy-dom
import React, { act, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeFeedPost } from '../nativeFeedPosts'
import ProfileTwin from '../ProfileTwin'

const store = vi.hoisted(() => ({ posts: [] as NativeFeedPost[], listeners: new Set<() => void>() }))
vi.mock('../nativeFeedPosts', () => ({
  nativeFeedPostsSnapshot: () => store.posts,
  onNativeFeedPosts: (listener: () => void) => { store.listeners.add(listener); return () => store.listeners.delete(listener) },
  requestNativeFeedPosts: vi.fn(),
}))
vi.mock('firebase/firestore', async original => ({
  ...await original<typeof import('firebase/firestore')>(), onSnapshot: vi.fn(() => () => {}),
}))
vi.mock('../feedEngagements', () => ({ recordPostEngagement: vi.fn(), recordVisiblePostView: vi.fn(() => () => {}) }))

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); store.listeners.clear() })

it('keeps a populated Profile mounted when posters are already cached, including a realtime refresh', async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  store.posts = Array.from({ length: 6 }, (_, i) => ({
    id: `cached-post-${i}`, ownerId: 'fixture-owner', username: '@fixture',
    mediaType: 'photo', mediaURL: `https://example.invalid/cached-${i}.webp`,
    channelId: 'food', createdAtMillis: i, locationVisibility: 'hidden',
  }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  let commits = 0
  try {
    await act(async () => root.render(<Profiler id="profile" onRender={() => { commits++ }}>
      <ProfileTwin viewUser="@fixture" viewUserId="fixture-owner" />
    </Profiler>))
    expect(host.querySelector('[data-poplur-screen="profile"]')).not.toBeNull()
    expect(host.querySelectorAll('img[src^="https://example.invalid/cached-"]')).toHaveLength(6)
    await act(async () => {
      store.posts = store.posts.map(post => ({ ...post, likeCount: 1 }))
      store.listeners.forEach(listener => listener())
      vi.advanceTimersByTime(1_000)
    })
    expect(host.querySelector('[data-poplur-screen="profile"]')).not.toBeNull()
    expect(commits).toBeLessThan(15)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
