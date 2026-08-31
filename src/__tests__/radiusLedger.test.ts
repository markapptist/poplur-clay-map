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
  return values
}

describe('account Total Radius', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is zero without an owned post and ignores reactions to someone else’s post', () => {
    const storage = installStorage()
    expect(radiusKm()).toBe(0)
    expect(radiusStats().radiusKm).toBe(0)

    registerOwnedPost('video:mine')
    expect(radiusKm()).toBe(0)

    recordPostLike('video:someone-else')
    expect(radiusKm()).toBe(0)

    recordPostLike('video:mine')
    expect(radiusKm()).toBe(0)

    storage.set('poplur.totalRadiusKm', '6.5')
    expect(radiusKm()).toBe(6.5)
    expect(radiusStats().radiusKm).toBe(6.5)
  })
})
