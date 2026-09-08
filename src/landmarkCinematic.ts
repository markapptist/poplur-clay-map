import type mapboxgl from 'mapbox-gl'
import { wakeManagedRendering } from './nativeBridge'

export const LANDMARK_ORBIT_MS = 4600

/** A single dolly/orbit shot. It releases the camera on completion or input. */
export function startLandmarkOrbit(map: mapboxgl.Map, complete: () => void = () => {}): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { complete(); return () => {} }
  const camera = map as mapboxgl.Map & { __cinematic?: boolean; __tripping?: boolean }
  const canvas = map.getCanvas()
  let active = true
  let timer = 0
  const finish = (arrived: boolean) => {
    if (!active) return
    active = false
    clearTimeout(timer)
    map.off('moveend', onEnd)
    map.off('remove', cancel)
    canvas.removeEventListener('pointerdown', cancel)
    canvas.removeEventListener('wheel', cancel)
    window.removeEventListener('keydown', cancel)
    document.removeEventListener('visibilitychange', onVisibility)
    camera.__cinematic = false
    camera.__tripping = false
    if (arrived) complete()
  }
  const onEnd = () => finish(true)
  const cancel = () => { if (!active) return; finish(false); map.stop() }
  const onVisibility = () => { if (document.hidden) cancel() }
  camera.__cinematic = true
  camera.__tripping = true
  map.once('moveend', onEnd)
  map.once('remove', cancel)
  canvas.addEventListener('pointerdown', cancel, { once: true })
  canvas.addEventListener('wheel', cancel, { once: true, passive: true })
  window.addEventListener('keydown', cancel, { once: true })
  document.addEventListener('visibilitychange', onVisibility)
  timer = window.setTimeout(onEnd, LANDMARK_ORBIT_MS + 300)
  wakeManagedRendering(LANDMARK_ORBIT_MS + 500)
  try {
    map.easeTo({
      // Keeping the current framed centre preserves tall landmarks' headroom.
      center: map.getCenter(),
      zoom: Math.min(map.getMaxZoom(), map.getZoom() + .28),
      bearing: map.getBearing() + 48,
      pitch: Math.min(map.getMaxPitch(), map.getPitch() + 3),
      duration: LANDMARK_ORBIT_MS,
      easing: t => t * t * (3 - 2 * t),
      essential: false,
    })
  } catch { finish(true) }
  return cancel
}
