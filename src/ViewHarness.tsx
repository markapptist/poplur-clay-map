import React, { useEffect, useMemo, useState } from 'react'
import HomeTwin from './HomeTwin'
import type { CubeTab } from './CubeTab3D'
import UploadFlowReview from './UploadFlowReview'
import { offlineGameDirector } from './gameDirector'
import {
  normalizeTestActivityScreen,
  useTestActivityReporter,
  type TestActivityScreen,
} from './testActivity'
import styles from './ViewHarness.module.css'

// These routes bring the full game runtimes, generated creature art resolver,
// and model-viewer controller with them. The normal home/map harness must not
// parse all of that on every launch when no game is open.
const ArcadeScreen = React.lazy(() => import('./ArcadeScreen'))
const PoplurGame = React.lazy(() => import('./PoplurGame'))
const GamesScreen = React.lazy(() => import('./GamesScreen'))

const HARNESS_ARCADE_DIRECTOR = offlineGameDirector('arcade')

export type HarnessView = 'home' | 'map' | 'feed' | 'camera' | 'cameraroll' | 'profile' | 'holdmenu' | 'uploadflows' | 'arcade' | 'games' | 'battle'

// The four bottom-nav tabs now live INSIDE the home view (its pills switch
// map/feed/camera/profile inline). The hold menu is a cube-long-press OVERLAY,
// still routable (?view=holdmenu) but not a tab.
const ROUTES: HarnessView[] = ['home', 'map', 'feed', 'camera', 'cameraroll', 'profile', 'holdmenu', 'uploadflows', 'arcade', 'games', 'battle']
const VIEW_LABELS: Record<HarnessView, string> = {
  home: 'Home',
  map: 'Map',
  feed: 'Feed',
  camera: 'Camera',
  cameraroll: 'Camera Roll',
  profile: 'Profile',
  holdmenu: 'Hold Menu',
  uploadflows: 'Upload Flows',
  arcade: 'Arcade',
  battle: 'Battle',
  games: 'Games',
}
// Each ?view= simply picks which tab the tabbed home opens on.
// The home view opens on the FEED tab; the map is one tab over (reachable via
// the cube / the MAP pill). Direct routes (?view=map etc.) still target their
// own tab.
const VIEW_TO_TAB: Record<'home' | 'map' | 'feed' | 'camera' | 'cameraroll' | 'profile', CubeTab> = {
  home: 'feed',
  map: 'map',
  feed: 'feed',
  camera: 'post',
  // Camera Roll is the camera's upper page — same tab, pushed up.
  cameraroll: 'post',
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

type HomeHarnessView = Exclude<HarnessView, 'holdmenu' | 'uploadflows' | 'arcade' | 'games' | 'battle'>

export function holdMenuBaseViewFromLocation(): HomeHarnessView {
  const screen = new URLSearchParams(window.location.search).get('holdScreen')?.toLowerCase() ?? ''

  // Games lives in the Camera/Post hold menu even though its legacy screen ID
  // predates that ownership and still carries the feed prefix.
  if (screen === 'feed-games') return 'camera'
  if (screen.startsWith('profile-')) return 'profile'
  if (screen.startsWith('feed-')) return 'feed'
  if (screen.startsWith('camera-')) return 'camera'
  if (screen.startsWith('map-')) return 'map'

  return 'home'
}

export default function ViewHarness({ initialView }: { initialView: HarnessView }) {
  const [view, setView] = useState<HarnessView>(initialView)
  const [visibleActivityScreen, setVisibleActivityScreen] = useState<TestActivityScreen>(() => (
    normalizeTestActivityScreen(
      // The home route visibly starts on Feed; do not publish a phantom Home
      // stop before HomeTwin's first surface callback reaches this owner.
      initialView === 'home' ? 'feed'
        : initialView === 'cameraroll' ? 'camera-roll'
          : initialView === 'holdmenu' ? 'hold-menu'
            : initialView === 'uploadflows' ? 'upload-flows'
              : initialView,
    )
  ))
  useTestActivityReporter(visibleActivityScreen)

  // Standalone routes do not mount HomeTwin, so they publish their own bounded
  // surface name. Home-owned tabs and subscreens report through the callback
  // below, which prevents a stale `?view=home` heartbeat while Feed, Mail,
  // Wardrobe, or another real page is visibly in front.
  useEffect(() => {
    if (view === 'uploadflows') setVisibleActivityScreen('upload-flows')
    else if (view === 'arcade' || view === 'games' || view === 'battle') {
      setVisibleActivityScreen(view)
    }
  }, [view])

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

  // The hold menu is a cube long-press OVERLAY, not a standalone screen. Direct
  // links keep the owning tab mounted beneath the requested subscreen so a
  // profile screen never appears to float over a feed-owned shell.
  const baseView: HomeHarnessView = view === 'holdmenu'
    ? holdMenuBaseViewFromLocation()
    : view === 'uploadflows'
      ? 'camera'
      // Arcade returns its own surface below and never reaches HomeTwin, but
      // baseView is computed before that early return (hooks cannot be
      // conditional), so it still needs a value the tab map accepts.
      : view === 'arcade' || view === 'games' || view === 'battle'
        ? 'home'
        : view
  const [, setInlineTab] = useState<CubeTab>(VIEW_TO_TAB[baseView])

  useEffect(() => { setInlineTab(VIEW_TO_TAB[baseView]) }, [baseView])

  const screen = useMemo(
    () => (
      <HomeTwin
        onOpen={setHarnessView}
        onTabChange={setInlineTab}
        onVisibleScreenChange={setVisibleActivityScreen}
        initialTab={VIEW_TO_TAB[baseView]}
        initialHoldOpen={view === 'holdmenu'}
        initialCameraPage={view === 'cameraroll' ? 'roll' : 'viewfinder'}
      />
    ),
    [baseView, view],
  )

  const gameFallback = (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'grid', placeItems: 'center', width: '100vw', height: '100vh', background: '#100b1c', color: '#fff' }}
    >
      Loading game…
    </div>
  )

  if (view === 'uploadflows') return <UploadFlowReview />
  // Standalone like uploadflows: the Arcade shell is its own surface, not a tab
  // inside the tabbed home.
  if (view === 'arcade') return (
    <React.Suspense fallback={gameFallback}>
      <ArcadeScreen director={HARNESS_ARCADE_DIRECTOR} />
    </React.Suspense>
  )
  if (view === 'battle') return (
    <React.Suspense fallback={gameFallback}>
      <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#101828' }}>
        <PoplurGame
          specUrl={`${import.meta.env.BASE_URL}games/arcade/cinder-isles.json`}
          director={HARNESS_ARCADE_DIRECTOR}
        />
      </div>
    </React.Suspense>
  )
  // The games LIST, reachable without spinning the hold-menu wheel to it (the
  // wheel culls to five tiles, so GAMES is not always on screen).
  if (view === 'games') return (
    <React.Suspense fallback={gameFallback}>
      <GamesScreen onClose={() => setHarnessView('home')} />
    </React.Suspense>
  )

  return (
    <div className={styles.stage}>
      <div className={styles.phone}>
        <div className={styles.backdrop} />
        <main className={styles.viewport} aria-label={`${VIEW_LABELS[view]} test view`}>
          <div key={baseView} className={styles.screenSurface}>
            {screen}
          </div>
        </main>
      </div>
    </div>
  )
}
