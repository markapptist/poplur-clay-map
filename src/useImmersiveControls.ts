import { useLayoutEffect } from 'react'
import './immersiveControls.css'

/** Camera wakes on tap; Feed's cube explicitly reveals its rails. */
export function useImmersiveControls(enabled: boolean, context: string) {
  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.dataset.immersiveControls = 'true'
    // Which surface owns the sleep. The map and feed keep their cube and HUD
    // lit while idle — they are how you leave. An opened profile post is a
    // viewer: the pop should be the only thing on screen, so its rule below
    // takes the bottom HUD and the cube too. Without this the sleep faded the
    // rails and the radius tower and left the rest lit, which read as the
    // sleep not working at all.
    root.dataset.immersiveContext = context
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
    window.addEventListener('poplur-native-map-tap', input)
    window.addEventListener('poplur-feed-reveal-controls', reveal)
    if (startsHidden) hide(); else wake()
    return () => {
      clearTimeout(timer)
      events.forEach(type => window.removeEventListener(type, input, true))
      window.removeEventListener('message', message)
      window.removeEventListener('poplur-native-map-tap', input)
      window.removeEventListener('poplur-feed-reveal-controls', reveal)
      delete root.dataset.immersiveControls
      delete root.dataset.controlsIdle
      delete root.dataset.immersiveContext
    }
  }, [enabled, context])
}
