import React, { useEffect, useState, useSyncExternalStore } from 'react'
import {
  getRadioPlaybackState,
  onLiveStationChange,
  subscribeRadioPlayback,
} from './mapRadio'
import { mapRadioStatusLabel } from './mapRadioControl'

/** One quiet line under the Map's location; it exists only while Radio is on. */
export default function MapRadioStatusLabel({ className }: { className?: string }) {
  const playback = useSyncExternalStore(
    subscribeRadioPlayback,
    getRadioPlaybackState,
    getRadioPlaybackState,
  )
  const [stationName, setStationName] = useState<string | null>(null)

  useEffect(() => onLiveStationChange(setStationName), [])

  const label = mapRadioStatusLabel(playback, stationName)
  if (!label) return null

  return (
    <span
      className={className}
      data-map-radio-label=""
      aria-live="polite"
    >
      {label}
    </span>
  )
}
