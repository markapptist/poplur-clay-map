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
