// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CameraAvailability, { cameraParkPlan, readNativeCameraBudget, type NativeCameraBudget } from '../CameraAvailability'

let root: Root | undefined
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
  delete (window as Window & { __poplurCameraBudget?: NativeCameraBudget }).__poplurCameraBudget
})

describe('native camera availability', () => {
  it('keeps the photo library usable during a thermal stop, then offers an explicit resume after recovery', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onResume = vi.fn()
    const onOpenRoll = vi.fn()
    const render = (budget: NativeCameraBudget) => act(() => root!.render(
      <CameraAvailability budget={budget} onResume={onResume} onOpenRoll={onOpenRoll} />,
    ))
    const parked: NativeCameraBudget = { state: 'parked', reason: 'thermal', canResume: false, windowMs: 0 }
    render(parked)
    expect(host.textContent).toContain('Your device is too warm')
    expect(host.textContent).not.toContain('Resume camera')
    act(() => host.querySelector('button')!.click())
    expect(onOpenRoll).toHaveBeenCalledOnce()
    expect(onResume).not.toHaveBeenCalled()

    render({ ...parked, canResume: true })
    expect(onResume).not.toHaveBeenCalled()
    act(() => host.querySelector('button')!.click())
    expect(onResume).toHaveBeenCalledOnce()

    render({ ...parked, state: 'running', reason: 'explicitResume' })
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('shows nothing for a park the device can serve again — a finished clip is not a tap gate', () => {
    // Every ended recording used to leave a black viewfinder behind
    // "Camera ready to resume". Camera.tsx now reopens such a park itself the
    // moment the surface is visible, so the card must stay out of the way.
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onResume = vi.fn()
    const onOpenRoll = vi.fn()
    const render = (budget: NativeCameraBudget) => act(() => root!.render(
      <CameraAvailability budget={budget} onResume={onResume} onOpenRoll={onOpenRoll} />,
    ))
    for (const reason of ['recordingFinished', 'windowExpired', 'entry', 'explicitResume'] as const) {
      render({ state: 'parked', reason, canResume: true, windowMs: 0 })
      expect(host.querySelector('[role=status]'), reason).toBeNull()
    }
    // The two parks that carry information still explain themselves.
    render({ state: 'parked', reason: 'unavailable', canResume: true, windowMs: 0 })
    expect(host.textContent).toContain('Camera could not start')
    expect(host.textContent).toContain('Resume camera')
    render({ state: 'parked', reason: 'thermal', canResume: true, windowMs: 0 })
    expect(host.textContent).toContain('cool')
    expect(host.textContent).toContain('Resume camera')
    // Never again the ambiguous headline that hid a routine park behind a tap.
    expect(host.textContent).not.toContain('Camera ready to resume')
  })

  it('recovers native state delivered before the camera listener mounts', () => {
    expect(readNativeCameraBudget()).toBeNull()
    const budget: NativeCameraBudget = { state: 'parked', reason: 'thermal', canResume: false, windowMs: 0 }
    Object.assign(window, { __poplurCameraBudget: budget })
    expect(readNativeCameraBudget()).toEqual(budget)
  })
})

describe('cameraParkPlan', () => {
  const parked = (reason: NativeCameraBudget['reason'], canResume: boolean): NativeCameraBudget =>
    ({ state: 'parked', reason, canResume, windowMs: 0 })

  it('never gates a park the device serves again on its own', () => {
    for (const reason of ['recordingFinished', 'windowExpired', 'explicitResume'] as const) {
      expect(cameraParkPlan(parked(reason, true)), reason).toEqual({ card: false, autoResume: true, graceMs: 0 })
    }
  })

  it('leaves entry to native, which reopens the window when its grant lands', () => {
    expect(cameraParkPlan(parked('entry', true))).toEqual({ card: false, autoResume: false, graceMs: 0 })
  })

  it('retries a resumable start failure once and holds the card for a beat', () => {
    // A transient "could not start" (device lock busy, input not yet attached)
    // recovers on its own or on this retry; the card must not flash for it.
    expect(cameraParkPlan(parked('unavailable', true))).toEqual({ card: true, autoResume: true, graceMs: 1200 })
    expect(cameraParkPlan(parked('unavailable', false))).toEqual({ card: true, autoResume: false, graceMs: 0 })
  })

  it('makes heat wait for a deliberate tap, with no grace and no auto-resume', () => {
    expect(cameraParkPlan(parked('thermal', true))).toEqual({ card: true, autoResume: false, graceMs: 0 })
    expect(cameraParkPlan(parked('thermal', false))).toEqual({ card: true, autoResume: false, graceMs: 0 })
  })

  it('shows nothing when running, recording, hidden, or absent', () => {
    expect(cameraParkPlan(null)).toEqual({ card: false, autoResume: false, graceMs: 0 })
    expect(cameraParkPlan({ state: 'running', reason: 'entry', canResume: false, windowMs: 0 }).card).toBe(false)
    expect(cameraParkPlan(parked('leftCamera', true)).card).toBe(false)
  })
})
