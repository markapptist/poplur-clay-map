// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpriteNavigator, { nearestNavigatorFrame } from '../SpriteNavigator'
import type { CubeTab3DProps } from '../CubeTab3D'

vi.mock('../pop', () => ({ preloadPop: vi.fn(), primePopAudio: vi.fn() }))
vi.mock('../motionEffectsAudio', () => ({ primeMotionAudio: vi.fn() }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => false, postNativeEvent: vi.fn() }))

let root: Root
let host: HTMLDivElement
let callbacks: CubeTab3DProps

beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('A navigator must not create a drawing context') })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  callbacks = { targetTab: 'feed', modelUrl: 'clay_tv.glb', onFaceChange: vi.fn(), onTap: vi.fn(), onHold: vi.fn(), onVerticalSwipe: vi.fn(), onModelReady: vi.fn() }
  await act(async () => { root.render(createElement(SpriteNavigator, callbacks)) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove(); vi.restoreAllMocks(); vi.useRealTimers()
})

function pointer(type: string, x: number, y: number) {
  const node = host.querySelector('[role="button"]')!
  act(() => { node.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 1, bubbles: true })) })
}

describe('shared sprite navigator', () => {
  it('renders the existing TV artwork without a canvas or WebGL call', () => {
    expect(host.querySelector('canvas')).toBeNull()
    expect(host.querySelector('img')?.getAttribute('src')).toContain('clay_tv_y0_p0.webp')
    expect(callbacks.onModelReady).toHaveBeenCalledWith('clay_tv.glb')
  })

  it('recognizes a fast tab flick even without an intermediate move event', () => {
    pointer('pointerdown', 100, 100); pointer('pointerup', 55, 100)
    expect(callbacks.onFaceChange).toHaveBeenCalledTimes(1)
    expect(callbacks.onFaceChange).toHaveBeenCalledWith('profile')
    expect(callbacks.onTap).not.toHaveBeenCalled()
  })

  it('routes a vertical swipe to the current page and never fires the camera shutter', () => {
    pointer('pointerdown', 100, 100); pointer('pointerup', 100, 55)
    expect(callbacks.onVerticalSwipe).toHaveBeenCalledTimes(1)
    expect(callbacks.onVerticalSwipe).toHaveBeenCalledWith(1)
    expect(callbacks.onTap).not.toHaveBeenCalled()
    expect(callbacks.onFaceChange).not.toHaveBeenCalled()
  })

  it('preserves immediate taps, long-press menus, and cancellation', () => {
    pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100)
    expect(callbacks.onTap).toHaveBeenCalledTimes(1)
    pointer('pointerdown', 100, 100)
    act(() => vi.advanceTimersByTime(500))
    pointer('pointerup', 100, 100)
    expect(callbacks.onHold).toHaveBeenCalledTimes(1)
    expect(callbacks.onTap).toHaveBeenCalledTimes(1)
    pointer('pointerdown', 100, 100); pointer('pointercancel', 100, 100)
    act(() => vi.advanceTimersByTime(500))
    expect(callbacks.onHold).toHaveBeenCalledTimes(1)
  })

  it('keeps incoming-call double taps separate from ordinary taps', async () => {
    const doubleTap = vi.fn()
    await act(async () => root.render(createElement(SpriteNavigator, { ...callbacks, onDoubleTap: doubleTap, doubleTapWindowMs: 260 })))
    pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100)
    act(() => vi.advanceTimersByTime(100))
    pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100)
    act(() => vi.advanceTimersByTime(300))
    expect(doubleTap).toHaveBeenCalledTimes(1)
    expect(callbacks.onTap).not.toHaveBeenCalled()
  })

  it('does not keep timers alive after leaving the screen', async () => {
    pointer('pointerdown', 100, 100)
    await act(async () => root.render(createElement(SpriteNavigator, { ...callbacks, renderingVisible: false })))
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(5000))
    expect(callbacks.onHold).not.toHaveBeenCalled()
  })

  it('accepts assistive activation without repeating ordinary pointer taps', () => {
    const button = host.querySelector('[role="button"]')!
    pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100)
    act(() => button.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })))
    expect(callbacks.onTap).toHaveBeenCalledTimes(1)
    act(() => button.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true })))
    expect(callbacks.onTap).toHaveBeenCalledTimes(2)
  })

  it('keeps the awarded dice face when motion samples arrive', async () => {
    await act(async () => root.render(createElement(SpriteNavigator, { ...callbacks, modelUrl: 'poplur_dice_lite.glb', diceRollFace: 5 })))
    const landed = host.querySelector('img')?.getAttribute('src')
    pointer('pointerdown', 100, 100)
    act(() => window.dispatchEvent(new CustomEvent('poplur-native-motion', { detail: { roll: 0.4, pitch: 1.2 } })))
    expect(host.querySelector('img')?.getAttribute('src')).toBe(landed)
  })

  it('selects a baked 3D view instead of skewing a flat image', () => {
    expect(nearestNavigatorFrame([{ yaw: -24, pitch: 0, src: 'left' }, { yaw: 0, pitch: 0, src: 'front' }, { yaw: 24, pitch: 0, src: 'right' }], 20, 0)?.src).toBe('right')
  })
})
