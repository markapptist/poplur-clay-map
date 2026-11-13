import { afterEach, describe, expect, it, vi } from 'vitest'

// App Review 2.5.19 (13 Nov 2026): the iOS shell hides game-like pages,
// invented content and chance rewards. Android and the browser keep them.
const IOS_WINDOW = { webkit: { messageHandlers: { poplur: {} } } }

async function loadAs(win: object | null) {
  vi.unstubAllGlobals()
  vi.resetModules()
  if (win) vi.stubGlobal('window', { ...win, parent: undefined })
  const nav = await import('../retiredNavigationRoutes')
  const tour = await import('../mapTourPreferences')
  const pool = await import('../nativeFeedPosts')
  return { nav, tour, pool }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('iOS shell hides', () => {
  it('retires House, Trophies, TV Guide and Games only inside the iOS shell', async () => {
    const ios = await loadAs(IOS_WINDOW)
    for (const screen of ['profile-house', 'profile-trophies', 'feed-tvguide', 'feed-games']) {
      expect(ios.nav.isRetiredNavigationScreen(screen)).toBe(true)
    }
    expect(ios.nav.isRetiredNavigationScreen('map-conquer')).toBe(false)
    expect(ios.nav.isRetiredNavigationScreen('profile-wallet')).toBe(false)

    const web = await loadAs(null)
    expect(web.nav.isRetiredNavigationScreen('profile-house')).toBe(false)
    expect(web.nav.isRetiredNavigationScreen('feed-tvguide')).toBe(false)
  })

  it('offers no Casinos tour topic on iOS', async () => {
    const ios = await loadAs(IOS_WINDOW)
    expect(ios.tour.MAP_TOUR_TOPICS.some(topic => topic.id === 'casinos')).toBe(false)
    const web = await loadAs(null)
    expect(web.tour.MAP_TOUR_TOPICS.some(topic => topic.id === 'casinos')).toBe(true)
  })

  it('keeps no simulated posts in the iOS pool, and keeps people and own posts', async () => {
    const items = [
      { id: 'a', kind: 'synthetic' as const },
      { id: 'b', kind: 'person' as const },
      { id: 'c', kind: 'own' as const },
    ]
    const ios = await loadAs(IOS_WINDOW)
    expect(ios.pool.windowByPopulation(items, item => item.kind).map(item => item.id)).toEqual(['b', 'c'])
    const web = await loadAs(null)
    expect(web.pool.windowByPopulation(items, item => item.kind).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
})
