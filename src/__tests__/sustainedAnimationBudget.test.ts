import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeAmbientDeadline, requestAmbientBurst } from '../ambientWorkBudget'

describe('sustained native animation budget', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    const doc = Object.assign(new EventTarget(), {
      hidden: false,
      documentElement: { dataset: {}, classList: { toggle: vi.fn() } },
    })
    const win = Object.assign(new EventTarget(), {
      setTimeout, clearTimeout, location: { origin: 'https://poplur.test' },
    }) as unknown as Window
    Object.assign(win, { top: win })
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
    vi.stubGlobal('navigator', { deviceMemory: 8 })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    vi.doMock('../nativeBridge', () => ({
      isNativeShell: () => true,
      MANAGED_RENDERING_OPERATION_EVENT: 'poplur-managed-rendering-operation',
    }))
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.doUnmock('../nativeBridge')
  })

  it('cannot extend a burst with repeated requests', () => {
    const budget = { deadline: 0, nextAllowedAt: 0 }
    expect(requestAmbientBurst(budget, 1_000, 15_000)).toBe(4_000)
    expect(requestAmbientBurst(budget, 3_999, 15_000)).toBe(4_000)
    expect(requestAmbientBurst(budget, 4_000, 15_000)).toBe(0)
    expect(requestAmbientBurst(budget, 15_999, 15_000)).toBe(0)
    expect(requestAmbientBurst(budget, 16_000, 15_000)).toBe(19_000)
  })

  it('shares the native rest period with a newly mounted same-origin map document', () => {
    const parent = window
    expect(nativeAmbientDeadline(15_000)).toBe(performance.now() + 3_000)
    vi.advanceTimersByTime(4_000)
    const child = { top: parent, location: { origin: parent.location.origin } }
    vi.stubGlobal('window', child)
    expect(nativeAmbientDeadline(15_000)).toBe(0)
    vi.advanceTimersByTime(11_000)
    expect(nativeAmbientDeadline(15_000)).toBe(performance.now() + 3_000)
    vi.stubGlobal('window', parent)
    expect(nativeAmbientDeadline(15_000)).toBe(performance.now() + 3_000)
  })

  it('bounds decoration across ten minutes of taps while every gesture remains responsive', async () => {
    const governor = await import('../frameGovernor')
    let ambientFrames = 0
    let interactiveFrames = 0
    const stopAmbient = governor.onFrame(() => ambientFrames++, 'ambient')
    const stopInteractive = governor.onFrame(() => interactiveFrames++, 'interactive')
    for (let i = 0; i < 1_200; i++) {
      const previous = interactiveFrames
      document.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(100)
      document.dispatchEvent(new Event('pointerup'))
      vi.advanceTimersByTime(400)
      expect(interactiveFrames).toBeGreaterThan(previous)
    }
    // At most 120s of decorative work in a 600s session, at <=30fps.
    // The previous renewable 15s timeout runs decoration for the whole 600s.
    expect(ambientFrames).toBeGreaterThan(100)
    expect(ambientFrames).toBeLessThan(3_700)
    vi.advanceTimersByTime(20_000)
    const settled = { ambientFrames, interactiveFrames }
    vi.advanceTimersByTime(60_000)
    expect({ ambientFrames, interactiveFrames }).toEqual(settled)
    stopAmbient()
    stopInteractive()
  })

  it('keeps a long drag and an explicit operation alive after decoration parks', async () => {
    const governor = await import('../frameGovernor')
    let frames = 0
    governor.onFrame(() => frames++, 'interactive')
    document.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(5_000)
    const duringDrag = frames
    vi.advanceTimersByTime(5_000)
    expect(frames).toBeGreaterThan(duringDrag)
    document.dispatchEvent(new Event('pointerup'))
    vi.advanceTimersByTime(2_000)
    const settled = frames
    vi.advanceTimersByTime(1_000)
    expect(frames).toBe(settled)
    window.dispatchEvent(new CustomEvent('poplur-managed-rendering-operation', { detail: { durationMs: 2_000 } }))
    vi.advanceTimersByTime(1_000)
    expect(frames).toBeGreaterThan(settled)
  })

  it('does not restart decoration on taps while the native thermal ceiling is fair', async () => {
    const governor = await import('../frameGovernor')
    let frames = 0
    governor.onFrame(() => frames++, 'ambient')
    window.dispatchEvent(new CustomEvent('poplur-native-thermal', { detail: { state: 'fair' } }))
    for (let i = 0; i < 60; i++) {
      document.dispatchEvent(new Event('pointerdown'))
      document.dispatchEvent(new Event('pointerup'))
      vi.advanceTimersByTime(500)
    }
    expect(frames).toBe(0)
  })
})
