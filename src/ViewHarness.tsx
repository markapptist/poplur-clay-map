import React, { useEffect, useMemo, useState } from 'react'
import TopChrome from './TopChrome'
import HomeTwin from './HomeTwin'
import type { CubeTab } from './CubeTab3D'
import styles from './ViewHarness.module.css'

export type HarnessView = 'home' | 'map' | 'feed' | 'camera' | 'profile' | 'holdmenu'

// The four bottom-nav tabs now live INSIDE the home view (its pills switch
// map/feed/camera/profile inline). The hold menu is a cube-long-press OVERLAY,
// still routable (?view=holdmenu) but not a tab.
const ROUTES: HarnessView[] = ['home', 'map', 'feed', 'camera', 'profile', 'holdmenu']
const VIEW_LABELS: Record<HarnessView, string> = {
  home: 'Home',
  map: 'Map',
  feed: 'Feed',
  camera: 'Camera',
  profile: 'Profile',
  holdmenu: 'Hold Menu',
}
// Each ?view= simply picks which tab the tabbed home opens on.
// The home view opens on the FEED tab; the map is one tab over (reachable via
// the cube / the MAP pill). Direct routes (?view=map etc.) still target their
// own tab.
const VIEW_TO_TAB: Record<'home' | 'map' | 'feed' | 'camera' | 'profile', CubeTab> = {
  home: 'feed',
  map: 'map',
  feed: 'feed',
  camera: 'post',
  profile: 'profile',
}

export function harnessViewFromLocation(): HarnessView | null {
  const params = new URLSearchParams(window.location.search)
  // Hash first: pill/tab navigation writes the hash, and a stale ?view= from
  // the initial load must not override it on hashchange.
  const raw =
    window.location.hash.replace(/^#\/?/, '') ||
    params.get('view') ||
    window.location.pathname.split('/').filter(Boolean).pop() ||
    ''
  const normalized = raw.toLowerCase()
  return ROUTES.includes(normalized as HarnessView) ? normalized as HarnessView : null
}

export default function ViewHarness({ initialView }: { initialView: HarnessView }) {
  const [view, setView] = useState<HarnessView>(initialView)

  useEffect(() => {
    const onHashChange = () => {
      const next = harnessViewFromLocation()
      if (next) setView(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    document.title = `Poplur — ${VIEW_LABELS[view]}`
    return () => { document.title = 'Poplur — Post-login' }
  }, [view])

  const setHarnessView = (next: HarnessView) => {
    if (next === view) return
    window.location.hash = next
    setView(next)
  }

  // The hold menu is a cube long-press OVERLAY, not a standalone screen — it
  // floats over the live home view behind a semi-transparent scrim, and closing
  // it returns you to that home. So ?view=holdmenu keeps the home (map) mounted
  // underneath rather than swapping it out.
  const baseView: Exclude<HarnessView, 'holdmenu'> = view === 'holdmenu' ? 'home' : view
  const [inlineTab, setInlineTab] = useState<CubeTab>(VIEW_TO_TAB[baseView])

  useEffect(() => { setInlineTab(VIEW_TO_TAB[baseView]) }, [baseView])

  const screen = useMemo(
    () => (
      <HomeTwin
        onOpen={setHarnessView}
        onTabChange={setInlineTab}
        initialTab={VIEW_TO_TAB[baseView]}
        initialHoldOpen={view === 'holdmenu'}
      />
    ),
    [baseView, view],
  )

  return (
    <div className={styles.stage}>
      <div className={styles.phone}>
        <div className={styles.backdrop} />
        {/* The feed owns its top slot (the brand TV-flips with the channel
            info there), so the harness chrome would double the logo. */}
        {inlineTab !== 'post' && inlineTab !== 'feed' && <TopChrome />}

        <main className={styles.viewport} aria-label={`${VIEW_LABELS[view]} test view`}>
          <div key={baseView} className={styles.screenSurface}>
            {screen}
          </div>
        </main>
      </div>
    </div>
  )
}
