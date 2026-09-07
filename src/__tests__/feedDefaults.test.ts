import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFeedCommentsAtEnd, writeFeedCommentsAtEnd } from '../feedPreferences'
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } })
})
afterEach(() => vi.unstubAllGlobals())
it('defaults comments on, then preserves an explicit off choice', () => {
  expect(readFeedCommentsAtEnd()).toBe(true)
  writeFeedCommentsAtEnd(false)
  expect(readFeedCommentsAtEnd()).toBe(false)
})
it('corrects an old persisted default once', () => {
  window.localStorage.setItem('poplur.feedCommentsAtEnd', '0')
  expect(readFeedCommentsAtEnd()).toBe(true)
  writeFeedCommentsAtEnd(false)
  expect(readFeedCommentsAtEnd()).toBe(false)
})
