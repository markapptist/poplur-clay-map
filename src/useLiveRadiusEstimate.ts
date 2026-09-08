import { useEffect, useState } from 'react'
import type { AuthoredPostsSnapshot } from './authoredPosts'
import { projectedRadiusMeters } from './radiusProjection'

export function useLiveRadiusEstimate(snapshot: AuthoredPostsSnapshot | null, enabled: boolean) {
  const [now, setNow] = useState(Date.now)
  const hasProjection = Boolean(enabled && snapshot?.decay?.length)
  useEffect(() => {
    if (!hasProjection) return
    let timer = 0
    let nativeActive = (window as Window & { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive !== false
    const refresh = () => {
      window.clearTimeout(timer)
      if (document.hidden || !nativeActive) return
      setNow(Date.now())
      timer = window.setTimeout(refresh, 30_000)
    }
    const lifecycle = (event: Event) => {
      const active = (event as CustomEvent).detail?.active
      if (typeof active === 'boolean') { nativeActive = active; refresh() }
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('poplur-native-app-lifecycle', lifecycle)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('poplur-native-app-lifecycle', lifecycle) }
  }, [hasProjection])
  const lossMeters = hasProjection ? snapshot!.decay!.reduce((sum, post) => sum + post.storedMeters - projectedRadiusMeters(post, now), 0) : 0
  return { radiusKm: snapshot ? Math.max(0, snapshot.totalRadiusKm - lossMeters / 1_000) : null, estimated: hasProjection }
}
