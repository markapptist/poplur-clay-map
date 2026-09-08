import { useEffect, useRef, useState } from 'react'
import { playRadiusCounterDone, playRadiusCounterTick } from './motionEffectsAudio'

/** At most 18 text updates per selection, then no work until the next one. */
export function useRadiusCounter({ radius, ceiling, active, recountKey, continueCount }: {
  radius: number; ceiling: number; active: boolean; recountKey: string | null; continueCount: boolean
}) {
  const [display, setDisplay] = useState({ shown: radius, shownCeiling: ceiling, counting: false })
  const displayed = useRef(display)
  const previous = useRef({ active: false, radius, recountKey })
  useEffect(() => {
    const arriving = active && !previous.current.active
    const changed = recountKey != null && (previous.current.recountKey !== recountKey || previous.current.radius !== radius)
    previous.current = { active, radius, recountKey }
    let timer = 0
    const publish = (shown: number, shownCeiling: number, counting: boolean) => {
      displayed.current = { shown, shownCeiling, counting }; setDisplay(displayed.current)
    }
    const settle = () => { window.clearTimeout(timer); publish(radius, ceiling, false) }
    const nativeActive = (window as Window & { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive !== false
    if (!active || document.hidden || !nativeActive || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !(arriving || changed)) {
      settle(); return
    }
    const from = continueCount ? displayed.current.shown : 0
    const ceilingFrom = continueCount ? displayed.current.shownCeiling : 0
    publish(from, ceilingFrom, true)
    const started = performance.now()
    const step = () => {
      const raw = Math.max(0, Math.min(1, (performance.now() - started) / 880))
      const eased = 1 - Math.pow(1 - raw, 2.35)
      publish(from + (radius - from) * eased, ceilingFrom + (ceiling - ceilingFrom) * eased, raw < 1)
      if (raw < 1) {
        playRadiusCounterTick(eased, continueCount)
        timer = window.setTimeout(step, 50)
      } else playRadiusCounterDone(continueCount)
    }
    const visibility = () => { if (document.hidden) settle() }
    const lifecycle = (event: Event) => { if ((event as CustomEvent).detail?.active === false) settle() }
    timer = window.setTimeout(step, 50)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('poplur-native-app-lifecycle', lifecycle)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('poplur-native-app-lifecycle', lifecycle)
    }
  }, [radius, ceiling, active, recountKey, continueCount])
  return display
}
