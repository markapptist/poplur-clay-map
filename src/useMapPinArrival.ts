import { useEffect, useRef } from 'react'
import type { PopPin } from './ClayMap'
import { feedPostIdFromPinId, isPostSeen } from './seenPosts'

export const PIN_ARRIVAL_SETTLE_MS = 350
export const PIN_ARRIVAL_SPACING_MS = 12_000
export const PIN_ARRIVAL_FEED_HOLD_MS = 1_100

/** Observe delivery, not camera bounds or marker mounting. A burst gets one
 * camera beat; the other arrivals keep their NEW badges. No polling loop. */
export function useMapPinArrival(options: {
  pins: readonly PopPin[]
  ready: boolean
  viewerKey: string | null
  visible: () => boolean
  available: () => boolean
  arrive: (pin: PopPin, openFeed: boolean) => (() => void) | undefined
}) {
  const latest = useRef(options); latest.current = options
  const delivered = useRef(new Set<string>())
  const initialized = useRef(false)
  const arrivalCount = useRef(0)
  const nextAllowedAt = useRef(0)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>()
  const cancelMove = useRef<(() => void) | undefined>()
  const nativeActive = useRef((window as Window & { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive !== false)

  useEffect(() => {
    delivered.current.clear(); initialized.current = false
    arrivalCount.current = 0; nextAllowedAt.current = 0
    const cancel = () => {
      clearTimeout(timer.current); timer.current = undefined; pending.current = null
      cancelMove.current?.(); cancelMove.current = undefined
    }
    const frontChanged = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin
        && (event.data?.type === 'poplur-map-front' || event.data?.type === 'poplur-map-action')) cancel()
    }
    const nativeChanged = (event: Event) => {
      const active = (event as CustomEvent).detail?.active
      if (typeof active === 'boolean') { nativeActive.current = active; if (!active) cancel() }
    }
    const inputs = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
    inputs.forEach(type => window.addEventListener(type, cancel, { capture: true, passive: true }))
    document.addEventListener('visibilitychange', cancel)
    window.addEventListener('message', frontChanged)
    window.addEventListener('poplur-native-app-lifecycle', nativeChanged)
    window.addEventListener('poplur-native-map-tap', cancel)
    return () => {
      cancel()
      inputs.forEach(type => window.removeEventListener(type, cancel, true))
      document.removeEventListener('visibilitychange', cancel)
      window.removeEventListener('message', frontChanged)
      window.removeEventListener('poplur-native-app-lifecycle', nativeChanged)
      window.removeEventListener('poplur-native-map-tap', cancel)
    }
  }, [options.viewerKey])

  useEffect(() => {
    if (!options.ready) return
    const fresh = options.pins.filter(pin => !delivered.current.has(pin.id))
    options.pins.forEach(pin => delivered.current.add(pin.id))
    // The first complete snapshot is the starting board, not an arrival.
    if (!initialized.current) { initialized.current = true; return }
    const isNew = (pin: PopPin) => !pin.mine && !pin.ghost && !isPostSeen(feedPostIdFromPinId(pin.id))
    const pin = fresh.find(isNew)
    if (!pin || !nativeActive.current || document.hidden || !options.visible() || !options.available()) return
    pending.current = pin.id
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      const current = latest.current
      const target = current.pins.find(candidate => candidate.id === pending.current)
      pending.current = null
      if (!current.ready || !target || !isNew(target) || !nativeActive.current || document.hidden || !current.visible() || !current.available()) return
      cancelMove.current?.()
      arrivalCount.current += 1
      nextAllowedAt.current = Date.now() + PIN_ARRIVAL_SPACING_MS
      cancelMove.current = current.arrive(target, arrivalCount.current % 2 === 0 && Boolean(target.media))
    }, Math.max(PIN_ARRIVAL_SETTLE_MS, nextAllowedAt.current - Date.now()))
  }, [options.pins, options.ready, options.viewerKey])
}
