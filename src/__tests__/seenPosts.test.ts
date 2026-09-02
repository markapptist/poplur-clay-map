import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('seen pops', () => {
  beforeEach(() => {
    vi.resetModules()
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    } })
  })

  it('is new until opened, on either surface', async () => {
    const m = await import('../seenPosts')
    expect(m.isPostSeen('abc')).toBe(false)
    expect(m.markPostsSeen([m.feedPostIdFromPinId('firestore:abc')])).toBe(true)
    expect(m.isPostSeen('abc')).toBe(true)
    // Marking again is a no-op and says so, so listeners are not woken.
    expect(m.markPostsSeen(['abc'])).toBe(false)
  })

  it('hands useSyncExternalStore a new snapshot only when something changed', async () => {
    const m = await import('../seenPosts')
    const before = m.seenPostsSnapshot()
    m.markPostsSeen([])
    expect(m.seenPostsSnapshot()).toBe(before)
    const fired = vi.fn()
    m.onSeenPostsChange(fired)
    m.markPostsSeen(['x'])
    expect(fired).toHaveBeenCalledTimes(1)
    expect(m.seenPostsSnapshot()).not.toBe(before)
  })

  it('survives a reload and stays bounded', async () => {
    let m = await import('../seenPosts')
    m.markPostsSeen(Array.from({ length: 2_100 }, (_, i) => `p${i}`))
    vi.resetModules()
    m = await import('../seenPosts')
    expect(m.isPostSeen('p2099')).toBe(true)
    expect(m.isPostSeen('p0')).toBe(false)
    expect(m.seenPostsSnapshot().size).toBe(2_000)
  })
})
