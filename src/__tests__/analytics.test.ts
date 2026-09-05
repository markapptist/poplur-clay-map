import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

type BridgeMessage = { type: string; name: string; params?: Record<string, unknown>; value?: unknown }

// A window shaped like the shell's WebView: a real event target (the simulation
// switch and the radius cache dispatch through it), a localStorage, and the
// Android-style PoplurNative bridge unless a test asks otherwise. `parent`
// points back at the window itself unless the test wants the map iframe.
function installWindow(options: { bridge?: 'android' | 'ios' | 'none'; iframe?: boolean } = {}) {
  const posted: BridgeMessage[] = []
  const store = new Map<string, string>()
  const target = new EventTarget()
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
  const bridge = options.bridge ?? 'android'
  if (bridge === 'android') {
    win.PoplurNative = { onEvent: (json: string) => { posted.push(JSON.parse(json) as BridgeMessage) } }
  } else if (bridge === 'ios') {
    win.webkit = { messageHandlers: { poplur: { postMessage: (message: BridgeMessage) => { posted.push(message) } } } }
  }
  win.parent = options.iframe ? {} : win
  vi.stubGlobal('window', win)
  return { posted, store }
}

beforeEach(() => {
  vi.resetModules()
  // DEV prints the would-be call when there is no shell; keep the run quiet.
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('analytics sanitiser', () => {
  it('accepts only GA4-shaped names and refuses the reserved prefixes', async () => {
    const { analyticsName } = await import('../analytics')
    expect(analyticsName('pop_view')).toBe('pop_view')
    expect(analyticsName('screen_view')).toBe('screen_view')
    expect(analyticsName('a'.repeat(40))).toBe('a'.repeat(40))
    expect(analyticsName('a'.repeat(41))).toBeNull()
    expect(analyticsName('Pop_view')).toBeNull()
    expect(analyticsName('1pop')).toBeNull()
    expect(analyticsName('_pop')).toBeNull()
    expect(analyticsName('pop-view')).toBeNull()
    expect(analyticsName('pop view')).toBeNull()
    expect(analyticsName('')).toBeNull()
    expect(analyticsName('firebase_pop')).toBeNull()
    expect(analyticsName('google_pop')).toBeNull()
    expect(analyticsName('ga_pop')).toBeNull()
    expect(analyticsName(undefined)).toBeNull()
    expect(analyticsName(42)).toBeNull()
  })

  it('coerces booleans to 1/0, passes finite numbers, trims strings to 100 and drops the rest', async () => {
    const { analyticsParams } = await import('../analytics')
    const long = 'x'.repeat(150)
    expect(analyticsParams({
      used_ai: true,
      has_caption: false,
      radius_km: 12.5,
      zero: 0,
      nan: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      nothing: null,
      missing: undefined,
      note: long,
      nested: { a: 1 } as unknown as string,
      list: [1, 2] as unknown as string,
      'Bad-Key': 'x',
      firebase_key: 'x',
    })).toEqual({
      used_ai: '1',
      has_caption: '0',
      radius_km: 12.5,
      zero: 0,
      note: 'x'.repeat(100),
    })
    expect(analyticsParams(undefined)).toEqual({})
  })

  it('keeps at most 25 params, in call order', async () => {
    const { analyticsParams } = await import('../analytics')
    const many: Record<string, number> = {}
    for (let i = 0; i < 30; i += 1) many[`p_${String(i).padStart(2, '0')}`] = i
    const shaped = analyticsParams(many)
    expect(Object.keys(shaped)).toHaveLength(25)
    expect(shaped.p_00).toBe(0)
    expect(shaped.p_24).toBe(24)
    expect(shaped).not.toHaveProperty('p_25')
  })
})

describe('analytics transport', () => {
  it('posts one analyticsEvent per track through the Android bridge, sanitised', async () => {
    const { posted } = installWindow()
    const { track } = await import('../analytics')
    expect(track('pop_engagement', { action: 'like', used_ai: true, skip: undefined })).toBe(true)
    expect(posted).toEqual([
      { type: 'analyticsEvent', name: 'pop_engagement', params: { action: 'like', used_ai: '1' } },
    ])
    expect(track('pop_view')).toBe(true)
    expect(posted[1]).toEqual({ type: 'analyticsEvent', name: 'pop_view', params: {} })
  })

  it('posts the same object shape through the iOS message handler', async () => {
    const { posted } = installWindow({ bridge: 'ios' })
    const { track, setAnalyticsUserProperty } = await import('../analytics')
    expect(track('screen_view', { screen_name: 'feed', screen_class: 'HomeTwin' })).toBe(true)
    expect(setAnalyticsUserProperty('simulation', false)).toBe(true)
    expect(posted).toEqual([
      { type: 'analyticsEvent', name: 'screen_view', params: { screen_name: 'feed', screen_class: 'HomeTwin' } },
      { type: 'analyticsUserProperty', name: 'simulation', value: '0' },
    ])
  })

  it('drops an invalid event name before it can reach a shell', async () => {
    const { posted } = installWindow()
    const { track, setAnalyticsUserProperty } = await import('../analytics')
    expect(track('firebase_pop')).toBe(false)
    expect(track('Pop View')).toBe(false)
    expect(setAnalyticsUserProperty('ga_flag', '1')).toBe(false)
    expect(posted).toEqual([])
  })

  it('is a no-op outside a native shell (browser preview, Test Center, headless)', async () => {
    const { posted } = installWindow({ bridge: 'none' })
    const { track, setAnalyticsUserProperty, initAnalytics } = await import('../analytics')
    expect(track('pop_view')).toBe(false)
    expect(setAnalyticsUserProperty('simulation', true)).toBe(false)
    initAnalytics()
    expect(posted).toEqual([])
  })

  it('never reports from the map iframe even though it shares the bridge', async () => {
    const { posted } = installWindow({ iframe: true })
    const { track, setAnalyticsUserProperty, initAnalytics } = await import('../analytics')
    expect(track('screen_view', { screen_name: 'map', screen_class: 'HomeTwin' })).toBe(false)
    expect(setAnalyticsUserProperty('simulation', true)).toBe(false)
    initAnalytics()
    expect(posted).toEqual([])
  })

  it('shapes user property values: booleans, numbers, null to clear, 36-character cap', async () => {
    const { posted } = installWindow()
    const { setAnalyticsUserProperty } = await import('../analytics')
    setAnalyticsUserProperty('simulation', true)
    setAnalyticsUserProperty('tier', 2)
    setAnalyticsUserProperty('tier', null)
    setAnalyticsUserProperty('label', 'y'.repeat(50))
    expect(posted.map(message => message.value)).toEqual(['1', '2', null, 'y'.repeat(36)])
  })

  it('survives a node import with no window at all', async () => {
    const { track, setAnalyticsUserProperty, initAnalytics } = await import('../analytics')
    expect(track('pop_view')).toBe(false)
    expect(setAnalyticsUserProperty('simulation', true)).toBe(false)
    expect(() => initAnalytics()).not.toThrow()
  })
})

describe('initAnalytics', () => {
  it('publishes the simulation user property once and keeps it current', async () => {
    const { posted } = installWindow()
    const { initAnalytics } = await import('../analytics')
    const { setLiveSimulationEnabled } = await import('../simulationControl')
    const teardown = initAnalytics()
    expect(posted).toEqual([{ type: 'analyticsUserProperty', name: 'simulation', value: '0' }])
    // A second init is a no-op: one owner, one subscription.
    initAnalytics()
    expect(posted).toHaveLength(1)
    setLiveSimulationEnabled(true)
    expect(posted[1]).toEqual({ type: 'analyticsUserProperty', name: 'simulation', value: '1' })
    setLiveSimulationEnabled(false)
    expect(posted[2]).toEqual({ type: 'analyticsUserProperty', name: 'simulation', value: '0' })
    teardown()
    setLiveSimulationEnabled(true)
    expect(posted).toHaveLength(3)
  })
})

describe('radius_change dedupe', () => {
  it('logs a changed non-zero total once, and treats the map-loading zero as a reload', async () => {
    const { posted } = installWindow()
    const { publishAccountRadiusKm } = await import('../accountRadius')
    const events = () => posted.filter(message => message.name === 'radius_change').map(message => message.params)
    publishAccountRadiusKm(0)     // poplur-map-loading reset, nothing cached
    expect(events()).toEqual([])
    publishAccountRadiusKm(12)    // first real total on a fresh install
    expect(events()).toEqual([{ radius_km: 12 }])
    publishAccountRadiusKm(12)    // the shell republishes the same number
    publishAccountRadiusKm(12)
    publishAccountRadiusKm(0)     // map reload
    publishAccountRadiusKm(12)    // its snapshot lands again
    expect(events()).toEqual([{ radius_km: 12 }])
    publishAccountRadiusKm(14.6)  // the account really grew
    expect(events()).toEqual([{ radius_km: 12 }, { radius_km: 15 }])
  })

  it('seeds its baseline from the cached total so a relaunch is not a change', async () => {
    const { posted, store } = installWindow()
    store.set('poplur.totalRadiusKm', '12')
    const { publishAccountRadiusKm } = await import('../accountRadius')
    publishAccountRadiusKm(0)
    publishAccountRadiusKm(12)
    expect(posted.filter(message => message.name === 'radius_change')).toEqual([])
    publishAccountRadiusKm(13)
    expect(posted.filter(message => message.name === 'radius_change').map(message => message.params))
      .toEqual([{ radius_km: 13 }])
  })

  it('still updates the cache and notifies reach consumers on every publish', async () => {
    const { store } = installWindow()
    const { publishAccountRadiusKm, readAccountRadiusKm } = await import('../accountRadius')
    const seen: number[] = []
    window.addEventListener('poplur-account-radius-change', event => {
      seen.push((event as CustomEvent<{ radiusKm: number }>).detail.radiusKm)
    })
    publishAccountRadiusKm(3)
    publishAccountRadiusKm(3)
    expect(store.get('poplur.totalRadiusKm')).toBe('3')
    expect(readAccountRadiusKm()).toBe(3)
    expect(seen).toEqual([3, 3])
  })
})

describe('pop_view and pop_engagement funnel', () => {
  beforeEach(() => {
    vi.doMock('../nativeAuth', () => ({
      authToken: () => 'token-for-test',
      requestAuthToken: () => {},
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          postId: 'abc', eventId: 'x', kind: 'like', applied: true, duplicate: false,
          radiusDeltaMeters: 0,
          counters: { radiusMeters: 0, organicRadiusMeters: 0, viewCount: 0, likeCount: 0, downvoteCount: 0, commentCount: 0 },
        },
      }),
    })))
  })

  it('logs pop_view only when the 30 s client fence lets a view through, and never the post id', async () => {
    const { posted } = installWindow()
    const { recordVisiblePostView } = await import('../feedEngagements')
    await recordVisiblePostView('firestore:post-abc-123', 1_000)
    await recordVisiblePostView('firestore:post-abc-123', 5_000)
    await recordVisiblePostView('firestore:post-abc-123', 31_001)
    const views = posted.filter(message => message.name === 'pop_view')
    expect(views).toEqual([
      { type: 'analyticsEvent', name: 'pop_view', params: {} },
      { type: 'analyticsEvent', name: 'pop_view', params: {} },
    ])
    expect(JSON.stringify(posted)).not.toContain('abc')
  })

  it('logs pop_engagement with the action only, and never for the view kind', async () => {
    const { posted } = installWindow()
    const { recordPostEngagement } = await import('../feedEngagements')
    await recordPostEngagement('post-abc-123', 'like')
    await recordPostEngagement('post-abc-123', 'dislike')
    await recordPostEngagement('post-abc-123', 'comment')
    await recordPostEngagement('post-abc-123', 'view')
    expect(posted.map(message => [message.name, message.params])).toEqual([
      ['pop_engagement', { action: 'like' }],
      ['pop_engagement', { action: 'dislike' }],
      ['pop_engagement', { action: 'comment' }],
    ])
    expect(JSON.stringify(posted)).not.toContain('abc')
    expect(JSON.stringify(posted)).not.toContain('evt_')
  })
})

// The hook sites, read as source. One owner per event, the agreed name at the
// agreed place, and nothing identifying in the argument list — the sanitiser
// shapes types, but only this contract keeps a post id or a caption out.
describe('analytics hook contract', () => {
  const HOOK_FILES = ['main.tsx', 'ViewHarness.tsx', 'feedEngagements.ts', 'PostComposer.tsx', 'accountRadius.ts', 'MailScreen.tsx']
  const ALLOWED_PARAM_KEYS = new Set(['screen_name', 'screen_class', 'action', 'kind', 'destination', 'radius_km', 'used_ai', 'has_caption'])
  // `_` is a word character, so \bcaption\b never matches the has_caption key.
  const IDENTIFYING = /postId|post\.id|\bid\b|otherId|threadId|clientMessageId|\bcaption\b|\btext\b|\buid\b|userId|handle|\blat\b|\blng\b|latitude|longitude|\bsrc\b|\burl\b|body|message/i

  function trackCalls(source: string): string[] {
    const calls: string[] = []
    const pattern = /\btrack\(/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      let depth = 1
      let index = match.index + match[0].length
      const start = index
      while (index < source.length && depth > 0) {
        const char = source[index]
        if (char === '(') depth += 1
        else if (char === ')') depth -= 1
        index += 1
      }
      calls.push(source.slice(start, index - 1))
    }
    return calls
  }

  it('is imported by exactly the six agreed owners (Phase B adds HomeTwin/ProfileTwin)', () => {
    const dir = new URL('../', import.meta.url)
    const importers = readdirSync(dir)
      .filter(name => /\.(ts|tsx)$/.test(name) && name !== 'analytics.ts')
      .filter(name => /from '\.\/analytics'/.test(readFileSync(new URL(name, dir), 'utf8')))
      .sort()
    expect(importers).toEqual([...HOOK_FILES].sort())
  })

  it('never passes anything identifying to track, and only the agreed param keys', () => {
    for (const file of HOOK_FILES) {
      const calls = trackCalls(read(file))
      if (file === 'main.tsx') {
        expect(calls).toEqual([])
        continue
      }
      expect(calls.length, file).toBeGreaterThan(0)
      for (const call of calls) {
        // has_caption is a boolean DERIVED from the caption; the caption itself
        // must not appear in any other form.
        const scrubbed = call.replace('has_caption: Boolean(caption.trim())', 'has_caption: <bool>')
        expect(scrubbed, `${file}: ${call}`).not.toMatch(IDENTIFYING)
        const paramsText = call.slice(call.indexOf(',') + 1)
        for (const [, key] of paramsText.matchAll(/(?:^|[{,\s])([a-z_]+)\s*:/g)) {
          expect(ALLOWED_PARAM_KEYS.has(key), `${file}: param ${key}`).toBe(true)
        }
      }
    }
  })

  it('initialises once from main.tsx right after the shell detection', () => {
    const source = read('main.tsx')
    expect(source.match(/initAnalytics\(\)/g)).toHaveLength(1)
    expect(source.indexOf('initAnalytics()')).toBeGreaterThan(source.indexOf("classList.add('tier-ios')"))
  })

  it('screen_view is owned by ViewHarness, keyed on the bounded activity screen', () => {
    const source = read('ViewHarness.tsx')
    expect(source).toContain("track('screen_view', { screen_name: visibleActivityScreen, screen_class: 'HomeTwin' })")
    expect(source).toContain('visibleActivityScreen === lastScreenViewRef.current) return')
    expect(source.indexOf("track('screen_view'")).toBeGreaterThan(source.indexOf('useTestActivityReporter(visibleActivityScreen)'))
    for (const file of ['HomeTwin.tsx', 'MapApp.tsx', 'FeedTwin.tsx', 'ProfileTwin.tsx']) {
      expect(read(file), file).not.toContain("'screen_view'")
    }
  })

  it('pop_view sits behind the 30 s fence and pop_engagement inside the single funnel', () => {
    const source = read('feedEngagements.ts')
    const fence = source.indexOf('now - previous < CLIENT_VIEW_MIN_MS) return Promise.resolve(null)')
    const view = source.indexOf("track('pop_view')")
    expect(fence).toBeGreaterThan(-1)
    expect(view).toBeGreaterThan(fence)
    expect(view).toBeLessThan(source.indexOf("recordPostEngagement(postId, 'view')"))
    expect(source).toContain("if (kind !== 'view') track('pop_engagement', { action: kind })")
    expect(source.match(/track\(/g)).toHaveLength(2)
    for (const file of ['FeedTwin.tsx', 'ProfileTwin.tsx']) {
      expect(read(file), file).not.toMatch(/track\('pop_/)
    }
  })

  it('pop_published fires only after a completed native upload, not in the browser-preview branch', () => {
    const source = read('PostComposer.tsx')
    const upload = source.indexOf('await uploadResult')
    const published = source.indexOf("track('pop_published'")
    const preview = source.indexOf('nothing was sent from this browser preview')
    expect(upload).toBeGreaterThan(-1)
    expect(published).toBeGreaterThan(upload)
    expect(published).toBeLessThan(preview)
    expect(source.match(/track\(/g)).toHaveLength(1)
    const [call] = trackCalls(source)
    expect(call).toContain('kind: media.kind')
    expect(call).toContain('destination,')
    expect(call).toContain('radius_km: publishedRadiusKm')
    expect(call).toContain('used_ai: usedAI')
    expect(call).toContain('has_caption: Boolean(caption.trim())')
  })

  it('radius_change is rounded and deduped in publishAccountRadiusKm', () => {
    const source = read('accountRadius.ts')
    expect(source).toContain("track('radius_change', { radius_km: Math.round(radiusKm) })")
    expect(source.match(/track\(/g)).toHaveLength(1)
    expect(source).toContain('if (radiusKm === 0 || radiusKm === analyticsRadiusKm) return')
  })

  it('dm_sent logs the two first-send dispatches and never the retry', () => {
    const source = read('MailScreen.tsx')
    expect(source.match(/track\('dm_sent'/g)).toHaveLength(2)
    expect(source).toContain("track('dm_sent', { kind })")
    expect(source).toContain("track('dm_sent', { kind: 'attachment' })")
    expect(source).toContain("sendText(stickerWire(stickerId), 'sticker')")
    expect(source).toContain("sendText(invitation, 'game_invite')")
    expect(source).toContain("sendText(shareWire(share), 'share')")
    const retryStart = source.indexOf('const retryMessage = useCallback(')
    const retryEnd = source.indexOf('if (activeThread) {', retryStart)
    expect(retryStart).toBeGreaterThan(-1)
    expect(retryEnd).toBeGreaterThan(retryStart)
    expect(source.slice(retryStart, retryEnd)).not.toContain('track(')
  })
})
