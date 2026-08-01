import { useEffect, useState } from 'react'

// Low-memory WebViews (especially A03) can lose a WebGL context or drop a
// mounted child without taking down React. Keep this tiny watchdog independent
// of the cube renderer: when the persistent chrome is missing or reports a
// failed renderer, remount the existing approved components in place. It never
// invents a fallback visual, so recovery cannot make a device look like a
// different build.
export function useUIRecoveryWatchdog(): number {
  const [recoveryKey, setRecoveryKey] = useState(0)

  useEffect(() => {
    let consecutiveFailures = 0
    let lastRecovery = 0
    let recoveryAttempts = 0

    const mounted = (element: Element | null | undefined): boolean => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      // Persistent chrome deliberately fades to opacity:0 in PHONE mode and
      // while a composer is open. Opacity is therefore not a health signal;
      // presence, layout, renderer state, and hit-target count are.
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const rect = element.getBoundingClientRect()
      return rect.width > 8 && rect.height > 8
    }

    const check = () => {
      if (document.visibilityState === 'hidden') return
      const home = document.querySelector<HTMLElement>('[data-poplur-watchdog]')
      if (!home || home.dataset.poplurWatchdog === 'off') {
        consecutiveFailures = 0
        return
      }
      const cube = home.querySelector('[data-poplur-cube]')
      const arrows = home.querySelector('[data-poplur-channel-arrows]')
      const cubeRenderer = cube?.querySelector('[data-cube-renderer]')
      const channelRenderer = arrows?.querySelector('[data-poplur-channel-renderer]')
      const channelControls = arrows?.querySelectorAll('[data-poplur-channel-control]')
      const broken = !mounted(cube)
        || !mounted(arrows)
        || cubeRenderer?.getAttribute('data-cube-renderer') === 'failed'
        // Checking the real canvas and both hit targets catches the A03 case
        // where the outer slot survives but its approved controls are dropped
        // or its WebGL context is lost.
        || !mounted(channelRenderer ?? null)
        || !['ready', 'recovered'].includes(channelRenderer?.getAttribute('data-poplur-channel-renderer') ?? '')
        || channelControls?.length !== 2
      if (!broken) {
        consecutiveFailures = 0
        recoveryAttempts = 0
        return
      }
      consecutiveFailures += 1
      // Require two consecutive samples to avoid remounting during a normal
      // transition. Retry continuously but use bounded exponential backoff so
      // a persistently lost GPU cannot trap an A03 in a remount loop.
      const retryDelay = Math.min(30_000, 1500 * (2 ** Math.min(recoveryAttempts, 5)))
      if (consecutiveFailures < 2 || Date.now() - lastRecovery < retryDelay) return
      lastRecovery = Date.now()
      recoveryAttempts += 1
      consecutiveFailures = 0
      setRecoveryKey(value => value + 1)
      window.dispatchEvent(new CustomEvent('poplur-ui-recovered'))
    }

    const interval = window.setInterval(check, 1000)
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check)
    observer?.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'data-cube-renderer',
        'data-poplur-channel-renderer',
        'data-poplur-watchdog',
      ],
    })
    check()
    return () => {
      window.clearInterval(interval)
      observer?.disconnect()
    }
  }, [])

  return recoveryKey
}
