import { afterEach, describe, expect, it, vi } from 'vitest'
import { radiusKm, radiusStats, recordPostLike, registerOwnedPost } from '../radiusLedger'

function installStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
    dispatchEvent: vi.fn(),
  })
}

describe('account Total Radius', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is zero without an owned post and ignores reactions to someone else’s post', () => {
    installStorage()
    expect(radiusKm()).toBe(0)
    expect(radiusStats().radiusKm).toBe(0)

    registerOwnedPost('video:mine')
    expect(radiusKm()).toBe(41.8)

    recordPostLike('video:someone-else')
    expect(radiusKm()).toBe(41.8)

    recordPostLike('video:mine')
    expect(radiusKm()).toBe(42.8)
  })
})
