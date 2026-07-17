import React, { useEffect, useRef, useState } from 'react'
import { getRadioMasterVolume, setRadioMasterVolume } from './mapRadio'
import { setWeatherMasterVolume } from './weatherAudio'
import { playPop } from './pop'
import styles from './VolumeBars.module.css'

// Web twin of the app's PoplurVolumeBars (VolumeOverlaySystem.swift), matched
// to its real behaviour: INVISIBLE at rest, appears only while the volume is
// being changed, then fades after 1.1s — exactly like the iOS hardware-press
// overlay. Adaptations for the web shell: bars ride the LEFT edge in Poplur
// brand pink, +/- clay buttons stand in for the phone's hardware keys, and
// every bar step lands with a faint Poplur pop. While the bars are awake they
// are also directly draggable. Mounted at the app shell = universal.

const BAR_COUNT = 18            // matches iOS barCount
const AUTO_DIM_MS = 1100        // iOS hides after 1.1s
const STEP = 1 / BAR_COUNT
const POP_VOLUME = 0.16         // faint tick per bar step

export default function VolumeBars() {
  const [level, setLevel] = useState(() => getRadioMasterVolume())
  const [awake, setAwake] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const dimTimer = useRef<number | null>(null)
  const dragging = useRef(false)
  const levelRef = useRef(level)

  const wake = () => {
    setAwake(true)
    if (dimTimer.current !== null) window.clearTimeout(dimTimer.current)
    dimTimer.current = window.setTimeout(() => setAwake(false), AUTO_DIM_MS)
  }

  const applyLevel = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value))
    // Faint pop each time the meter crosses a bar boundary, like a detent.
    if (Math.ceil(clamped * BAR_COUNT) !== Math.ceil(levelRef.current * BAR_COUNT)) {
      playPop(POP_VOLUME)
    }
    levelRef.current = clamped
    setLevel(clamped)
    setRadioMasterVolume(clamped)
    setWeatherMasterVolume(clamped)
    wake()
  }

  const step = (direction: 1 | -1) => {
    // Snap to whole bars so each press is one detent (and one pop).
    const bars = Math.round(levelRef.current * BAR_COUNT) + direction
    applyLevel(bars / BAR_COUNT)
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
    if (!awake) return // rail is only interactive while showing
    dragging.current = true
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const next = levelFromPointer(e.clientY)
    if (next !== null) applyLevel(next)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const next = levelFromPointer(e.clientY)
    if (next !== null) applyLevel(next)
  }
  const onPointerUp = () => { dragging.current = false }

  const activeLevel = Math.ceil(level * BAR_COUNT) // same math as SwiftUI

  return (
    <>
      <div
        ref={railRef}
        className={awake ? styles.railAwake : styles.rail}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-hidden={!awake}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => BAR_COUNT - 1 - i).map(index => (
          <div
            key={index}
            className={index < activeLevel ? styles.barOn : styles.barOff}
          />
        ))}
      </div>
    </>
  )
}
