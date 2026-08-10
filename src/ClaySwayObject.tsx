import React, { useEffect, useRef, useState } from 'react'
import { modelSprite } from './modelSprite'

// A supplied clay GLB shown as a real object on a screen you park on — the
// profile bell and the kodak camera.
//
// NO rAF LOOP and NO WebGL CONTEXT, deliberately. The obvious way to turn an
// object with the accelerometer is a live three.js canvas rendering every
// frame; on a screen the user parks on, that is exactly the continuous idle
// work that has been overheating this app, and it is a second GL context on
// budget Android besides. So the yaw angles are BAKED: modelSprite renders the
// GLB once per angle at build time, and a tilt event swaps which still is
// showing. Turning the phone costs one `img.src` write, and holding it still
// costs nothing at all.
//
// This also fixes what a CSS rotateY on a single flat sprite could never do —
// that skews one picture, so the object reads as the sticker it is. These are
// genuinely different renders of the model.

/** Yaw angles baked for the sway. Seven reads as a turning object and is few
 *  enough that the whole set stays a few KB of PNG. */
const SWAY_YAWS = [-24, -16, -8, 0, 8, 16, 24]
const CENTRE = 3 // index of yaw 0

/** How far the object turns for a given device tilt, and the ceiling on it.
 *  Clamped hard: this is an object catching the light, not a gimbal. */
const TILT_GAIN = 0.55
const TILT_MAX = 24

/**
 * iOS 13+ delivers NO deviceorientation events until permission is granted,
 * and only asks when requested from a user gesture. The profile camera has had
 * a sway handler for a while and it never ran, because the only
 * requestPermission() call sat inside beginCapture() — i.e. it was primed only
 * once you opened the photo-capture flow, so on a fresh visit to the profile
 * the object simply sat still. This primes it from the first touch anywhere on
 * the page instead, once per session.
 */
let motionPrimed = false
export function primeMotionPermission(): void {
  if (motionPrimed) return
  motionPrimed = true
  const DOE = (window as unknown as {
    DeviceOrientationEvent?: { requestPermission?: () => Promise<string> }
  }).DeviceOrientationEvent
  // Android and desktop have no requestPermission and fire events already.
  if (typeof DOE?.requestPermission !== 'function') return
  const ask = () => {
    window.removeEventListener('pointerdown', ask)
    try { void DOE.requestPermission?.() } catch { /* older platforms */ }
  }
  window.addEventListener('pointerdown', ask, { once: true, passive: true })
}

export default function ClaySwayObject({
  url,
  pitch = 15,
  size = 320,
  sway = false,
  className,
  alt = '',
}: {
  url: string
  pitch?: number
  size?: number
  /** Turn with the device. Off = one baked still. */
  sway?: boolean
  className?: string
  alt?: string
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const framesRef = useRef<string[]>([])
  const shownRef = useRef(CENTRE)
  const [centre, setCentre] = useState<string | null>(null)

  // Bake requests. Non-swaying objects ask for the centre angle only, so the
  // bell costs one sprite rather than seven.
  useEffect(() => {
    let cancelled = false
    const yaws = sway ? SWAY_YAWS : [0]
    Promise.all(yaws.map(yaw => modelSprite(url, { yaw, pitch, size })))
      .then(frames => {
        if (cancelled) return
        framesRef.current = frames
        setCentre(sway ? frames[CENTRE] : frames[0])
      })
      .catch(() => { /* falls back to nothing drawn rather than a broken img */ })
    return () => { cancelled = true }
  }, [url, pitch, size, sway])

  useEffect(() => {
    if (!sway) return
    primeMotionPermission()
    const onOrient = (e: DeviceOrientationEvent) => {
      const frames = framesRef.current
      if (frames.length < SWAY_YAWS.length) return
      // gamma is left/right tilt — the side-to-side turn asked for.
      const yaw = Math.max(-TILT_MAX, Math.min(TILT_MAX, (e.gamma ?? 0) * TILT_GAIN))
      // Nearest baked angle. Writing only on CHANGE keeps a still hand at zero
      // cost — a shaky one costs an img.src assignment, not a render.
      let best = 0
      for (let i = 1; i < SWAY_YAWS.length; i++) {
        if (Math.abs(SWAY_YAWS[i] - yaw) < Math.abs(SWAY_YAWS[best] - yaw)) best = i
      }
      if (best === shownRef.current) return
      shownRef.current = best
      const img = imgRef.current
      if (img) img.src = frames[best]
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [sway])

  if (!centre) return null
  return <img ref={imgRef} src={centre} className={className} alt={alt} draggable={false} />
}
