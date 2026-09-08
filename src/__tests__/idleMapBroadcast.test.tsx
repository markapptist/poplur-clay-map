// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useIdleMapBroadcast } from '../useIdleMapBroadcast'

const quality = vi.hoisted(() => ({ value: 3, listener: () => {} }))
vi.mock('../frameGovernor', () => ({ currentQuality: () => quality.value,
  onQualityChange: (listener: () => void) => { quality.listener = listener; return () => { quality.listener = () => {} } } }))
afterEach(() => { vi.useRealTimers(); quality.value = 3 })

it('uses spaced finite visits, yields to touch, and parks completely in background or thermal pressure', async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'), root = createRoot(host)
  const diagnostics = { policy: 'idle-pins', autonomousCameraStarts: 0, explicitTourStarts: 0, idleTimerArmed: false, flightActive: false }
  const cancel = vi.fn(), explore = vi.fn(() => cancel)
  let front = true, available = true
  const Screen = () => { useIdleMapBroadcast({ enabled: true, visible: () => front, available: () => available, explore, diagnostics }); return null }
  await act(async () => root.render(<Screen />))
  await act(async () => vi.advanceTimersByTime(19_999))
  expect(explore).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(1))
  expect(explore).toHaveBeenCalledTimes(1)
  await act(async () => document.dispatchEvent(new Event('pointerdown')))
  expect(cancel).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTime(20_000))
  expect(explore).toHaveBeenCalledTimes(2)
  available = false
  await act(async () => vi.advanceTimersByTime(30_000))
  expect(explore).toHaveBeenCalledTimes(2)
  front = false
  await act(async () => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'poplur-map-front' } })))
  expect(diagnostics.idleTimerArmed).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  front = true; available = true; quality.value = 1
  await act(async () => quality.listener())
  expect(vi.getTimerCount()).toBe(0)
  quality.value = 3
  await act(async () => quality.listener())
  expect(diagnostics.idleTimerArmed).toBe(true)
  await act(async () => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: false } })))
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => root.unmount())
  expect(vi.getTimerCount()).toBe(0)
})
