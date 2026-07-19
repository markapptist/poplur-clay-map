import React, { useState, useRef, useEffect, useCallback } from 'react'
import styles from './ViewHarness.module.css'

// Corner control glyphs (previous-app-version camera chrome).
const FLASH_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" fill="#ffd84d" stroke="#8a6a00" stroke-width="1" stroke-linejoin="round"/></svg>'
const FLASH_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><line x1="3" y1="3" x2="21" y2="21" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'
const SWITCH = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a8 8 0 0 1 13.5-3.5L20 7"/><path d="M20 3v4h-4"/><path d="M20 16a8 8 0 0 1-13.5 3.5L4 17"/><path d="M4 21v-4h4"/></svg>'

// Self-contained camera tab. Shows a real webcam feed (getUserMedia) with
// flash + switch-camera corner controls; falls back to the clay stage when no
// camera is available (denied / insecure context / no device).
export default function Camera() {
  const [mode, setMode] = useState<'photo' | 'video' | 'live'>('photo')
  const [recording, setRecording] = useState(false)
  const [flash, setFlash] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [live, setLive] = useState(false)
  const [pulse, setPulse] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setLive(true)
    } catch {
      setLive(false)
    }
  }, [facing])

  useEffect(() => {
    start()
    return () => streamRef.current?.getTracks().forEach(t => t.stop())
  }, [start])

  const capture = () => {
    if (mode === 'photo') {
      if (flash) { setPulse(true); window.setTimeout(() => setPulse(false), 280) }
    } else {
      setRecording(r => !r)
    }
  }

  return (
    <section className={styles.cameraScreen}>
      <div className={styles.cameraPreview}>
        <video
          ref={videoRef}
          className={`${styles.cameraFeed} ${facing === 'user' ? styles.cameraFeedMirror : ''}`}
          autoPlay
          muted
          playsInline
        />
        {/* Clay fallback when no camera stream is available */}
        {!live && (
          <div className={styles.cameraSubject}>
            <img src="clay_pin.png" alt="" draggable="false" />
          </div>
        )}
        <div className={styles.gridLines} />
        <div className={styles.focusBox} />

        {/* Top chrome: flash (left) · poplur logo (center) · switch camera (right) */}
        <button
          type="button"
          className={`${styles.camCorner} ${styles.camCornerLeft} ${flash ? styles.camCornerOn : ''}`}
          onClick={() => setFlash(f => !f)}
          aria-label={flash ? 'Flash on' : 'Flash off'}
          aria-pressed={flash}
          dangerouslySetInnerHTML={{ __html: flash ? FLASH_ON : FLASH_OFF }}
        />
        <img className={styles.camLogo} src="logo_text.png" alt="poplur" draggable="false" />
        <button
          type="button"
          className={`${styles.camCorner} ${styles.camCornerRight}`}
          onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}
          aria-label="Switch camera"
          dangerouslySetInnerHTML={{ __html: SWITCH }}
        />

        <div className={styles.cameraHud}>
          <span>{mode.toUpperCase()}</span>
          <strong>{recording ? '00:12' : live ? 'Ready' : 'No camera'}</strong>
        </div>
        {pulse && <div className={styles.camFlashPulse} aria-hidden="true" />}
      </div>

      <div className={styles.filterRail}>
        {['original', 'pop tv', 'clay', 'night'].map(filter => (
          <button key={filter} type="button">{filter}</button>
        ))}
      </div>

      <div className={styles.modeRail}>
        {(['photo', 'video', 'live'] as const).map(item => (
          <button
            key={item}
            type="button"
            className={mode === item ? styles.controlOn : undefined}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={recording ? styles.captureRecording : styles.captureButton}
        onClick={capture}
        aria-label={recording ? 'Stop recording' : 'Capture'}
      >
        <span />
      </button>
    </section>
  )
}
