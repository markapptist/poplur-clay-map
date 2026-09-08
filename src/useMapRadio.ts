import { useEffect, useRef } from 'react'
import { onGateChange } from './audioGate'
import { onAudioFocusChange } from './audioFocus'
import { startDefaultMapRadio, stopMapRadio, tuneMapRadioLocation } from './mapRadio'
import type { MapRadioLocation } from './mapRadioLocation'

/** The shell owns one Map player, whether the map is native or an iframe. */
export function useMapRadio(visible: boolean, location: MapRadioLocation | null): void {
  const locationRef = useRef(location)
  locationRef.current = location
  useEffect(() => {
    if (!visible) return
    const start = () => startDefaultMapRadio(locationRef.current?.lat, locationRef.current?.lng)
    start()
    const unsubscribe = onGateChange(start)
    let interruptedByVoice = false
    const offFocus = onAudioFocusChange(owner => {
      if (owner === 'voice') interruptedByVoice = true
      else if (owner === null && interruptedByVoice) { interruptedByVoice = false; start() }
    })
    return () => { unsubscribe(); offFocus(); stopMapRadio() }
  }, [visible])
  useEffect(() => {
    if (visible && location) tuneMapRadioLocation(location.lat, location.lng)
  }, [visible, location?.lat, location?.lng])
}
