// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PopPin } from '../ClayMap'
import { PIN_ARRIVAL_SETTLE_MS, PIN_ARRIVAL_SPACING_MS, useMapPinArrival } from '../useMapPinArrival'
const seen = new Set<string>()
vi.mock('../seenPosts', () => ({
  feedPostIdFromPinId: (id: string) => id.replace(/^firestore:/, ''),
  isPostSeen: (id: string) => seen.has(id),
}))
const pin = (id: string, props: Partial<PopPin> = {}): PopPin => ({
  id: `firestore:${id}`, name: id, user: '@test', mine: false, avatar: null,
  coords: [-79.38, 43.65], radiusKm: 1, color: '#ff0099',
  media: { kind: 'image', src: `https://example.test/${id}.jpg`, alt: id }, ...props,
})
let root: ReturnType<typeof createRoot>
let front = true, available = true
const cancel = vi.fn(), arrive = vi.fn(() => cancel)
function Screen({ pins, ready = true, viewerKey = 'me' }: { pins: PopPin[]; ready?: boolean; viewerKey?: string }) {
  useMapPinArrival({ pins, ready, viewerKey, visible: () => front, available: () => available, arrive })
  return null
}
const render = (pins: PopPin[], ready = true, viewerKey = 'me') => act(() => root.render(<Screen pins={pins} ready={ready} viewerKey={viewerKey} />))
const tick = (ms = PIN_ARRIVAL_SETTLE_MS) => act(() => vi.advanceTimersByTime(ms))
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); seen.clear(); front = true; available = true
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  root = createRoot(document.createElement('div'))
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers() })
describe('new radius arrivals', () => {
  it('baselines the initial complete board without a cut', () => {
    render([], false); render([pin('old')]); tick()
    expect(arrive).not.toHaveBeenCalled()
    render([pin('old'), pin('new')]); tick()
    expect(arrive).toHaveBeenCalledWith(pin('new'), false)
  })
  it('alternates a map cut with an exact-post Feed handoff and spaces bursts', () => {
    render([]); render([pin('a')]); tick()
    render([pin('a'), pin('b')]); tick()
    expect(arrive).toHaveBeenCalledTimes(1)
    tick(PIN_ARRIVAL_SPACING_MS)
    expect(arrive).toHaveBeenLastCalledWith(pin('b'), true)
    expect(seen.size).toBe(0)
  })
  it('does not replay snapshots, re-entries or presentation changes', () => {
    render([]); render([pin('a')]); tick()
    render([]); render([pin('a', { color: '#00ff00' })]); tick(60_000)
    expect(arrive).toHaveBeenCalledTimes(1)
  })
  it('ignores own, ghost and already-opened pins', () => {
    seen.add('seen'); render([])
    render([pin('own', { mine: true }), pin('ghost', { ghost: true }), pin('seen')]); tick()
    expect(arrive).not.toHaveBeenCalled()
  })
  it('coalesces simultaneous arrivals to a single camera beat', () => {
    render([]); render([pin('a'), pin('b'), pin('c')]); tick(60_000)
    expect(arrive).toHaveBeenCalledTimes(1)
    expect(arrive).toHaveBeenCalledWith(pin('a'), false)
  })
  it('does not build a backlog while off-map or while controls are busy', () => {
    render([]); front = false; render([pin('a')]); tick()
    front = true; available = false; render([pin('a'), pin('b')]); tick()
    available = true; render([pin('a'), pin('b')]); tick()
    expect(arrive).not.toHaveBeenCalled()
  })
  it('drops a pin deleted or opened before the cut', () => {
    render([]); render([pin('a')]); render([]); tick()
    render([pin('b')]); seen.add('b'); tick()
    expect(arrive).not.toHaveBeenCalled()
  })
  it('cancels pending arrival and active handoff on real input', () => {
    render([]); render([pin('a')])
    act(() => window.dispatchEvent(new Event('pointerdown'))); tick()
    expect(arrive).not.toHaveBeenCalled()
    render([pin('a'), pin('b')]); tick()
    act(() => window.dispatchEvent(new Event('wheel')))
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels when leaving Map before the handoff', () => {
    render([]); render([pin('a')]); tick()
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: window.parent, origin: window.location.origin, data: { type: 'poplur-map-front', front: false },
    })))
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('keeps media-less arrivals on the map', () => {
    render([]); render([pin('a')]); tick()
    render([pin('b', { media: undefined })]); tick(PIN_ARRIVAL_SPACING_MS)
    expect(arrive).toHaveBeenLastCalledWith(pin('b', { media: undefined }), false)
  })
  it('does not run a delayed cut while its data is no longer ready', () => {
    render([]); render([pin('a')]); render([pin('a')], false); tick()
    expect(arrive).not.toHaveBeenCalled()
  })
  it('cancels native background work and native map touches', () => {
    render([]); render([pin('a')]); tick()
    act(() => window.dispatchEvent(new Event('poplur-native-map-tap')))
    expect(cancel).toHaveBeenCalledOnce()
    act(() => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: false } })))
    render([pin('a'), pin('b')]); tick(60_000)
    expect(arrive).toHaveBeenCalledTimes(1)
  })
  it('resets the initial board on an account change', () => {
    render([]); render([pin('a')]); tick()
    render([pin('b')], true, 'other'); tick(60_000)
    expect(arrive).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
