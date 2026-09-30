// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDE_BETA_PLACEHOLDERS } from '../betaFeatures'
import { PROFILE_TABS, requestProfileMode, takeProfileMode } from '../profileMode'
import { FLASHLIGHT_APP, listMiniApps, saveMiniApp } from '../miniApps'
import { CHANNELS } from '../FeedTwin'
import SettingsScreen from '../SettingsScreen'
import StudioScreen from '../StudioScreen'
import PhoneScreen from '../PhoneScreen'
import MapIpod from '../MapIpod'
import ProfileTwin from '../ProfileTwin'
import Camera from '../Camera'
import MailScreen from '../MailScreen'
import NewsPaper from '../NewsPaper'
import { dropNewsMessage } from '../newsMessages'
import { beginPodcastMapPick, clearPodcastMapPick, completePodcastMapPick, hasPendingPodcastMapPick, readPodcastMapPick } from '../podcastMapDraft'

const snapshot = vi.hoisted(() => ({ posts: [] as any[], location: null as any,
  news: { events: [], loading: false, source: 'empty', stale: false, error: null, refresh: async () => [] } }))
vi.mock('../nativeFeedPosts', () => ({
  nativeFeedPostsSnapshot: () => snapshot.posts,
  onNativeFeedPosts: () => () => {},
  requestNativeFeedPosts: () => {},
}))
vi.mock('firebase/firestore', async original => ({
  ...await original<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(() => () => {}),
}))
vi.mock('../nativeBridge', async original => ({
  ...await original<typeof import('../nativeBridge')>(),
  isNativeShell: () => true,
  isIOSNativeShell: () => false,
  isAndroidNativeShell: () => true,
  postNativeEvent: vi.fn(() => true),
}))
vi.mock('../nearbyLocation', () => ({ useNearbyLocation: () => snapshot.location }))
vi.mock('../notificationPrefs', () => ({ readNotificationPrefs: async () => null, writeNotificationPref: vi.fn() }))
vi.mock('../testActivity', async original => ({
  ...await original<typeof import('../testActivity')>(),
  loadTestActivityConsent: async () => false,
}))
vi.mock('../modelSprite', () => ({ modelSprite: async () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }))
vi.mock('../pop', () => ({ playPop: () => {}, primePopAudio: () => {} }))
vi.mock('../cubeNavigationSound', () => ({ playCubeNavigationPop: () => {}, markCubeNavigationPop: () => {} }))
vi.mock('../feedEngagements', () => ({ recordPostEngagement: vi.fn(), recordVisiblePostView: vi.fn(async () => undefined) }))
vi.mock('../feedPostComments', () => ({ useFeedPostComments: () => [] }))
vi.mock('../webCall', () => ({
  subscribeCall: () => () => {}, subscribeCallMedia: () => () => {}, installCallBridge: () => {},
  placeCall: vi.fn(), hangup: vi.fn(), toggleMute: vi.fn(),
}))
vi.mock('../soundcloudDiscovery', async original => ({
  ...await original<typeof import('../soundcloudDiscovery')>(), discoverNearbySoundCloud: vi.fn(),
}))
vi.mock('../liveNews', async original => ({
  ...await original<typeof import('../liveNews')>(),
  useLiveNews: () => snapshot.news,
}))
vi.mock('../phoneRingtones', async original => ({
  ...await original<typeof import('../phoneRingtones')>(), previewRingtone: () => {}, startRingtone: () => {}, stopRingtone: () => {},
}))

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: key => { values.delete(key) }, clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  window.localStorage.clear()
  snapshot.posts = []
  snapshot.location = null
  clearPodcastMapPick()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})
afterEach(() => { clearPodcastMapPick(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function mounted(element: React.ReactElement, check: (host: HTMLDivElement) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try { await act(async () => root.render(element)); await check(host) }
  finally { await act(async () => root.unmount()); host.remove() }
}
function byLabel(host: HTMLElement, label: string): HTMLButtonElement {
  return host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
}
async function click(button: HTMLButtonElement) {
  expect(button).not.toBeNull()
  await act(async () => button.click())
}
async function key(value: string) {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: value })))
}

describe('the shared beta placeholder policy', () => {
  it('removes LIVE from the feed/guide catalogue and consumes stale Liked handoffs as Media', () => {
    expect(HIDE_BETA_PLACEHOLDERS).toBe(true)
    expect(CHANNELS.some(channel => channel.id === 'live')).toBe(false)
    expect(CHANNELS.some(channel => channel.id === 'food')).toBe(true)
    expect(PROFILE_TABS).toEqual(['media'])
    requestProfileMode('liked')
    expect(takeProfileMode()).toBe('media')
    expect(takeProfileMode()).toBeNull()
  })

  it('refuses dormant mini-app creation while keeping the built-in flashlight', () => {
    expect(saveMiniApp({ ...FLASHLIGHT_APP, app: { ...FLASHLIGHT_APP.app, id: 'test-created' } })).toMatch(/unavailable/)
    expect(listMiniApps().map(app => app.app.id)).toEqual(['poplur-flashlight'])
    expect(window.localStorage.getItem('poplur.miniapps.v1')).toBeNull()
  })

  it('hides profile verification requests and preserves account deletion', async () => {
    await mounted(<SettingsScreen />, async host => {
      expect(host.textContent).not.toContain('Verification')
      expect(host.querySelector('[aria-label="Profile verification"]')).toBeNull()
      expect(host.textContent).toContain('Delete account')
    })
  })

  it('keeps recording an episode reachable without live or guest invites', async () => {
    await mounted(<StudioScreen onClose={() => {}} />, async host => {
      await click(byLabel(host, 'Start a podcast'))
      expect(host.querySelector('[aria-label="Poplur podcast room"]')).not.toBeNull()
      expect(host.textContent).not.toMatch(/LIVE PODCAST|START LIVE|PEOPLE IN YOUR RADIUS|Invite your people/)
      expect(host.textContent).toContain('RECORD EPISODE')
      const record = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('RECORD EPISODE'))!
      await click(record)
      expect(host.textContent).not.toContain('Recording everyone')
    })
  })

  it('restores an old live selection as a recorded workflow and preserves its name and audio', async () => {
    beginPodcastMapPick({ kind: 'live', title: 'Retained show', genre: 'Talk', aiEnhanced: false,
      invitedIds: ['old-guest'], audioUrl: 'https://example.invalid/episode.webm', durationMs: 1200 })
    completePodcastMapPick({ lat: 43.65, lng: -79.38, radiusKm: 5 })
    await mounted(<StudioScreen onClose={() => {}} />, async host => {
      expect((host.querySelector('[aria-label="Podcast name"]') as HTMLInputElement).value).toBe('Retained show')
      expect(host.textContent).not.toMatch(/START LIVE|old-guest|IN ROOM/)
      const drop = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('DROP EPISODE'))!
      await click(drop)
      expect(hasPendingPodcastMapPick()).toBe(true)
      completePodcastMapPick({ lat: 43.66, lng: -79.39 })
      expect(readPodcastMapPick()).toMatchObject({ kind: 'recorded', title: 'Retained show',
        audioUrl: 'https://example.invalid/episode.webm', invitedIds: [] })
    })
  })

  it('keeps Phone contacts/log/ringtones reachable and cycles past every dead extra', async () => {
    await mounted(<PhoneScreen />, async host => {
      await act(async () => vi.advanceTimersByTime(2_000))
      const offered = new Set<string>()
      for (let n = 0; n < 6; n++) {
        host.querySelectorAll('button[aria-label^="Open "]').forEach(button => offered.add(button.getAttribute('aria-label')!))
        await key('8')
      }
      expect([...offered]).toEqual(expect.arrayContaining(['Open Contacts', 'Open Call log', 'Open Settings']))
      expect([...offered].join(' ')).not.toMatch(/Messages|Camera|Gallery|Radio|Games/)
    })
  })

  it('keeps first-party iPod music without offering SoundCloud nearby', async () => {
    snapshot.location = { lat: 43.65, lng: -79.38, source: 'device' }
    const { discoverNearbySoundCloud } = await import('../soundcloudDiscovery')
    await mounted(<MapIpod />, async host => {
      await act(async () => vi.advanceTimersByTime(2_000))
      await key('Enter')
      expect(host.textContent).toContain('Poplur Studio')
      expect(host.textContent).not.toContain('SoundCloud')
      expect(discoverNearbySoundCloud).not.toHaveBeenCalled()
    })
  })

  it('hides the Liked tab even after a stale profile-mode event', async () => {
    snapshot.posts = [{ id: 'fixture-pop', ownerId: 'fixture', username: '@fixture', mediaType: 'photo',
      mediaURL: 'https://example.invalid/fixture.webp', channelId: 'food', createdAtMillis: Date.now(), locationVisibility: 'hidden' }]
    await mounted(<ProfileTwin viewUser="@fixture" viewUserId="fixture" />, async host => {
      expect(host.textContent).not.toContain('Liked')
      await act(async () => window.dispatchEvent(new CustomEvent('poplur-open-profile-mode', { detail: { mode: 'liked' } })))
      expect(host.textContent).not.toContain('No liked posts')
      expect(host.textContent).toContain('Media')
      await click(host.querySelector('img[src="https://example.invalid/fixture.webp"]')!.closest('button')!)
      await click(byLabel(host, 'Share post'))
      const share = host.querySelector('[role="dialog"][aria-label="Send this pop"]')!
      expect(share).not.toBeNull()
      expect(share.textContent).not.toMatch(/DM a friend|recent DM contacts/)
      expect(share.querySelector('[title^="Send to "]')).toBeNull()
      expect(share.querySelector('[aria-label="Copy link"]')).not.toBeNull()
      expect(share.querySelector('[aria-label="Share outside Poplur"]')).not.toBeNull()
    })
  })

  it('hides camera live-video broadcasting without removing its recording controls', async () => {
    await mounted(<Camera />, async host => {
      expect(host.querySelector('[data-camera-live]')).toBeNull()
      expect(host.querySelector('[aria-label="Live video unavailable"]')).toBeNull()
      expect(host.querySelector('[data-poplur-screen="camera"]')).not.toBeNull()
    })
  })

  it('keeps message tools without the AI game invitations tray', async () => {
    vi.useRealTimers()
    await mounted(<MailScreen initialComposeTo={{ peerId: 'friend', peerName: '@friend' }} />, async host => {
      await act(async () => window.dispatchEvent(new CustomEvent('poplur-dm-result', { detail: { type: 'poplurDMThreads', threads: [] } })))
      const toggle = host.querySelector('button[aria-controls="poplur-message-tools"]') as HTMLButtonElement
      await click(toggle)
      expect(host.querySelector('[role="tablist"][aria-label="Message actions"]')).not.toBeNull()
      expect(host.textContent).not.toContain('AI game')
      expect(host.querySelector('[aria-label="AI game invitations"]')).toBeNull()
      expect(host.textContent).toContain('Camera roll')
    })
  })

  it('hides News reply/repop controls and keeps the story readable', async () => {
    dropNewsMessage({ body: 'The beta story is readable', lat: 43.65, lng: -79.38, radiusKm: 5 })
    await mounted(<NewsPaper onClose={() => {}} />, async host => {
      const story = host.querySelector('[data-news-entry-id]')!
      expect(story).not.toBeNull()
      expect(story.textContent).toContain('The beta story is readable')
      expect([...story.querySelectorAll('button')].map(button => button.textContent).join(' ')).not.toMatch(/✎|⇄/)
      expect(host.querySelector('[aria-label^="Reply to "]')).toBeNull()
    })
  })
})
