import React, { useEffect, useMemo, useState } from 'react'
import TopChrome from './TopChrome'
import HomeTwin from './HomeTwin'
import HoldMenuTwin from './HoldMenuTwin'
import FeedTwin from './FeedTwin'
import ProfileTwin from './ProfileTwin'
import styles from './ViewHarness.module.css'

export type HarnessView = 'home' | 'feed' | 'camera' | 'profile' | 'holdmenu'

// The four bottom-nav tabs. The hold menu is a cube-long-press OVERLAY, not a
// tab, so it's routable (?view=holdmenu) but excluded from the nav.
const VIEW_ORDER: HarnessView[] = ['home', 'feed', 'camera', 'profile']
const ROUTES: HarnessView[] = [...VIEW_ORDER, 'holdmenu']
const VIEW_LABELS: Record<HarnessView, string> = {
  home: 'Home',
  feed: 'Feed',
  camera: 'Camera',
  profile: 'Profile',
  holdmenu: 'Hold Menu',
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
  const [cameraMode, setCameraMode] = useState<'photo' | 'video' | 'live'>('photo')
  const [isRecording, setIsRecording] = useState(false)

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

  const screen = useMemo(() => {
    switch (view) {
      case 'home':
        return <HomeTwin onOpen={setHarnessView} />
      case 'feed':
        return <FeedTwin />
      case 'camera':
        return (
          <CameraHarness
            mode={cameraMode}
            recording={isRecording}
            onModeChange={setCameraMode}
            onRecordingChange={setIsRecording}
          />
        )
      case 'profile':
        return <ProfileTwin />
      case 'holdmenu':
        return <HoldMenuTwin onOpen={setHarnessView} />
    }
  }, [cameraMode, isRecording, view])

  return (
    <div className={styles.stage}>
      <div className={styles.phone}>
        <div className={styles.backdrop} />
        <TopChrome />

        {view !== 'home' && view !== 'holdmenu' && view !== 'feed' && (
          <nav className={styles.viewTabs} aria-label="Live view harness">
            {VIEW_ORDER.map(item => (
              <button
                key={item}
                type="button"
                className={item === view ? styles.viewTabActive : styles.viewTab}
                onClick={() => setHarnessView(item)}
              >
                {VIEW_LABELS[item]}
              </button>
            ))}
          </nav>
        )}

        <main className={styles.viewport} aria-label={`${VIEW_LABELS[view]} test view`}>
          <div key={view} className={styles.screenSurface}>
            {screen}
          </div>
        </main>

        {view !== 'home' && view !== 'holdmenu' && <BottomCubeNav active={view} onSelect={setHarnessView} />}

      </div>
    </div>
  )
}

function BottomCubeNav({ active, onSelect }: { active: HarnessView; onSelect: (view: HarnessView) => void }) {
  return (
    <div className={styles.bottomNav}>
      {VIEW_ORDER.map(item => (
        <button
          key={item}
          type="button"
          className={item === active ? styles.navItemActive : styles.navItem}
          onClick={() => onSelect(item)}
          aria-label={VIEW_LABELS[item]}
        >
          <span className={styles.navIcon}>{iconForView(item)}</span>
        </button>
      ))}
    </div>
  )
}

function iconForView(view: HarnessView) {
  switch (view) {
    case 'home': return 'P'
    case 'feed': return 'TV'
    case 'camera': return 'CAM'
    case 'profile': return '@'
  }
}

function CameraHarness({
  mode,
  recording,
  onModeChange,
  onRecordingChange,
}: {
  mode: 'photo' | 'video' | 'live'
  recording: boolean
  onModeChange: (mode: 'photo' | 'video' | 'live') => void
  onRecordingChange: (recording: boolean) => void
}) {
  return (
    <section className={styles.cameraScreen}>
      <div className={styles.cameraPreview}>
        <div className={styles.gridLines} />
        <div className={styles.focusBox} />
        <div className={styles.cameraSubject}>
          <img src="clay_pin.png" alt="" draggable="false" />
        </div>
        <div className={styles.cameraHud}>
          <span>{mode.toUpperCase()}</span>
          <strong>{recording ? '00:12' : 'Ready'}</strong>
        </div>
      </div>

      <div className={styles.filterRail}>
        {['original', 'pop tv', 'clay', 'night'].map(filter => (
          <button key={filter} type="button">{filter}</button>
        ))}
      </div>

      <div className={styles.modeRail}>
        {(['photo', 'video', 'live'] as const).map(item => (
          <button
            key={item}
            type="button"
            className={mode === item ? styles.controlOn : undefined}
            onClick={() => onModeChange(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={recording ? styles.captureRecording : styles.captureButton}
        onClick={() => onRecordingChange(!recording)}
        aria-label={recording ? 'Stop recording' : 'Capture'}
      >
        <span />
      </button>
    </section>
  )
}
