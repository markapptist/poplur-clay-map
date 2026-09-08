import { useEffect, useRef } from 'react'
import { currentQuality, onQualityChange } from './frameGovernor'

export const MAP_IDLE_START_MS = 20_000
export const MAP_IDLE_STOP_SPACING_MS = 30_000
export type IdleMapDiagnostics = { policy: string; autonomousCameraStarts: number; explicitTourStarts: number; idleTimerArmed: boolean; flightActive: boolean }

/** A sparse sequence of finite camera moves, with no ticking clock during the
 * still holds. Native pressure, visibility and every real input cancel it. */
export function useIdleMapBroadcast(options: {
  enabled: boolean
  visible: () => boolean
  available: () => boolean
  explore: () => (() => void) | undefined
  diagnostics: IdleMapDiagnostics
}) {
  const latest = useRef(options); latest.current = options
  const controls = useRef({ restart: () => {}, stop: () => {} })
  useEffect(() => {
    if (!options.enabled) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer = 0, cancelMove: (() => void) | undefined
    const stop = () => {
      window.clearTimeout(timer); timer = 0
      latest.current.diagnostics.idleTimerArmed = false
      cancelMove?.(); cancelMove = undefined
      latest.current.diagnostics.flightActive = false
    }
    let nativeActive = (window as Window & { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive !== false
    const visible = () => nativeActive && !document.hidden && latest.current.visible() && currentQuality() > 1 && !reduced.matches
    const arm = (delay: number) => {
      if (!visible()) return
      latest.current.diagnostics.idleTimerArmed = true
      timer = window.setTimeout(() => {
        timer = 0; latest.current.diagnostics.idleTimerArmed = false
        if (!visible()) { stop(); return }
        cancelMove?.(); cancelMove = undefined
        if (latest.current.available()) cancelMove = latest.current.explore()
        arm(MAP_IDLE_STOP_SPACING_MS)
      }, delay)
    }
    const restart = () => { stop(); arm(MAP_IDLE_START_MS) }
    Object.assign(controls.current, { restart, stop })
    const frontChanged = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin
        && ['poplur-map-front', 'poplur-map-action'].includes(event.data?.type)) restart()
    }
    const nativeChanged = (event: Event) => {
      const active = (event as CustomEvent).detail?.active
      if (typeof active === 'boolean') { nativeActive = active; restart() }
    }
    const inputs = ['pointerdown', 'pointerup', 'touchstart', 'wheel', 'keydown'] as const
    const inputOptions = { passive: true, capture: true }
    inputs.forEach(name => document.addEventListener(name, restart, inputOptions))
    document.addEventListener('visibilitychange', restart)
    window.addEventListener('message', frontChanged)
    window.addEventListener('poplur-native-app-lifecycle', nativeChanged)
    reduced.addEventListener('change', restart)
    const unsubscribe = onQualityChange(restart)
    restart()
    return () => {
      stop(); unsubscribe()
      inputs.forEach(name => document.removeEventListener(name, restart, inputOptions))
      document.removeEventListener('visibilitychange', restart)
      window.removeEventListener('message', frontChanged)
      window.removeEventListener('poplur-native-app-lifecycle', nativeChanged)
      reduced.removeEventListener('change', restart)
      Object.assign(controls.current, { restart: () => {}, stop: () => {} })
    }
  }, [options.enabled])
  return controls
}
