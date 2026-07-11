import React, { useEffect, useRef, useState } from 'react'
import { getRadioMasterVolume, setRadioMasterVolume } from './mapRadio'
import { setWeatherMasterVolume } from './weatherAudio'
import styles from './VolumeBars.module.css'

// Web twin of the app's PoplurVolumeBars (VolumeOverlaySystem.swift): the
// 18-bar meter-green volume rail — same bar geometry (32×8, 6.4 gap, 64×320
// frame), same glow, same 1.1s auto-dim. Two adaptations for the web shell:
// it lives on the LEFT edge, and since there are no hardware volume buttons
// it is directly draggable. Mounted at the app shell so every view shares it.

const BAR_COUNT = 18            // matches iOS barCount
const METER_GREEN = '#3BFF2E'   // Color(red: 0.23, green: 1.0, blue: 0.18)
const AUTO_DIM_MS = 1100        // iOS hides after 1.1s

export default function VolumeBars() {
  const [level, setLevel] = useState(() => getRadioMasterVolume())
  const [awake, setAwake] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const dimTimer = useRef<number | null>(null)
  const dragging = useRef(false)

  const applyLevel = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value))
    setLevel(clamped)
    setRadioMasterVolume(clamped)
    setWeatherMasterVolume(clamped)
  }

  const wake = () => {
    setAwake(true)
    if (dimTimer.current !== null) window.clearTimeout(dimTimer.current)
    dimTimer.current = window.setTimeout(() => setAwake(false), AUTO_DIM_MS)
  }

  useEffect(() => () => {
    if (dimTimer.current !== null) window.clearTimeout(dimTimer.current)
  }, [])

  const levelFromPointer = (clientY: number) => {
    const rail = railRef.current
    if (!rail) return null
    const rect = rail.getBoundingClientRect()
    return 1 - (clientY - rect.top) / rect.height
  }

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const next = levelFromPointer(e.clientY)
    if (next !== null) applyLevel(next)
    wake()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const next = levelFromPointer(e.clientY)
    if (next !== null) applyLevel(next)
    wake()
  }
  const onPointerUp = () => { dragging.current = false }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') { applyLevel(level + 1 / BAR_COUNT); wake(); e.preventDefault() }
    if (e.key === 'ArrowDown') { applyLevel(level - 1 / BAR_COUNT); wake(); e.preventDefault() }
  }

  // Same active-bar math as the SwiftUI view.
  const activeLevel = Math.ceil(level * BAR_COUNT)

  return (
    <div
      ref={railRef}
      className={awake ? styles.railAwake : styles.rail}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => BAR_COUNT - 1 - i).map(index => {
        const active = index < activeLevel
        return (
          <div
            key={index}
            className={styles.bar}
            style={{
              background: METER_GREEN,
              opacity: active ? 1 : 0.18,
              boxShadow: active ? `0 0 3px ${METER_GREEN}8c` : 'none',
            }}
          />
        )
      })}
    </div>
  )
}
