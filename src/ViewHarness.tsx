import React, { useEffect, useMemo, useState } from 'react'
import TopChrome from './TopChrome'
import HomeTwin from './HomeTwin'
import styles from './ViewHarness.module.css'

export type HarnessView = 'home' | 'feed' | 'camera' | 'profile'

const VIEW_ORDER: HarnessView[] = ['home', 'feed', 'camera', 'profile']
const VIEW_LABELS: Record<HarnessView, string> = {
  home: 'Home',
  feed: 'Feed',
  camera: 'Camera',
  profile: 'Profile',
}

const feedPosts = [
  { id: 'queen', channel: 'CH 24', title: 'Queen West snack run', meta: '950 m away', radius: '+420' },
  { id: 'kensington', channel: 'CH 83', title: 'Kensington night market', meta: '1.8 km away', radius: '+1.2k' },
  { id: 'harbour', channel: 'CH 12', title: 'Harbourfront blue hour', meta: '3.1 km away', radius: '+310' },
]

const profileStats = [
  ['Posts', '128'],
  ['Radius', '41.8k'],
  ['Followers', '9.4k'],
]

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
  return VIEW_ORDER.includes(normalized as HarnessView) ? normalized as HarnessView : null
}

export default function ViewHarness({ initialView }: { initialView: HarnessView }) {
  const [view, setView] = useState<HarnessView>(initialView)
  const [feedState, setFeedState] = useState<'watching' | 'guide' | 'comments'>('watching')
  const [cameraMode, setCameraMode] = useState<'photo' | 'video' | 'live'>('photo')
  const [isRecording, setIsRecording] = useState(false)
  const [profilePanel, setProfilePanel] = useState<'posts' | 'stats' | 'settings'>('posts')

  useEffect(() => {
    const onHashChange = () => {
      const next = harnessViewFromLocation()
      if (next) setView(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

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
        return <FeedHarness state={feedState} onStateChange={setFeedState} />
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
        return <ProfileHarness panel={profilePanel} onPanelChange={setProfilePanel} />
    }
  }, [cameraMode, feedState, isRecording, profilePanel, view])

  return (
    <div className={styles.stage}>
      <div className={styles.phone}>
        <div className={styles.backdrop} />
        <TopChrome />

        {view !== 'home' && (
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
          {screen}
        </main>

        {view !== 'home' && <BottomCubeNav active={view} onSelect={setHarnessView} />}

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

function FeedHarness({
  state,
  onStateChange,
}: {
  state: 'watching' | 'guide' | 'comments'
  onStateChange: (state: 'watching' | 'guide' | 'comments') => void
}) {
  return (
    <section className={styles.feedScreen}>
      <video className={styles.feedStatic} src="tv_static.mp4" autoPlay muted loop playsInline />
      <div className={styles.feedGlass} />
      <div className={styles.feedChannel}>
        <span>CH 24</span>
        <strong>Poplur Food</strong>
      </div>

      <div className={styles.feedCardStack}>
        {feedPosts.map((post, index) => (
          <article key={post.id} className={index === 0 ? styles.feedCardActive : styles.feedCard}>
            <div className={styles.feedThumb}>
              <img src={index === 0 ? 'clay_tv.png' : 'clay_pin.png'} alt="" draggable="false" />
            </div>
            <div>
              <span>{post.channel}</span>
              <h2>{post.title}</h2>
              <p>{post.meta} / radius {post.radius}</p>
            </div>
          </article>
        ))}
      </div>

      {state === 'guide' && (
        <div className={styles.feedPanel}>
          <h3>TV guide</h3>
          <p>Food, style, local music, sports and live streams are ready to QA here.</p>
        </div>
      )}
      {state === 'comments' && (
        <div className={styles.commentPanel}>
          <h3>Comments</h3>
          <p>That shawarma shot just popped up on Queen W.</p>
          <p>Boosting this channel.</p>
        </div>
      )}

      <div className={styles.stateControls}>
        <button type="button" className={state === 'watching' ? styles.controlOn : undefined} onClick={() => onStateChange('watching')}>Watch</button>
        <button type="button" className={state === 'guide' ? styles.controlOn : undefined} onClick={() => onStateChange('guide')}>Guide</button>
        <button type="button" className={state === 'comments' ? styles.controlOn : undefined} onClick={() => onStateChange('comments')}>Comments</button>
      </div>
    </section>
  )
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

function ProfileHarness({
  panel,
  onPanelChange,
}: {
  panel: 'posts' | 'stats' | 'settings'
  onPanelChange: (panel: 'posts' | 'stats' | 'settings') => void
}) {
  return (
    <section className={styles.profileScreen}>
      <div className={styles.profileHeader}>
        <div className={styles.avatar}>M</div>
        <div>
          <h1>Mark</h1>
          <p>@mark / building Poplur</p>
        </div>
      </div>

      <div className={styles.statRow}>
        {profileStats.map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className={styles.profileTabs}>
        {(['posts', 'stats', 'settings'] as const).map(item => (
          <button
            key={item}
            type="button"
            className={panel === item ? styles.controlOn : undefined}
            onClick={() => onPanelChange(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className={styles.profilePanel}>
        {panel === 'posts' && (
          <div className={styles.postGrid}>
            {feedPosts.map(post => <span key={post.id}>{post.channel}</span>)}
          </div>
        )}
        {panel === 'stats' && (
          <div className={styles.radiusChart}>
            <span style={{ height: '38%' }} />
            <span style={{ height: '62%' }} />
            <span style={{ height: '84%' }} />
            <span style={{ height: '56%' }} />
            <span style={{ height: '74%' }} />
          </div>
        )}
        {panel === 'settings' && (
          <div className={styles.settingsList}>
            <span>Dark mode</span>
            <span>3D avatar</span>
            <span>Closed captions</span>
            <span>Cube skin</span>
          </div>
        )}
      </div>
    </section>
  )
}
