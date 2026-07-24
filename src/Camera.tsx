import React, { useState } from 'react'
import styles from './ViewHarness.module.css'

// Corner control glyphs (ported from RecordCameraControlsOverlay.swift:
// bolt / bolt.slash top-left, flip-camera top-right).
const FLASH_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" fill="#ffd84d" stroke="#8a6a00" stroke-width="1" stroke-linejoin="round"/></svg>'
const FLASH_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><line x1="3" y1="3" x2="21" y2="21" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'
const SWITCH = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a8 8 0 0 1 13.5-3.5L20 7"/><path d="M20 3v4h-4"/><path d="M20 16a8 8 0 0 1-13.5 3.5L4 17"/><path d="M4 21v-4h4"/></svg>'

// Twin of the app's camera (post) tab — the Snapchat-style full-screen
// viewfinder from HomeView.swift + RecordCameraControlsOverlay.swift:
// full-bleed preview, flash top-left, flip top-right, poplur logo top-center,
// camera-roll thumb bottom-right. NO shutter button — the cube IS the camera
// button, and the home HUD (arrows, label, cube) floats over this view.
//
// The viewfinder is SPOOFED: it never calls getUserMedia (no permission
// prompt, no crash where capture is blocked — e.g. the prototype). A slow
// drifting clay-world scene stands in for the live feed so the chrome can be
// designed against a plausible frame; the native app swaps in the real camera.
export default function Camera() {
  const [flash, setFlash] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')

  return (
    <section className={styles.cameraFull} aria-label="Camera preview twin">
      {/* Spoofed live viewfinder — drifts slowly so it reads as a camera */}
      <img
        className={`${styles.camSpoofFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
        src="clay_buildings.png"
        alt=""
        draggable={false}
      />
      <div className={styles.gridLines} />
      <div className={styles.focusBox} />

      {/* Screen-flash edge glow (FrontCameraFlashEdgeOverlay) when flash is on */}
      {flash && <div className={styles.camFlashEdge} aria-hidden="true" />}

      {/* Top chrome: flash (left) · poplur logo (center) · flip camera (right) */}
      <button
        type="button"
        className={`${styles.camCorner} ${styles.camCornerLeft} ${flash ? styles.camCornerOn : ''}`}
        onClick={() => setFlash(f => !f)}
        aria-label={flash ? 'Flash on' : 'Flash off'}
        aria-pressed={flash}
        dangerouslySetInnerHTML={{ __html: flash ? FLASH_ON : FLASH_OFF }}
      />
      <img className={styles.camLogo} src="logo_text.png" alt="poplur" draggable={false} />
      <button
        type="button"
        className={`${styles.camCorner} ${styles.camCornerRight}`}
        onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}
        aria-label="Switch camera"
        dangerouslySetInnerHTML={{ __html: SWITCH }}
      />

      {/* Camera roll (bottom-right, above the HUD band — CameraRollButton) */}
      <button type="button" className={styles.camRoll} aria-label="Open camera roll">
        <img src="clay_pin_small.png" alt="" draggable={false} />
      </button>
    </section>
  )
}
