import type { Map } from 'mapbox-gl'
import { programmaticCameraPoseMatches } from './programmaticCameraMotion'

type CutCamera = Pick<Map, 'getCenter' | 'getZoom' | 'getPitch' | 'getBearing' | 'isMoving' | 'on' | 'off' | 'easeTo'>
type CutFrame = Parameters<Map['easeTo']>[0] & { center: [number, number]; zoom: number; pitch: number; bearing: number }

/** One destination frame on web or native. A queued idle from the previous
 * native command must not complete the new selection. */
export function cutMapCamera(map: CutCamera, frame: CutFrame, onArrival: () => void): () => void {
  let finished = false
  const cancel = () => { finished = true; map.off('moveend', arrived) }
  const arrived = () => {
    if (finished) return
    const center = map.getCenter()
    const longitudeDelta = Math.abs(((center.lng - frame.center[0] + 540) % 360) - 180)
    if (longitudeDelta > 0.02 || Math.abs(center.lat - frame.center[1]) > 0.02) return
    if (!programmaticCameraPoseMatches(
      { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, frame,
    )) return
    cancel()
    onArrival()
  }
  map.on('moveend', arrived)
  try {
    map.easeTo({ ...frame, duration: 0, essential: true })
    if (!map.isMoving()) arrived()
  } catch (error) { cancel(); throw error }
  return cancel
}
