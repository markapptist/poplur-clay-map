// @vitest-environment happy-dom
import { Storage } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const key = 'poplur.seenPosts.v1'
beforeEach(() => { vi.stubGlobal('localStorage', new Storage()) })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('clears a map badge when the sibling Feed document opens that same post', async () => {
  const seen = await import('../seenPosts')
  expect(seen.isPostSeen('new')).toBe(false)
  const changed = vi.fn()
  const off = seen.onSeenPostsChange(changed)
  window.localStorage.setItem(key, '["new"]')
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: '["new"]', storageArea: window.localStorage }))
  expect(seen.isPostSeen('new')).toBe(true)
  expect(seen.isPostSeen('unopened')).toBe(false)
  expect(changed).toHaveBeenCalledOnce()
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: '["new"]', storageArea: window.localStorage }))
  expect(changed).toHaveBeenCalledOnce()
  off()
})
it('preserves sibling writes when opening another post before its storage event arrives', async () => {
  const seen = await import('../seenPosts')
  seen.seenPostsSnapshot()
  window.localStorage.setItem(key, '["feed-post"]')
  seen.markPostsSeen(['map-post'])
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(['feed-post', 'map-post'])
})
