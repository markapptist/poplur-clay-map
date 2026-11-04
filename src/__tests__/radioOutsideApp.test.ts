// @vitest-environment happy-dom
// A5: "Radio outside app" on Android. The page keeps an outside-scope station
// through backgrounding; Android's notification Stop reaches it as
// `poplurRadioStop`; a station the listener muted stays muted when they leave;
// and Android keeps Poplur running on the same rule iOS does.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRadioPlaybackState, isMapRadioActive, nowPlayingStation, readRadioScope, startDefaultMapRadio, stopMapRadio } from '../mapRadio'
import { setUserMuted } from '../audioGate'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function stubRadio(scope: 'screen' | 'app' | 'outside') {
  const values = new Map<string, string>([
    ['poplur.radio.scope', scope],
    ['poplur.radio.background', scope === 'screen' ? '0' : '1'],
    ['poplur.radio.scope.explicit.v1', '1'],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input)
    if (!url.pathname.endsWith('/search')) return new Response('{}')
    return new Response(JSON.stringify([{ stationuuid: 'outside-1', name: 'Local One', url_resolved: 'https://station.invalid/1',
      codec: 'AAC', lastcheckok: 1, geo_lat: 43.65, geo_long: -79.38 }]))
  }))
  return play
}

function setHidden(hidden: boolean) {
  if (hidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  else delete (document as unknown as { visibilityState?: unknown }).visibilityState
  document.dispatchEvent(new Event('visibilitychange'))
}

async function tuneIn() {
  startDefaultMapRadio(43.65, -79.38)
  await vi.waitFor(() => expect(nowPlayingStation()?.name).toBe('Local One'))
}

afterEach(() => {
  setHidden(false)
  setUserMuted(false)
  stopMapRadio()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the page', () => {
  it('keeps an outside station on air when Poplur leaves the screen', async () => {
    stubRadio('outside')
    await tuneIn()
    setHidden(true)
    expect(getRadioPlaybackState()).toMatch(/^(live|fallback)$/)
  })

  it('silences an app-scope station when Poplur leaves the screen', async () => {
    stubRadio('app')
    await tuneIn()
    setHidden(true)
    expect(getRadioPlaybackState()).toBe('muted')
  })

  it('keeps a station the listener muted silent when they leave the app', async () => {
    const play = stubRadio('outside')
    await tuneIn()
    setUserMuted(true)
    expect(getRadioPlaybackState()).toBe('muted')
    const plays = play.mock.calls.length
    setHidden(true)
    expect(getRadioPlaybackState()).toBe('muted')
    expect(play).toHaveBeenCalledTimes(plays)
  })

  it('stops the station from Android\'s notification Stop', async () => {
    stubRadio('outside')
    await tuneIn()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'poplurRadioStop' } }))
    expect(isMapRadioActive()).toBe(false)
    expect(getRadioPlaybackState()).toBe('off')
  })
})

describe('the iPhone shell', () => {
  // App Review 2.5.4: iOS declares no audio background mode, so nothing may
  // promise or attempt playback once Poplur leaves the screen.
  it('reads a saved outside scope as Across Poplur and silences it on leaving', async () => {
    stubRadio('outside')
    vi.stubGlobal('webkit', { messageHandlers: { poplur: { postMessage: () => {} } } })
    expect(readRadioScope()).toBe('app')
    await tuneIn()
    setHidden(true)
    expect(getRadioPlaybackState()).toBe('muted')
  })

  it('declares no background modes and offers no outside choice', () => {
    expect(read('../Poplur2025-iOS/Poplur2025/Info.plist')).not.toContain('UIBackgroundModes')
    expect(read('src/SettingsScreen.tsx')).toContain("scope !== 'outside' || !isIOSNativeShell()")
  })
})

describe('the Android shell', () => {
  const activity = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/PostLoginWebActivity.kt')
  const service = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/radio/RadioPlaybackService.kt')
  const iosFence = read('../Poplur2025-iOS/Poplur2025/FeedAudioManager.swift')

  it('follows radioPlayback and sends the notification Stop to the page', () => {
    expect(activity).toContain('if (type == "radioPlayback")')
    expect(activity).toContain('RadioPlaybackService.keepsPlayingOutside(')
    expect(activity).toContain('.put("type", "poplurRadioStop")')
  })

  it('keeps Poplur running on the rule iOS uses', () => {
    expect(service).toContain('scope == "outside" && (state == "live" || state == "fallback")')
    expect(iosFence).toContain('webRadioScope == "outside" && (webRadioState == "live" || webRadioState == "fallback")')
  })

  it('leaves the timers running for an outside station', () => {
    expect(activity).toContain('if (radioOutsideOn) timersHeldForRadio = true else homeWebView.pauseTimers()')
  })
})
