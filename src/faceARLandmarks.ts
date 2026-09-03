import type { Detection } from './mlDetect'

function usablePoint(point: { x: number, y: number } | undefined) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    ? point
    : null
}

/** Keep an accessory centred on Vision's eye line when it is available. The
 * small downward correction preserves the established face-centre coordinate
 * system while removing box jitter as a head turns. */
export function faceAccessoryAnchor(face: Detection) {
  const leftEye = usablePoint(face.landmarks?.leftEye)
  const rightEye = usablePoint(face.landmarks?.rightEye)
  if (!leftEye || !rightEye) {
    return { x: face.x + face.w * 0.5, y: face.y + face.h * 0.5 }
  }
  return {
    x: (leftEye.x + rightEye.x) * 0.5,
    y: (leftEye.y + rightEye.y) * 0.5 + face.h * 0.08,
  }
}

/** The pose actually on screen, eased towards whatever the tracker last said. */
export type DrawnPose = { x: number, y: number, w: number, h: number, roll: number, yaw: number }

/**
 * How far to move towards a new reading, on a frame this long.
 *
 * A half-life rather than a per-frame fraction, because the frame governor
 * steps the AR lane between 5 and 20fps: a fixed fraction would damp
 * differently at every rate, so the accessory would slacken and tighten as
 * thermal pressure moved the frame rate under it. A half-life settles in the
 * same real time whatever the rate.
 */
export function poseEase(elapsedMs: number, halfLifeMs = 90) {
  if (!(elapsedMs > 0) || !(halfLifeMs > 0)) return 1
  return 1 - Math.pow(0.5, elapsedMs / halfLifeMs)
}

/**
 * Glide the drawn pose towards the tracker's reading.
 *
 * The tracker publishes roughly three times a second, so without this the
 * accessory teleports in ~350ms hops however many frames are drawn — which is
 * what "the filters are slow" actually described. `was` of null means the face
 * was only just acquired: snap to it, or the accessory sails across the frame
 * from wherever the previous face happened to be standing.
 */
export function easePose(was: DrawnPose | null, target: DrawnPose, ease: number): DrawnPose {
  if (!was) return target
  const k = Math.min(1, Math.max(0, ease))
  return {
    x: was.x + (target.x - was.x) * k,
    y: was.y + (target.y - was.y) * k,
    w: was.w + (target.w - was.w) * k,
    h: was.h + (target.h - was.h) * k,
    roll: was.roll + (target.roll - was.roll) * k,
    yaw: was.yaw + (target.yaw - was.yaw) * k,
  }
}
