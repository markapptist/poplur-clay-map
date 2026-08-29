export const NAVIGATOR_PARALLAX_FPS = 20
export const CAMCORDER_AIMING_FPS = 30

/**
 * A real wrist movement buys a short responsive window. Sensor noise inside
 * that window is allowed to interpolate smoothly, but it cannot renew the
 * window forever merely because a held phone never reports an identical pose.
 */
export const CUBE_MOTION_LEASE_MS = 6000
export const CUBE_MEANINGFUL_MOTION_RADIANS = Math.PI / 90 // 2 degrees

export type CubeMotionSample = {
  roll?: number
  pitch?: number
  heading?: number
}

export type CubeMotionLease = {
  until: number
  anchor: CubeMotionSample | null
}

export function cubeRendererCanWork({
  surfaceVisible,
  documentVisible,
  nativeLifecycleActive,
  displayActive,
}: {
  surfaceVisible: boolean
  documentVisible: boolean
  nativeLifecycleActive: boolean
  displayActive: boolean
}): boolean {
  return surfaceVisible && documentVisible && nativeLifecycleActive && displayActive
}

export function cubeMotionFPS({
  aiming,
  performanceFPS,
  eligible,
}: {
  aiming: boolean
  performanceFPS: number
  eligible: boolean
}): number {
  if (!eligible || performanceFPS <= 0) return 0
  return Math.max(1, Math.min(
    performanceFPS,
    aiming ? CAMCORDER_AIMING_FPS : NAVIGATOR_PARALLAX_FPS,
  ))
}

function wrappedAngleDelta(a: number, b: number): number {
  let delta = a - b
  delta -= Math.round(delta / (Math.PI * 2)) * (Math.PI * 2)
  return Math.abs(delta)
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function advanceCubeMotionLease({
  now,
  current,
  sample,
  eligible,
  meaningfulDelta = CUBE_MEANINGFUL_MOTION_RADIANS,
  leaseMs = CUBE_MOTION_LEASE_MS,
}: {
  now: number
  current: CubeMotionLease
  sample: CubeMotionSample
  eligible: boolean
  meaningfulDelta?: number
  leaseMs?: number
}): CubeMotionLease & { accepted: boolean; meaningful: boolean } {
  if (!eligible) {
    return { until: 0, anchor: current.anchor, accepted: false, meaningful: false }
  }

  const axes = (['roll', 'pitch', 'heading'] as const).filter(axis => finite(sample[axis]))
  const hasSample = axes.length > 0
  const meaningful = hasSample && (
    current.anchor === null
    || axes.some(axis => {
      const next = sample[axis]
      const prior = current.anchor?.[axis]
      if (!finite(next)) return false
      if (!finite(prior)) return true
      return axis === 'heading'
        ? wrappedAngleDelta(next, prior) >= meaningfulDelta
        : Math.abs(next - prior) >= meaningfulDelta
    })
  )

  const until = meaningful ? now + leaseMs : current.until
  const anchor = meaningful
    ? { ...(current.anchor ?? {}), ...sample }
    : current.anchor

  return {
    until,
    anchor,
    accepted: hasSample && now < until,
    meaningful,
  }
}
