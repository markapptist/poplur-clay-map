import React, { useState, useEffect } from 'react'
import styles from './HomeTwin.module.css'
import CubeTab3D, { type CubeTab } from './CubeTab3D'
import ClayChannelArrows from './ClayChannelArrows'
import FeedTwin from './FeedTwin'
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

// Channel numbers for the left-slot channel changer (mirrors the feed twin's).
const CHANNEL_NUMBERS = [101, 104, 108, 112, 117, 121, 128, 134]

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
  // Right slot cross-fades TRENDING ⇄ RADIUS, both stacked on the right.
  const [showTrending, setShowTrending] = useState(true)
  // Left slot: channel up/down changer.
  const [chanIndex, setChanIndex] = useState(0)
  // Cube size follows the viewport so the bottom cluster never overlaps.
  const [cubeSize, setCubeSize] = useState(cubeSizeFor)
  // The clay map boots into a dark iframe + runs a multi-second globe→city
  // fly-in. Show a clay skeleton over it until it's had time to paint, so the
  // map tab never flashes a bare black rectangle.
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => { if (activeTab === 'map') setMapReady(false) }, [activeTab])
  // The tab pills are a PROTOTYPE-only testing aid — the GCL prototype loads the
  // app with ?tabs=1 to expose them. The real app navigates via the cube, so the
  // pills never appear outside the prototype.
  const showTestTabs = typeof window !== 'undefined'
    && !isNativeShell()
    && new URLSearchParams(window.location.search).get('tabs') === '1'
  useEffect(() => {
    const units = window.setInterval(() => setUnitMi(v => !v), 2500)
    const fade = window.setInterval(() => setShowTrending(v => !v), 3200)
    const onResize = () => setCubeSize(cubeSizeFor())
    window.addEventListener('resize', onResize)
    return () => { window.clearInterval(units); window.clearInterval(fade); window.removeEventListener('resize', onResize) }
  }, [])

  const changeChannel = (dir: 1 | -1) => {
    playPop()
    setChanIndex(i => (i + dir + CHANNEL_NUMBERS.length) % CHANNEL_NUMBERS.length)
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

      {activeTab === 'feed' && <FeedTwin />}
      {activeTab === 'post' && <Camera />}
      {activeTab === 'profile' && <ProfileTwin />}

      {/* Bottom HUD — channel changer + TRENDING ⇄ RADIUS labels. Persistent
          across every tab, matching the native HomeView chrome. */}
      <div className={styles.bottomRow}>
        {/* LEFT: clay channel up / down arrows */}
        <div className={styles.chanSlot}>
          <ClayChannelArrows
            number={CHANNEL_NUMBERS[chanIndex]}
            onUp={() => changeChannel(-1)}
            onDown={() => changeChannel(1)}
          />
        </div>

        {/* RIGHT: TRENDING ⇄ RADIUS crossfade, stacked on the same side */}
        <div className={styles.crossStack}>
          <div className={showTrending ? styles.fadeIn : styles.fadeOut}>
            <TrendingCounter unitMi={unitMi} />
          </div>
          <div className={showTrending ? styles.fadeOut : styles.fadeIn}>
            <RadiusCounter unitMi={unitMi} />
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

// TRENDING counter — RecordingCountdownView post-count state, trend up.
// Right-aligned now that it shares the right slot with the radius counter.
function TrendingCounter({ unitMi }: { unitMi: boolean }) {
  const radiusKm = RADIUS_METERS / 1000
  const radius = unitMi ? radiusKm * KM_TO_MI : radiusKm
  return (
    <div className={styles.counterRight}>
      <div className={styles.counterLabel}>TRENDING</div>
      <div className={styles.numeratorBox}>
        <svg
          className={styles.trendArrow}
          viewBox="0 0 24 30"
          width="26"
          height="33"
          aria-hidden="true"
        >
          <path
            d="M12 27V4.5M12 4.5 4.5 12M12 4.5 19.5 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className={`${styles.separator} ${styles.separatorUp}`} />
      <div className={styles.denominatorBox}>
        <span className={styles.postCount}>{POST_COUNT}</span>
      </div>
      <div className={styles.counterFooter}>
        {POST_COUNT} posts · {radius.toFixed(1)} <span className={styles.unitFlip}>{unitMi ? 'mi' : 'km'}</span>
      </div>
    </div>
  )
}

// RIGHT counter — RadiusNumberDisplay. 41.8 km of 6,371 km ⇒ bronze rank.
function RadiusCounter({ unitMi }: { unitMi: boolean }) {
  const radius = unitMi ? (RADIUS_METERS / 1000) * KM_TO_MI : RADIUS_METERS / 1000
  const earth = unitMi ? Math.round(EARTH_RADIUS_KM * KM_TO_MI) : EARTH_RADIUS_KM
  const unit = unitMi ? 'mi' : 'km'
  return (
    <div className={styles.counterRight}>
      <div className={styles.radiusLabelRow}>
        <span className={styles.counterLabelText}>RADIUS</span>
        <svg className={styles.rankIcon} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M12 2l8 3v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5z" fill="currentColor" />
        </svg>
      </div>
      <div className={styles.radiusNumeratorBox}>
        <span className={styles.radiusValue}>{radius.toFixed(1)}</span>
        <span key={`n-${unit}`} className={`${styles.radiusUnit} ${styles.unitFlip}`}>{unit}</span>
      </div>
      <div className={`${styles.separator} ${styles.separatorBronze}`} />
      <div className={styles.radiusDenominatorBox}>
        <span className={styles.earthValue}>{earth.toLocaleString()}</span>
        <span key={`d-${unit}`} className={`${styles.earthUnit} ${styles.unitFlip}`}>{unit}</span>
      </div>
      <div className={styles.counterFooterSpacer} />
    </div>
  )
}
