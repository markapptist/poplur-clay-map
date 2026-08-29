import type { RadiusRewardDiceFace } from './radiusRewardNavigator'
import type { PoplurPerformanceMode } from './poplurPerformanceManager'

export interface RadiusRewardDiceRotation {
  x: number
  y: number
  z: number
}

export interface RadiusRewardDiceTumbleSample {
  active: boolean
  progress: number
  rotation: RadiusRewardDiceRotation
}

/** One finite roll in the persistent navigator. The renderer samples this
 * motion from its existing demand-driven frame loop, then parks normally. */
export const RADIUS_REWARD_DICE_TUMBLE_MS = 960
export const RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS = 240
/** CSS blur is confined to the finite tumble and this small navigator surface.
 * The reduced ladder keeps the cue while reducing the compositing radius;
 * low-power and emergency modes skip the effect entirely. */
export const RADIUS_REWARD_DICE_MAX_BLUR_PX = 4
export const RADIUS_REWARD_DICE_REDUCED_MAX_BLUR_PX = 2.25

const HALF_PI = Math.PI / 2
const PI = Math.PI

/**
 * Resting Euler orientations for the authored Poplur die. The decoded asset's
 * calibrated normals are +Z=3, +Y=4 and +X=5; the three opposite normals are
 * assigned deterministically because their baked markings are intentionally
 * stylised. These rotations are applied to the fitted navigator group, so they
 * do not alter or duplicate the GLB.
 */
export function radiusRewardDiceFaceOrientation(
  face: RadiusRewardDiceFace,
): RadiusRewardDiceRotation {
  switch (face) {
    case 1: return { x: 0, y: PI, z: 0 }
    case 2: return { x: 0, y: HALF_PI, z: 0 }
    case 3: return { x: 0, y: 0, z: 0 }
    case 4: return { x: HALF_PI, y: 0, z: 0 }
    case 5: return { x: 0, y: -HALF_PI, z: 0 }
    case 6: return { x: -HALF_PI, y: 0, z: 0 }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * A bounded blur envelope for the already-running tumble loop. It starts soft
 * while angular velocity is highest, then reaches zero for the final tenth of
 * the roll so the selected face is crisp before it is announced as landed.
 * This creates no timer, animation or renderer of its own.
 */
export function radiusRewardDiceMotionBlurPx(
  progress: number,
  performanceMode: PoplurPerformanceMode,
  reducedMotion: boolean,
): number {
  if (!Number.isFinite(progress) || reducedMotion) return 0
  if (performanceMode === 'LOW_POWER' || performanceMode === 'EMERGENCY') return 0

  const safeProgress = clamp01(progress)
  // Hold most of the softness through the energetic rotations, then fade it
  // completely between 72% and 90%. The remaining landing frames are sharp.
  const landingFade = clamp01((0.9 - safeProgress) / 0.18)
  if (landingFade === 0) return 0
  const velocityEnvelope = 0.54 + 0.46 * Math.sqrt(1 - safeProgress)
  const maximum = performanceMode === 'FULL'
    ? RADIUS_REWARD_DICE_MAX_BLUR_PX
    : RADIUS_REWARD_DICE_REDUCED_MAX_BLUR_PX
  return Math.round(maximum * velocityEnvelope * landingFade * 100) / 100
}

export function radiusRewardDiceTumbleSample(
  elapsedMs: number,
  durationMs: number,
  face: RadiusRewardDiceFace,
  start: RadiusRewardDiceRotation = { x: 0, y: 0, z: 0 },
): RadiusRewardDiceTumbleSample {
  const safeDuration = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1)
  const progress = clamp01(elapsedMs / safeDuration)
  const eased = 1 - Math.pow(1 - progress, 3)
  const target = radiusRewardDiceFaceOrientation(face)
  const wobble = Math.sin(progress * PI * 5) * (1 - progress) * 0.16

  return {
    active: progress < 1,
    progress,
    rotation: {
      x: start.x + (PI * 4 + target.x - start.x) * eased,
      y: start.y + (PI * 6 + target.y - start.y) * eased,
      z: start.z + (PI * 2 + target.z - start.z) * eased + wobble,
    },
  }
}
