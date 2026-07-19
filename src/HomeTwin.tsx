import React, { useState, useEffect } from 'react'
import styles from './HomeTwin.module.css'
import CubeTab3D, { type CubeTab } from './CubeTab3D'
import ClayChannelArrows from './ClayChannelArrows'
import FeedTwin, { CHANNELS } from './FeedTwin'
import ProfileTwin from './ProfileTwin'
import Camera from './Camera'
import HoldMenuTwin from './HoldMenuTwin'
import { playPop } from './pop'
import { isNativeShell } from './nativeBridge'
import type { HarnessView } from './ViewHarness'

const KM_TO_MI = 0.621371

// Browser twin of the iOS Home screen (map tab state), rebuilt from
// HomeView.swift + RecordingCountdownView.swift + RadiusNumberDisplayFIXED.swift.
// Both bottom counters share the CounterSeparatorMetrics vertical grid so their
// fraction bars sit level, exactly like the .counterSeparator alignment guide.
//
// The cube is live 3D (CubeTab3D): drag to swipe between faces, tap to pop,
// press-and-hold to open the hold menu twin. Pills track the front face;
// clicking the already-front face's pill opens that tab's screen twin.

const PILL_ORDER: CubeTab[] = ['map', 'feed', 'post', 'profile']

// The cube scales with the phone width so it and the two flanking counters
// always fit — full 176 on a roomy phone, shrinking on tighter ones.
function cubeSizeFor(): number {
  if (typeof window === 'undefined') return 176
  return Math.round(Math.min(176, Math.max(128, window.innerWidth * 0.42)))
}

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const RADIUS_METERS = 41_800
const EARTH_RADIUS_KM = 6_371

// The map tab embeds the clay map. In the browser prototype that's the separate
// dev server on :5199; embedded in the native app (custom scheme, e.g.
// poplur-clay://) there is no localhost, so it loads the SAME bundle's map view
// (index.html with no ?view → App renders the map). Keeps the prototype unchanged.
const CLAY_MAP_SRC =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? 'http://127.0.0.1:5199/'
    : 'index.html'

export default function HomeTwin({ onOpen, initialTab = 'map', initialHoldOpen = false }: { onOpen: (view: HarnessView) => void; initialTab?: CubeTab; initialHoldOpen?: boolean }) {
  // Tabs render inline: the pills switch map / feed / camera(post) / profile
  // content within this one home view instead of routing to separate screens.
  const [activeTab, setActiveTab] = useState<CubeTab>(initialTab)
  // The cube long-press hold menu floats as a translucent overlay over the
  // current tab, and its items match that tab.
  const [holdOpen, setHoldOpen] = useState(initialHoldOpen)
  const [popping, setPopping] = useState(false)
  // Radius units cycle km ⇄ mi continuously, like the app's radius display.
  const [unitMi, setUnitMi] = useState(false)
  // Right slot cross-fades RADIUS ⇄ TRENDING (the feed's animated label).
  const [showTrending, setShowTrending] = useState(true)
  // Left slot: channel up/down changer — drives the feed's channel directly.
  const [chanIndex, setChanIndex] = useState(0)
  // Cube size follows the viewport so the bottom cluster never overlaps.
  const [cubeSize, setCubeSize] = useState(cubeSizeFor)
  // The clay map boots into a dark iframe + runs a multi-second globe→city
  // fly-in. Show a clay skeleton over it until it's had time to paint, so the
  // map tab never flashes a bare black rectangle.
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => { if (activeTab === 'map') setMapReady(false) }, [activeTab])
  // The tab pills are a testing aid — shown whenever running in a browser so the
  // map/feed/camera/profile tabs can be switched without the cube. The real app
  // (native shell) navigates via the cube, so they stay hidden there. Pass
  // ?tabs=0 to force them off in the browser too.
  const showTestTabs = typeof window !== 'undefined'
    && !isNativeShell()
    && new URLSearchParams(window.location.search).get('tabs') !== '0'
  useEffect(() => {
    const units = window.setInterval(() => setUnitMi(v => !v), 2500)
    const fade = window.setInterval(() => setShowTrending(v => !v), 3200)
    const onResize = () => setCubeSize(cubeSizeFor())
    window.addEventListener('resize', onResize)
    return () => { window.clearInterval(units); window.clearInterval(fade); window.removeEventListener('resize', onResize) }
  }, [])

  const changeChannel = (dir: 1 | -1) => {
    playPop()
    setChanIndex(i => (i + dir + CHANNELS.length) % CHANNELS.length)
  }

  const popCube = () => {
    playPop()
    setPopping(true)
  }

  return (
    <section className={styles.home}>
      {/* The map tab IS the home state: the approved GCL clay map fills the
          screen behind the HUD (counters, cube float on top). Feed / Camera /
          Profile render inline as their own tabs. */}
      {/* Map tab: the clay map fills the screen + the map-only HUD counters. */}
      {activeTab === 'map' && (
        <>
          <iframe
            className={styles.mapLayer}
            src={CLAY_MAP_SRC}
            title="Poplur clay map"
            allow="autoplay; geolocation"
            onLoad={() => window.setTimeout(() => setMapReady(true), 2600)}
          />
          {/* Clay skeleton — covers the map's dark boot window, then fades. */}
          <div className={`${styles.mapSkeleton} ${mapReady ? styles.mapSkeletonHidden : ''}`} aria-hidden="true" />
        </>
      )}

      {activeTab === 'feed' && <FeedTwin index={chanIndex} onIndexChange={setChanIndex} />}
      {activeTab === 'post' && <Camera />}
      {activeTab === 'profile' && <ProfileTwin />}

      {/* Bottom HUD — channel changer + TRENDING ⇄ RADIUS labels. Persistent
          across every tab, matching the native HomeView chrome. */}
      <div className={styles.bottomRow}>
        {/* LEFT: clay channel up / down arrows (light up on press, feed-style) */}
        <div className={styles.chanSlot}>
          <ClayChannelArrows
            number={CHANNELS[chanIndex].number}
            onUp={() => changeChannel(-1)}
            onDown={() => changeChannel(1)}
          />
        </div>

        {/* RIGHT: the feed's animated RADIUS ◆ ⇄ TRENDING ↑ label */}
        <div className={styles.statStack}>
          <div className={showTrending ? styles.statCardOut : styles.statCard}>
            <span className={styles.statLabel}>RADIUS ◆</span>
            <span className={styles.statValue}>
              {(unitMi ? (RADIUS_METERS / 1000) * KM_TO_MI : RADIUS_METERS / 1000).toFixed(1)}
              <span className={styles.statUnit}>{unitMi ? 'mi' : 'km'}</span>
            </span>
            <span className={styles.statSub}>
              of {(unitMi ? Math.round(EARTH_RADIUS_KM * KM_TO_MI) : EARTH_RADIUS_KM).toLocaleString()} {unitMi ? 'mi' : 'km'}
            </span>
          </div>
          <div className={showTrending ? styles.statCard : styles.statCardOut}>
            <span className={styles.statLabel}>TRENDING ↑</span>
            <span className={styles.statValue}>{POST_COUNT}</span>
            <span className={styles.statSub}>posts nearby</span>
          </div>
        </div>
      </div>

      {/* The cube is the persistent navigator — visible on every tab, floating
          over whatever content is active. Its face tracks the current tab. */}
      <div className={styles.groundGlow} />
      <div className={styles.cubeWrap} style={{ width: cubeSize, height: cubeSize }}>
        <div
          className={popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => { if (e.animationName.includes('Pop')) setPopping(false) }}
        >
          <CubeTab3D
            size={cubeSize}
            targetTab={activeTab}
            onFaceChange={setActiveTab}
            onTap={popCube}
            onHold={() => {
              playPop()
              setHoldOpen(true)
            }}
          />
        </div>
      </div>

      {/* Tab pills — a prototype-only testing aid (see showTestTabs). The real
          app navigates with the cube, so these never render outside the prototype. */}
      {showTestTabs && <div className={styles.tabPills}>
        {PILL_ORDER.map(tab => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? styles.pillActive : styles.pill}
            onClick={() => { playPop(); setActiveTab(tab) }}
          >
            {tab}
          </button>
        ))}
      </div>}

      {/* Cube long-press hold menu — translucent overlay whose item set matches
          the tab it was opened from. Closes back to that tab. */}
      {holdOpen && <HoldMenuTwin tab={activeTab} onClose={() => setHoldOpen(false)} />}
    </section>
  )
}

// (The old TrendingCounter / RadiusCounter pair was replaced by the feed's
//  animated RADIUS ◆ ⇄ TRENDING ↑ stat label, rendered inline above.)
