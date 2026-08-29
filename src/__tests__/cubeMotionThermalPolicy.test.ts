import { describe, expect, it } from 'vitest'
import {
  advanceCubeMotionLease,
  CAMCORDER_AIMING_FPS,
  cubeMotionFPS,
  cubeRendererCanWork,
  CUBE_MOTION_LEASE_MS,
  NAVIGATOR_PARALLAX_FPS,
} from '../cubeMotionThermalPolicy'

describe('cube thermal motion policy', () => {
  it('stops all Cube work when the surface is covered or backgrounded', () => {
    expect(cubeRendererCanWork({
      surfaceVisible: false,
      documentVisible: true,
      nativeLifecycleActive: true,
      displayActive: true,
    })).toBe(false)
    expect(cubeRendererCanWork({
      surfaceVisible: true,
      documentVisible: false,
      nativeLifecycleActive: true,
      displayActive: true,
    })).toBe(false)
    expect(cubeRendererCanWork({
      surfaceVisible: true,
      documentVisible: true,
      nativeLifecycleActive: false,
      displayActive: true,
    })).toBe(false)
    expect(cubeRendererCanWork({
      surfaceVisible: true,
      documentVisible: true,
      nativeLifecycleActive: true,
      displayActive: false,
    })).toBe(false)
  })

  it('caps ordinary parallax at 20 fps and camcorder aiming at 30 fps', () => {
    expect(cubeMotionFPS({ aiming: false, performanceFPS: 60, eligible: true }))
      .toBe(NAVIGATOR_PARALLAX_FPS)
    expect(cubeMotionFPS({ aiming: true, performanceFPS: 60, eligible: true }))
      .toBe(CAMCORDER_AIMING_FPS)
    expect(cubeMotionFPS({ aiming: true, performanceFPS: 15, eligible: true })).toBe(15)
    expect(cubeMotionFPS({ aiming: true, performanceFPS: 60, eligible: false })).toBe(0)
  })

  it('lets jitter animate only inside a bounded meaningful-motion lease', () => {
    const opened = advanceCubeMotionLease({
      now: 100,
      current: { until: 0, anchor: null },
      sample: { roll: 0.1, pitch: 0.2 },
      eligible: true,
    })
    expect(opened.meaningful).toBe(true)
    expect(opened.accepted).toBe(true)
    expect(opened.until).toBe(100 + CUBE_MOTION_LEASE_MS)

    const jitter = advanceCubeMotionLease({
      now: 3000,
      current: opened,
      sample: { roll: 0.102, pitch: 0.201 },
      eligible: true,
    })
    expect(jitter.meaningful).toBe(false)
    expect(jitter.accepted).toBe(true)
    expect(jitter.until).toBe(opened.until)

    const expiredJitter = advanceCubeMotionLease({
      now: opened.until + 1,
      current: jitter,
      sample: { roll: 0.103, pitch: 0.202 },
      eligible: true,
    })
    expect(expiredJitter.meaningful).toBe(false)
    expect(expiredJitter.accepted).toBe(false)
    expect(expiredJitter.until).toBe(opened.until)
  })

  it('reopens an expired lease only after a cumulative meaningful movement', () => {
    const current = {
      until: 1000,
      anchor: { roll: 0, pitch: 0, heading: Math.PI * 2 - 0.01 },
    }
    const wrappedHeadingJitter = advanceCubeMotionLease({
      now: 1200,
      current,
      sample: { heading: 0.01 },
      eligible: true,
    })
    expect(wrappedHeadingJitter.accepted).toBe(false)

    const moved = advanceCubeMotionLease({
      now: 1300,
      current: wrappedHeadingJitter,
      sample: { roll: 0.05, pitch: 0 },
      eligible: true,
    })
    expect(moved.meaningful).toBe(true)
    expect(moved.accepted).toBe(true)
    expect(moved.until).toBe(1300 + CUBE_MOTION_LEASE_MS)
  })
})
