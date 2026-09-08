// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMapRadio } from '../useMapRadio'
import { readMapRadioLocation } from '../mapRadioLocation'

const radio = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), tune: vi.fn(),
  gate: new Set<() => void>(), focus: new Set<(owner: string | null) => void>(),
}))
vi.mock('../mapRadio', () => ({ startDefaultMapRadio: radio.start, stopMapRadio: radio.stop, tuneMapRadioLocation: radio.tune }))
vi.mock('../audioGate', () => ({ onGateChange: (fn: () => void) => { radio.gate.add(fn); return () => radio.gate.delete(fn) } }))
vi.mock('../audioFocus', () => ({ onAudioFocusChange: (fn: (owner: string | null) => void) => { radio.focus.add(fn); return () => radio.focus.delete(fn) } }))

function Harness({ visible, lat = 43.65, lng = -79.38 }: { visible: boolean; lat?: number; lng?: number }) {
  useMapRadio(visible, { lat, lng })
  return null
}
afterEach(() => vi.clearAllMocks())

describe('Map radio ownership', () => {
  it('starts only on Map, follows the selected location, resumes after voice, and stops before Feed', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div'), root = createRoot(host)
    act(() => root.render(<Harness visible={false} />))
    expect(radio.start).not.toHaveBeenCalled()
    act(() => root.render(<Harness visible />))
    expect(radio.start).toHaveBeenLastCalledWith(43.65, -79.38)
    act(() => root.render(<Harness visible lat={-36.85} lng={174.76} />))
    expect(radio.tune).toHaveBeenLastCalledWith(-36.85, 174.76)
    act(() => radio.gate.forEach(fn => fn()))
    expect(radio.start).toHaveBeenLastCalledWith(-36.85, 174.76)
    act(() => radio.focus.forEach(fn => fn('voice')))
    act(() => radio.focus.forEach(fn => fn(null)))
    expect(radio.start).toHaveBeenLastCalledWith(-36.85, 174.76)
    act(() => root.render(<Harness visible={false} />))
    expect(radio.stop).toHaveBeenCalledOnce()
    expect(radio.gate.size).toBe(0)
    expect(radio.focus.size).toBe(0)
    radio.start.mockClear(); radio.tune.mockClear()
    act(() => root.render(<Harness visible={false} lat={51.5} lng={-0.12} />))
    expect(radio.start).not.toHaveBeenCalled()
    expect(radio.tune).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
  it('accepts only finite geographic coordinates from the selected Map frame', () => {
    expect(readMapRadioLocation({ latitude: -36.85, longitude: 174.76 })).toEqual({ lat: -36.85, lng: 174.76 })
    for (const value of [null, {}, { latitude: '43', longitude: -79 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: NaN }]) {
      expect(readMapRadioLocation(value)).toBeNull()
    }
  })
})
