import React, { useEffect, useRef, useState } from 'react'
import CameraRoll from './CameraRoll'
import ClayCornerButton from './ClayCornerButton'
import styles from './ViewHarness.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'

// Native shells: the REAL camera (AVCapture + ML detection, the previous
// versions' pipeline) renders BEHIND this WebView; this pane punches a
// transparent hole so it shows through, while the approved chrome/icons here
// drive the native camera over the bridge. The clay-buildings spoof exists
// ONLY for the plain browser preview and must NEVER appear in the real app —
// detection goes through the bridge's isNativeShell() (webkit handler OR
// PoplurNative), not a webkit-only probe that misses shells.
const NATIVE_SHELL = isNativeShell()

// Twin of the app's camera (post) tab — the Snapchat-style full-screen
// viewfinder from HomeView.swift + RecordCameraControlsOverlay.swift:
// full-bleed preview, clay flash top-left, clay flip top-right, poplur logo
// top-center. NO shutter button — the cube IS the camera button, and the home
// HUD (arrows, label, cube) floats over this view.
//
// The viewfinder is SPOOFED: it never calls getUserMedia (no permission
// prompt, no crash where capture is blocked — e.g. the prototype). A slow
// drifting clay-world scene stands in for the live feed so the chrome can be
// designed against a plausible frame; the native app swaps in the real camera.
//
// Vertical pager: `step` counts arrow presses (up = +1, down = -1). Up always
// slides UP, down always slides DOWN, and both directions wrap between the
// live viewfinder and the Camera Roll. Four stacked panels make the wrap
// seamless: [roll-lite · LIVE · ROLL · live-clone] — the outer two are only
// visible mid-slide, then the track snaps (no transition) back to the centre
// panel of the same page.
export default function Camera({ step = 0, onCloseRoll }: { step?: number; onCloseRoll?: () => void }) {
  const [flash, setFlash] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const page: 'live' | 'roll' = ((step % 2) + 2) % 2 === 0 ? 'live' : 'roll'

  const [pos, setPos] = useState(page === 'live' ? 1 : 2)
  const [animated, setAnimated] = useState(true)
  const prevStep = useRef(step)

  useEffect(() => {
    const delta = step - prevStep.current
    prevStep.current = step
    if (!delta) return
    setAnimated(true)
    setPos(p => {
      // If a wrap-snap is still pending, normalize to the centre first.
      const base = p === 0 ? 2 : p === 3 ? 1 : p
      return Math.max(0, Math.min(3, base + delta))
    })
  }, [step])

  // Wrap: after sliding onto an outer clone, snap (transition off) to the
  // centre panel showing the same page.
  useEffect(() => {
    if (pos !== 0 && pos !== 3) return
    const t = window.setTimeout(() => {
      setAnimated(false)
      setPos(pos === 0 ? 2 : 1)
    }, 560)
    return () => window.clearTimeout(t)
  }, [pos])

  useEffect(() => {
    if (animated) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setAnimated(true)) })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [animated])

  // Punch the transparent hole for the native viewfinder while the live page
  // is front (native shells) — the roll is a normal opaque screen. See
  // .camera-live in index.css.
  useEffect(() => {
    if (!NATIVE_SHELL || page !== 'live') return
    document.documentElement.classList.add('camera-live')
    return () => document.documentElement.classList.remove('camera-live')
  }, [page])

  const live = (key: string) => (
    <section key={key} className={styles.cameraFull} aria-label="Camera preview twin">
      {/* Spoofed live viewfinder — browser preview ONLY; every native shell
          shows the real camera through the transparent hole instead. */}
      {!NATIVE_SHELL && (
        <img
          className={`${styles.camSpoofFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
          src="clay_buildings.png"
          alt=""
          draggable={false}
        />
      )}
      {/* Screen-flash edge glow (FrontCameraFlashEdgeOverlay) when flash is on */}
      {flash && <div className={styles.camFlashEdge} aria-hidden="true" />}

      {/* Top chrome: clay flash (left) · poplur logo (center) · clay flip
          (right) — bare clay marks, no backing circles. */}
      <div className={`${styles.camCornerSlot} ${styles.camSlotLeft}`}>
        <ClayCornerButton
          kind="flash"
          active={flash}
          label={flash ? 'Flash on' : 'Flash off'}
          onPress={() => {
            setFlash(f => !f)
            postNativeEvent({ type: 'cameraControl', control: 'flash' })
          }}
        />
      </div>
      <img className={styles.camLogo} src="logo_text.png" alt="poplur" draggable={false} />
      <div className={`${styles.camCornerSlot} ${styles.camSlotRight}`}>
        <ClayCornerButton
          kind="flip"
          label="Switch camera"
          onPress={() => {
            setFacing(f => (f === 'user' ? 'environment' : 'user'))
            postNativeEvent({ type: 'cameraControl', control: 'flip' })
          }}
        />
      </div>
    </section>
  )

  return (
    <div className={styles.camPager} aria-label="Camera">
      <div
        className={animated ? styles.camPagerTrack : `${styles.camPagerTrack} ${styles.camPagerSnap}`}
        style={{ transform: `translateY(${-pos * 25}%)` }}
      >
        <CameraRoll lite />
        {live('live-a')}
        <CameraRoll onDeny={onCloseRoll} />
        {live('live-b')}
      </div>
    </div>
  )
}
