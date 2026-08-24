import { useEffect, useState } from 'react'
import { HOME } from './reach'
import { isNativeShell, postNativeEvent } from './nativeBridge'

export interface NearbyLocation {
  lat: number
  lng: number
  /** `device` is an actual fix; `fallback` is Toronto after location fails. */
  source: 'device' | 'fallback'
}

function parseLocation(value: unknown): NearbyLocation | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as {
    latitude?: unknown
    longitude?: unknown
    detail?: unknown
    data?: unknown
    type?: unknown
  }
  if (payload.detail && typeof payload.detail === 'object') return parseLocation(payload.detail)
  if (payload.data && typeof payload.data === 'object') return parseLocation(payload.data)
  const lat = Number(payload.latitude)
  const lng = Number(payload.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, source: 'device' }
}

function fallbackLocation(): NearbyLocation {
  return { lat: HOME[1], lng: HOME[0], source: 'fallback' }
}

/**
 * One native-first location flow for media discovery.
 *
 * The native shell already owns the OS location permission, so these screens
 * ask the shell for its fix and never trigger WKWebView/Chromium's second,
 * generic permission prompt. A plain browser legitimately uses its own
 * geolocation API. Both paths fall back to Poplur's Toronto home region so a
 * directory outage or denied permission leaves a usable, honestly-labelled
 * local catalogue rather than a spinner that never ends.
 */
export function useNearbyLocation(): NearbyLocation | null {
  const [location, setLocation] = useState<NearbyLocation | null>(() => {
    if (typeof window === 'undefined') return null
    return parseLocation((window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation)
  })

  useEffect(() => {
    let settled = Boolean(location)
    let disposed = false

    const accept = (value: unknown) => {
      const next = parseLocation(value)
      if (!next || disposed) return false
      settled = true
      setLocation(next)
      return true
    }
    const onLocation = (event: Event) => accept((event as CustomEvent).detail)
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null
      if (data?.type === 'poplur-location') accept(data)
    }

    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)

    accept((window as typeof window & { __poplurNativeLocation?: unknown }).__poplurNativeLocation)
    postNativeEvent({ type: 'requestLocation' })

    const timer = window.setTimeout(() => {
      if (settled || disposed) return
      if (!isNativeShell() && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          position => accept({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
          () => { if (!disposed) { settled = true; setLocation(fallbackLocation()) } },
          { timeout: 4_000, maximumAge: 600_000 },
        )
      } else {
        settled = true
        setLocation(fallbackLocation())
      }
    }, isNativeShell() ? 3_500 : 900)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
    }
    // The first render owns discovery. Later location broadcasts are handled
    // by the listeners above without reinstalling a second permission flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return location
}
