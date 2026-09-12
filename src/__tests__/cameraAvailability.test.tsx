// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cameraParkPlan, readNativeCameraBudget, type NativeCameraBudget } from '../CameraAvailability'

afterEach(() => {
  delete (window as Window & { __poplurCameraBudget?: NativeCameraBudget }).__poplurCameraBudget
})
const parked = (reason: NativeCameraBudget['reason'], canResume: boolean): NativeCameraBudget =>
  ({ state: 'parked', reason, canResume, windowMs: 0 })

describe('quiet native camera interruptions', () => {
  it('removes the interruption card from the viewfinder', () => {
    const camera = readFileSync(`${process.cwd()}/src/Camera.tsx`, 'utf8')
    expect(camera).not.toContain('<CameraAvailability')
    expect(camera).not.toContain('parkedCardHeld')
  })
  it('retries ordinary resumable interruptions', () => {
    for (const reason of ['recordingFinished', 'windowExpired', 'explicitResume', 'unavailable'] as const) {
      expect(cameraParkPlan(parked(reason, true)).autoResume, reason).toBe(true)
      expect(cameraParkPlan(parked(reason, false)).autoResume, reason).toBe(false)
    }
  })
  it('retains native thermal protection and entry ownership', () => {
    for (const reason of ['thermal', 'entry', 'leftCamera'] as const) {
      for (const canResume of [false, true]) {
        expect(cameraParkPlan(parked(reason, canResume)).autoResume, reason).toBe(false)
      }
    }
  })
  it('does not request a running, recording, or absent camera', () => {
    expect(cameraParkPlan(null).autoResume).toBe(false)
    for (const state of ['running', 'recording'] as const) {
      expect(cameraParkPlan({ ...parked('explicitResume', true), state }).autoResume).toBe(false)
    }
  })
  it('recovers bridge state delivered before the camera mounts', () => {
    expect(readNativeCameraBudget()).toBeNull()
    const budget = parked('thermal', false)
    Object.assign(window, { __poplurCameraBudget: budget })
    expect(readNativeCameraBudget()).toEqual(budget)
  })
})
