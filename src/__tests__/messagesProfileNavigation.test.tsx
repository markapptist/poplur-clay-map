// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import NewsPaper from '../NewsPaper'
import MessageTimeline from '../MessageTimeline'
import PoplurBrowserScreen from '../PoplurBrowserScreen'
import { isRetiredNavigationScreen } from '../retiredNavigationRoutes'

const data = vi.hoisted(() => ({
  account: { uid: 'me', username: 'mark', displayName: 'Mark', photoURL: 'mark.png' },
  posts: [
    { id: 'mine', ownerId: 'me', username: 'mark', mediaURL: 'https://example.invalid/mine.jpg', mediaType: 'photo', contentType: 'message', messageCard: true, caption: 'My message', createdAtMillis: 200, radiusMeters: 5000 },
    { id: 'friend', ownerId: 'friend', username: 'friend', mediaURL: 'https://example.invalid/friend.jpg', mediaType: 'photo', contentType: 'message', messageCard: true, caption: 'Their message', createdAtMillis: 100, radiusMeters: 2000 },
  ],
  news: [{ id: 'edition', body: 'Keep this edition', lng: -79, lat: 43, radiusKm: 5, at: 100, media: [] }],
  events: [],
}))
vi.mock('../accountStore', () => ({ accountSnapshot: () => data.account, onAccountChange: (fn: any) => { fn(data.account); return () => {} } }))
vi.mock('../nativeFeedPosts', () => ({ nativeFeedPostsSnapshot: () => data.posts, onNativeFeedPosts: () => () => {} }))
vi.mock('../useAuthoredPosts', () => ({ useAuthoredPosts: (uid: string) => ({ snapshot: { posts: data.posts.filter(p => p.ownerId === uid) }, loading: false }) }))
vi.mock('../newsMessages', async original => ({ ...await original<typeof import('../newsMessages')>(), readNewsMessages: () => data.news, onNewsMessages: () => () => {} }))
vi.mock('../liveNews', () => ({ useLiveNews: () => ({ events: data.events, source: 'empty', loading: false, refresh: vi.fn() }), liveNewsRadiusKm: () => 0, liveNewsWhen: () => 'now' }))
vi.mock('../pop', () => ({ playPop: vi.fn() }))
vi.mock('../cubeNavigationSound', () => ({ playCubeNavigationPop: vi.fn() }))
vi.mock('../usePullToRefresh', () => ({ usePullToRefresh: vi.fn() }))
vi.mock('../useNewsRadiusFocus', () => ({ useNewsRadiusFocus: vi.fn() }))
vi.mock('../skyCycle', () => ({ localDaylight: () => true }))
vi.mock('../controlPlacement', () => ({ useControlSide: () => 'left' }))
vi.mock('../ScreenCoach', () => ({ default: () => null }))
vi.mock('../ClayCornerButton', () => ({ default: () => null }))
vi.mock('../SideControlIcon', () => ({ default: (props: any) => <button aria-label={props['aria-label']} onClick={props.onActivate} /> }))
vi.mock('../TabControlRail', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('../ShaderVideoPlayer', () => ({ default: ({ src, active }: any) => <video data-media-src={src} data-active={active} /> }))
vi.mock('../NewsSourceVideo', () => ({ default: () => null }))
vi.mock('../ProfilePostPreview', () => ({ default: ({ src }: any) => <img src={src} /> }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => false, postNativeEvent: vi.fn() }))

let host: HTMLDivElement, root: Root
let back: (() => boolean) | null
const bindBack = (fn: (() => boolean) | null) => { back = fn }
const close = vi.fn()
const escaped = vi.fn()
const routeEvents = ['poplur-open-profile-mode', 'poplur-open-message-timeline', 'poplur-open-post-notification', 'poplur-open-feed-browser']
const profile = () => host.querySelector<HTMLElement>('[aria-label="Messages profile"]')
function click(selector: string) { act(() => host.querySelector<HTMLButtonElement>(selector)!.click()) }
function openProfile() {
  click('[aria-label="Open news menu"]')
  const drawer = host.querySelector('[aria-label="News menu"]')!
  const button = [...drawer.querySelectorAll('button')].find(button => button.textContent?.includes('Your messages'))!
  act(() => button.click())
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  back = null; close.mockClear(); escaped.mockClear()
  routeEvents.forEach(name => window.addEventListener(name, escaped))
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  routeEvents.forEach(name => window.removeEventListener(name, escaped))
  vi.restoreAllMocks()
})

it('opens Profile inside Messages without a Close button and cube Back restores its edition and scroll', () => {
  act(() => root.render(<NewsPaper onClose={close} bindBack={bindBack} />))
  const paper = host.querySelector('[aria-label="Poplur Times"]')!
  const scroll = host.querySelector('[data-pull-panel]')!.parentElement!
  scroll.scrollTop = 240
  openProfile()
  expect(paper.contains(profile())).toBe(true)
  expect(profile()!.textContent).toContain('My message')
  expect(profile()!.textContent).not.toContain('Their message')
  expect(scroll.hidden).toBe(true)
  expect([...host.querySelectorAll('button')].some(b => /^(CLOSE|BACK TO MESSAGES PROFILE)$/.test(b.textContent ?? ''))).toBe(false)
  expect(host.querySelector('[aria-label="Open messages menu"]')).not.toBeNull()
  act(() => { expect(back!()).toBe(true) })
  expect(profile()).toBeNull()
  expect(scroll.hidden).toBe(false)
  expect(scroll.scrollTop).toBe(240)
  expect(host.textContent).toContain('Keep this edition')
  expect(close).not.toHaveBeenCalled()
  expect(escaped).not.toHaveBeenCalled()
})

it('keeps a message inside Messages and cube Back unwinds message, profile, then edition', () => {
  act(() => root.render(<NewsPaper onClose={close} bindBack={bindBack} />))
  openProfile()
  click('[aria-label="Open Pop Message: My message"]')
  expect(profile()!.querySelector('[aria-label="Pop Message"]')).not.toBeNull()
  act(() => { expect(back!()).toBe(true) })
  expect(profile()!.querySelector('[aria-label="Pop Messages"]')).not.toBeNull()
  act(() => { expect(back!()).toBe(true) })
  expect(profile()).toBeNull()
  act(() => { expect(back!()).toBe(false) })
  expect(escaped).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('returns from an author profile to the same open message before returning to the edition', () => {
  act(() => root.render(<NewsPaper onClose={close} bindBack={bindBack} />))
  act(() => Simulate.keyDown(host.querySelector('[data-news-entry-id="edition"]')!, { key: 'Enter' }))
  click('[aria-label="You\'s post"] button')
  expect(profile()).not.toBeNull()
  act(() => { expect(back!()).toBe(true) })
  expect(host.querySelector<HTMLElement>('[aria-label="You\'s post"]')!.hidden).toBe(false)
  expect(escaped).not.toHaveBeenCalled()
})

it('uses an explicit visited handle without leaking it into a later own profile', () => {
  act(() => root.render(<MessageTimeline viewUser="@friend" />))
  expect(host.textContent).toContain('Their message')
  expect(host.textContent).not.toContain('My message')
  act(() => root.render(<MessageTimeline viewUser={null} />))
  expect(host.textContent).toContain('My message')
  expect(host.textContent).not.toContain('Their message')
})

it('opens the shared hamburger menu from the profile and cube Back closes the menu before the page', () => {
  act(() => root.render(<NewsPaper onClose={close} bindBack={bindBack} />))
  openProfile()
  click('[aria-label="Open messages menu"]')
  const drawer = host.querySelector('[aria-label="Messages menu"]')!
  expect(drawer.getAttribute('aria-hidden')).toBeNull()
  expect(drawer.textContent).toContain('Your messages')
  expect(drawer.textContent).not.toContain('CLOSE')
  act(() => { expect(back!()).toBe(true) })
  expect(drawer.getAttribute('aria-hidden')).toBe('true')
  expect(profile()).not.toBeNull()
  act(() => { expect(back!()).toBe(true) })
  expect(profile()).toBeNull()
  expect(escaped).not.toHaveBeenCalled()
})

it('can return to the messages feed through its profile hamburger menu', () => {
  act(() => root.render(<NewsPaper onClose={close} bindBack={bindBack} />))
  openProfile()
  click('[aria-label="Open messages menu"]')
  const item = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Messages menu"] button')]
    .find(button => button.textContent?.includes('Back to the messages feed'))!
  act(() => item.click())
  expect(profile()).toBeNull()
  expect(host.textContent).toContain('Keep this edition')
  expect(escaped).not.toHaveBeenCalled()
})

it('keeps Browser as a working address browser, including after leaving a messages profile', () => {
  act(() => root.render(<NewsPaper onClose={close} />))
  openProfile()
  act(() => root.render(<PoplurBrowserScreen bindBack={bindBack} />))
  expect(host.querySelector('[aria-label="Poplur Browser"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="Pop Messages"]')).toBeNull()
  const input = host.querySelector<HTMLInputElement>('[aria-label="Website address"]')!
  act(() => Simulate.change(input, { target: { value: 'example.com' } } as any))
  // The DOM harness deliberately blocks remote iframe loads; assert that
  // expected diagnostic while still exercising the real address navigation.
  const iframeDiagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
  act(() => Simulate.submit(host.querySelector('form')!))
  expect(iframeDiagnostic).toHaveBeenCalledTimes(1)
  expect(String(iframeDiagnostic.mock.calls[0][0])).toContain('Iframe page loading is disabled')
  iframeDiagnostic.mockRestore()
  expect(host.querySelector('iframe')!.src).toBe('https://example.com/')
  act(() => { expect(back!()).toBe(true) })
  expect(host.querySelector('iframe')).toBeNull()
})

it('retires the detached profile route and reserves the @ navigator for Browser', () => {
  expect(isRetiredNavigationScreen('profile-timeline')).toBe(true)
  expect(isRetiredNavigationScreen('feed-browser')).toBe(false)
  const home = readFileSync(resolve(process.cwd(), 'src/HomeTwin.tsx'), 'utf8')
  const hold = readFileSync(resolve(process.cwd(), 'src/HoldMenuTwin.tsx'), 'utf8')
  expect(home).not.toContain('profile-timeline')
  expect(home).not.toContain('poplur-open-message-timeline')
  expect(hold).not.toContain('profile-timeline')
  expect(home).toContain("'feed-browser': BROWSER_CUBE_MODEL")
  expect(hold).toContain('<PoplurBrowserScreen initialURL={initialBrowserURL} bindBack={bindNativeBack} />')
})
