import { useLayoutEffect } from 'react'
import './immersiveControls.css'

/** Camera wakes on tap; Feed's cube explicitly reveals its rails. */
export function useImmersiveControls(enabled: boolean, context: string) {
  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.dataset.immersiveControls = 'true'
    let timer = 0
    const startsHidden = context === 'feed' || context === 'post'
    const hide = () => { root.dataset.controlsIdle = 'true' }
    const wake = () => {
      delete root.dataset.controlsIdle
      window.clearTimeout(timer)
      timer = window.setTimeout(hide, 10_000)
    }
    const input = () => {
      // Touches on the video must not reveal Feed rails. Once revealed,
      // controls remain available while the viewer uses them.
      if (context === 'feed' && root.dataset.controlsIdle === 'true') return
      wake()
      if (window.parent !== window) window.parent.postMessage({ type: 'poplur-controls-activity' }, '*')
      document.querySelectorAll('iframe').forEach(frame => frame.contentWindow?.postMessage({ type: 'poplur-controls-wake' }, '*'))
    }
    const message = (event: MessageEvent) => {
      if (context === 'feed') return
      const child = Array.from(document.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)
      if ((child && event.data?.type === 'poplur-controls-activity')
        || (event.source === window.parent && event.data?.type === 'poplur-controls-wake')) wake()
    }
    const reveal = () => { if (context === 'feed') wake() }
    const events = ['pointerdown', 'pointerup', 'wheel', 'keydown'] as const
    events.forEach(type => window.addEventListener(type, input, { capture: true, passive: true }))
    window.addEventListener('message', message)
    window.addEventListener('poplur-feed-reveal-controls', reveal)
    if (startsHidden) hide(); else wake()
    return () => {
      clearTimeout(timer)
      events.forEach(type => window.removeEventListener(type, input, true))
      window.removeEventListener('message', message)
      window.removeEventListener('poplur-feed-reveal-controls', reveal)
      delete root.dataset.immersiveControls
      delete root.dataset.controlsIdle
    }
  }, [enabled, context])
}
