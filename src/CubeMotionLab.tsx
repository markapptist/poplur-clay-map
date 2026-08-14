import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CubeMotionLab.module.css'

const MAX_TILT_RADIANS = 0.72

function isMotionLabEnabled() {
  return new URLSearchParams(window.location.search).get('motion-lab') === '1'
}

function postMotion(roll: number, pitch: number) {
  window.dispatchEvent(new CustomEvent('poplur-native-motion', { detail: { roll, pitch } }))
}

function postTuning(gain: number, response: number) {
  window.dispatchEvent(new CustomEvent('poplur-motion-tuning', { detail: { gain, response } }))
}

/** Desktop-only device motion source. It deliberately emits the same native
    roll/pitch event the iOS bridge produces, rather than animating the cube
    separately, so tuning this surface is representative of a real handset. */
export default function CubeMotionLab() {
  const enabled = isMotionLabEnabled()
  const [roll, setRoll] = useState(0)
  const [pitch, setPitch] = useState(0)
  const [gain, setGain] = useState(1)
  const [response, setResponse] = useState(18)
  const padRef = useRef<HTMLDivElement>(null)
  const trackingRef = useRef<number | null>(null)

  const applyTilt = useCallback((nextRoll: number, nextPitch: number) => {
    const boundedRoll = Math.max(-MAX_TILT_RADIANS, Math.min(MAX_TILT_RADIANS, nextRoll))
    const boundedPitch = Math.max(-MAX_TILT_RADIANS, Math.min(MAX_TILT_RADIANS, nextPitch))
    setRoll(boundedRoll)
    setPitch(boundedPitch)
    postMotion(boundedRoll, boundedPitch)
  }, [])

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const bounds = padRef.current?.getBoundingClientRect()
    if (!bounds) return
    const horizontal = ((clientX - bounds.left) / bounds.width - 0.5) * 2
    const vertical = ((clientY - bounds.top) / bounds.height - 0.5) * 2
    applyTilt(horizontal * MAX_TILT_RADIANS, vertical * MAX_TILT_RADIANS)
  }, [applyTilt])

  const reset = useCallback(() => {
    applyTilt(0, 0)
    setGain(1)
    setResponse(18)
    postTuning(1, 18)
  }, [applyTilt])

  useEffect(() => {
    if (!enabled) return
    postTuning(gain, response)
    postMotion(roll, pitch)
  }, [enabled, gain, pitch, response, roll])

  useEffect(() => () => {
    if (!enabled) return
    postMotion(0, 0)
    postTuning(1, 18)
  }, [enabled])

  if (!enabled) return null

  const tiltX = (roll / MAX_TILT_RADIANS) * 38
  const tiltY = (pitch / MAX_TILT_RADIANS) * 38

  return (
    <aside className={styles.lab} aria-label="Cube motion lab">
      <div className={styles.heading}>
        <span>MOTION LAB</span>
        <button type="button" className={styles.reset} onClick={reset}>Reset</button>
      </div>
      <div
        ref={padRef}
        className={styles.pad}
        role="slider"
        aria-label="Simulated phone tilt"
        aria-valuetext={`Roll ${Math.round((roll / MAX_TILT_RADIANS) * 45)} degrees, pitch ${Math.round((pitch / MAX_TILT_RADIANS) * 45)} degrees`}
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
        <span>GAIN <output>{gain.toFixed(2)}x</output></span>
        <input type="range" min="0.45" max="1.65" step="0.05" value={gain} onChange={event => setGain(Number(event.target.value))} />
      </label>
      <label className={styles.control}>
        <span>RESPONSE <output>{Math.round(response)}</output></span>
        <input type="range" min="6" max="34" step="1" value={response} onChange={event => setResponse(Number(event.target.value))} />
      </label>
    </aside>
  )
}
