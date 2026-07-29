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

    const visible = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false
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
      const renderer = cube?.querySelector('[data-cube-renderer]')
      const broken = !visible(cube) || !visible(arrows) || renderer?.getAttribute('data-cube-renderer') === 'failed'
      if (!broken) {
        consecutiveFailures = 0
        return
      }
      consecutiveFailures += 1
      // Require two consecutive samples to avoid remounting during a normal
      // transition, then rate-limit retries while a budget GPU is recovering.
      if (consecutiveFailures < 2 || Date.now() - lastRecovery < 1500) return
      lastRecovery = Date.now()
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
      attributeFilter: ['class', 'style', 'data-cube-renderer', 'data-poplur-watchdog'],
    })
    check()
    return () => {
      window.clearInterval(interval)
      observer?.disconnect()
    }
  }, [])

  return recoveryKey
}
