import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CubeMotionLab.module.css'
import { DEFAULT_CUBE_MOTION_SENSITIVITY, DEFAULT_CUBE_MOTION_SMOOTHING } from './CubeTab3D'

const MAX_ROLL_RADIANS = Math.PI / 4
const MAX_PITCH_RADIANS = Math.PI / 2

function isMotionLabEnabled() {
  return new URLSearchParams(window.location.search).get('motion-lab') === '1'
}

function postMotion(roll: number, pitch: number) {
  window.dispatchEvent(new CustomEvent('poplur-native-motion', { detail: { roll, pitch } }))
}

function postTuning(sensitivity: number, smoothing: number) {
  window.dispatchEvent(new CustomEvent('poplur-motion-tuning', { detail: { sensitivity, smoothing } }))
}

/** Desktop-only device motion source. It deliberately emits the same native
    roll/pitch event the iOS bridge produces, rather than animating the cube
    separately, so tuning this surface is representative of a real handset. */
export default function CubeMotionLab() {
  const enabled = isMotionLabEnabled()
  const [closed, setClosed] = useState(false)
  const [roll, setRoll] = useState(0)
  const [pitch, setPitch] = useState(0)
  const [sensitivity, setSensitivity] = useState(DEFAULT_CUBE_MOTION_SENSITIVITY)
  const [smoothing, setSmoothing] = useState(DEFAULT_CUBE_MOTION_SMOOTHING)
  const padRef = useRef<HTMLDivElement>(null)
  const trackingRef = useRef<number | null>(null)

  const applyTilt = useCallback((nextRoll: number, nextPitch: number) => {
    const boundedRoll = Math.max(-MAX_ROLL_RADIANS, Math.min(MAX_ROLL_RADIANS, nextRoll))
    const boundedPitch = Math.max(-MAX_PITCH_RADIANS, Math.min(MAX_PITCH_RADIANS, nextPitch))
    setRoll(boundedRoll)
    setPitch(boundedPitch)
    postMotion(boundedRoll, boundedPitch)
  }, [])

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const bounds = padRef.current?.getBoundingClientRect()
    if (!bounds) return
    const horizontal = ((clientX - bounds.left) / bounds.width - 0.5) * 2
    const vertical = ((clientY - bounds.top) / bounds.height - 0.5) * 2
    applyTilt(horizontal * MAX_ROLL_RADIANS, vertical * MAX_PITCH_RADIANS)
  }, [applyTilt])

  const reset = useCallback(() => {
    applyTilt(0, 0)
    setSensitivity(DEFAULT_CUBE_MOTION_SENSITIVITY)
    setSmoothing(DEFAULT_CUBE_MOTION_SMOOTHING)
    postTuning(DEFAULT_CUBE_MOTION_SENSITIVITY, DEFAULT_CUBE_MOTION_SMOOTHING)
  }, [applyTilt])

  useEffect(() => {
    if (!enabled) return
    postTuning(sensitivity, smoothing)
    postMotion(roll, pitch)
  }, [enabled, pitch, roll, sensitivity, smoothing])

  useEffect(() => () => {
    if (!enabled) return
    postMotion(0, 0)
    postTuning(DEFAULT_CUBE_MOTION_SENSITIVITY, DEFAULT_CUBE_MOTION_SMOOTHING)
  }, [enabled])

  // Closing hands the cube back to real motion: neutral tilt, stock tuning.
  const close = () => {
    postMotion(0, 0)
    postTuning(DEFAULT_CUBE_MOTION_SENSITIVITY, DEFAULT_CUBE_MOTION_SMOOTHING)
    setClosed(true)
  }

  if (!enabled || closed) return null

  const tiltX = (roll / MAX_ROLL_RADIANS) * 38
  const tiltY = (pitch / MAX_PITCH_RADIANS) * 38
  const rollDegrees = Math.round((roll / Math.PI) * 180)
  const pitchDegrees = Math.round((pitch / Math.PI) * 180)

  return (
    <aside className={styles.lab} aria-label="Cube motion lab">
      <div className={styles.heading}>
        <span>ACCELEROMETER</span>
        <button type="button" className={styles.reset} onClick={reset}>Reset</button>
        <button type="button" className={styles.close} onClick={close} aria-label="Close motion lab">×</button>
      </div>
      <div className={styles.readout} aria-live="polite">
        <span>ROLL <output>{rollDegrees}°</output></span>
        <span>PITCH <output>{pitchDegrees}°</output></span>
      </div>
      <div
        ref={padRef}
        className={styles.pad}
        role="slider"
        aria-label="Simulated phone tilt"
        aria-valuetext={`Roll ${rollDegrees} degrees, pitch ${pitchDegrees} degrees`}
        tabIndex={0}
        onPointerDown={event => {
          trackingRef.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          updateFromPointer(event.clientX, event.clientY)
        }}
        onPointerMove={event => {
          if (trackingRef.current === event.pointerId) updateFromPointer(event.clientX, event.clientY)
        }}
        onPointerUp={event => {
          if (trackingRef.current === event.pointerId) trackingRef.current = null
        }}
        onPointerCancel={() => { trackingRef.current = null }}
        onKeyDown={event => {
          const step = event.shiftKey ? 0.12 : 0.045
          if (event.key === 'ArrowLeft') { event.preventDefault(); applyTilt(roll - step, pitch) }
          if (event.key === 'ArrowRight') { event.preventDefault(); applyTilt(roll + step, pitch) }
          if (event.key === 'ArrowUp') { event.preventDefault(); applyTilt(roll, pitch - step) }
          if (event.key === 'ArrowDown') { event.preventDefault(); applyTilt(roll, pitch + step) }
          if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); applyTilt(0, 0) }
        }}
      >
        <span className={styles.axisX} />
        <span className={styles.axisY} />
        <span className={styles.device} style={{ transform: `translate(calc(-50% + ${tiltX}px), calc(-50% + ${tiltY}px)) rotate(${-tiltX * 0.42}deg)` }} />
      </div>
      <label className={styles.control}>
        <span>SENSITIVITY <output>{sensitivity.toFixed(2)}x</output></span>
        <input type="range" min="0.35" max="0.85" step="0.01" value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} />
      </label>
      <label className={styles.control}>
        <span>SMOOTHING <output>{Math.round(smoothing)}%</output></span>
        <input type="range" min="55" max="94" step="1" value={smoothing} onChange={event => setSmoothing(Number(event.target.value))} />
      </label>
    </aside>
  )
}
