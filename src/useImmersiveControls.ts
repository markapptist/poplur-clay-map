import { useEffect } from 'react'
import './immersiveControls.css'

/** Input wakes chrome; one timeout retires it without a render loop. */
export function useImmersiveControls(enabled: boolean, context: string) {
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.dataset.immersiveControls = 'true'
    let timer = 0
    const wake = () => {
      delete root.dataset.controlsIdle
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { root.dataset.controlsIdle = 'true' }, 10_000)
    }
    const input = () => {
      wake()
      if (window.parent !== window) window.parent.postMessage({ type: 'poplur-controls-activity' }, '*')
      document.querySelectorAll('iframe').forEach(frame => frame.contentWindow?.postMessage({ type: 'poplur-controls-wake' }, '*'))
    }
    const message = (event: MessageEvent) => {
      const child = Array.from(document.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)
      if ((child && event.data?.type === 'poplur-controls-activity')
        || (event.source === window.parent && event.data?.type === 'poplur-controls-wake')) wake()
    }
    const events = ['pointerdown', 'pointerup', 'wheel', 'keydown'] as const
    events.forEach(type => window.addEventListener(type, input, { capture: true, passive: true }))
    window.addEventListener('message', message)
    wake()
    return () => {
      clearTimeout(timer)
      events.forEach(type => window.removeEventListener(type, input, true))
      window.removeEventListener('message', message)
      delete root.dataset.immersiveControls
      delete root.dataset.controlsIdle
    }
  }, [enabled, context])
}
