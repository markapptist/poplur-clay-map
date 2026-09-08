// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeFeedAdVisibility } from '../useNativeFeedAdVisibility'
import { shouldHidePersistentCube } from '../persistentCubeVisibility'
import SpriteNavigator from '../SpriteNavigator'

vi.mock('../pop', () => ({ preloadPop: vi.fn(), primePopAudio: vi.fn() }))
vi.mock('../motionEffectsAudio', () => ({ primeMotionAudio: vi.fn() }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => true, postNativeEvent: vi.fn() }))
let host: HTMLDivElement
let root: Root
function Screen({ feedVisible }: { feedVisible: boolean }) {
  const adOpen = useNativeFeedAdVisibility(feedVisible)
  const hidden = shouldHidePersistentCube({ nativeFeedAdOpen: adOpen, feedFullscreen: false, subscreenFullscreen: !feedVisible })
  return <div data-ad-open={adOpen}><SpriteNavigator modelUrl="poplur_cube_gear.glb" targetTab="profile"
    renderingVisible={!hidden} onTap={() => {}} onHold={() => {}} onFaceChange={() => {}} /></div>
}
async function show(feedVisible: boolean) { await act(async () => root.render(<Screen feedVisible={feedVisible} />)) }
function ad(open: boolean) { act(() => window.dispatchEvent(new CustomEvent('poplur-native-feed-ad', { detail: { open } }))) }
function tilt(roll: number) {
  act(() => {
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new CustomEvent('poplur-native-motion', { detail: { roll, pitch: 1 } }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw Error('Cube motion must not allocate a canvas') })
  delete window.__poplurNativeAppActive
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('native Feed ad ownership', () => {
  it('resumes subscreen cube motion when leaving an open Feed ad without a closing callback', async () => {
    await show(true); ad(true)
    tilt(.25)
    expect(host.querySelector('img')?.getAttribute('src')).toContain('y0_p0')
    await show(false)
    expect(host.querySelector('[data-ad-open]')?.getAttribute('data-ad-open')).toBe('false')
    tilt(.25)
    expect(host.querySelector('img')?.getAttribute('src')).toContain('y24_p0')
    tilt(-.25)
    expect(host.querySelector('img')?.getAttribute('src')).toContain('y-24_p0')
    expect(host.querySelector('canvas')).toBeNull()
  })

  it('ignores a late ad-open on another screen and requires a fresh callback when Feed returns', async () => {
    await show(true); ad(true); await show(false)
    ad(true)
    expect(host.querySelector('[data-ad-open]')?.getAttribute('data-ad-open')).toBe('false')
    await show(true)
    expect(host.querySelector('[data-ad-open]')?.getAttribute('data-ad-open')).toBe('false')
    ad(true)
    expect(host.querySelector('[data-ad-open]')?.getAttribute('data-ad-open')).toBe('true')
    ad(false)
    expect(host.querySelector('[data-ad-open]')?.getAttribute('data-ad-open')).toBe('false')
  })
})
