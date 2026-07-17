import React, { useState, useEffect } from 'react'
import styles from './HomeTwin.module.css'
import CubeTab3D, { type CubeTab } from './CubeTab3D'
import ClayChannelArrows from './ClayChannelArrows'
import { playPop } from './pop'
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

const PILL_VIEW: Record<CubeTab, HarnessView> = {
  map: 'home',
  feed: 'feed',
  post: 'camera',
  profile: 'profile',
}
const PILL_ORDER: CubeTab[] = ['map', 'feed', 'post', 'profile']

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const RADIUS_METERS = 41_800
const EARTH_RADIUS_KM = 6_371

// Channel numbers for the left-slot channel changer (mirrors the feed twin's).
const CHANNEL_NUMBERS = [101, 104, 108, 112, 117, 121, 128, 134]

export default function HomeTwin({ onOpen }: { onOpen: (view: HarnessView) => void }) {
  const [activeTab, setActiveTab] = useState<CubeTab>('map')
  const [popping, setPopping] = useState(false)
  // Radius units cycle km ⇄ mi continuously, like the app's radius display.
  const [unitMi, setUnitMi] = useState(false)
  // Right slot cross-fades TRENDING ⇄ RADIUS, both stacked on the right.
  const [showTrending, setShowTrending] = useState(true)
  // Left slot: channel up/down changer.
  const [chanIndex, setChanIndex] = useState(0)
  useEffect(() => {
    const units = window.setInterval(() => setUnitMi(v => !v), 2500)
    const fade = window.setInterval(() => setShowTrending(v => !v), 3200)
    return () => { window.clearInterval(units); window.clearInterval(fade) }
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
      <div className={styles.groundGlow} />

      <div className={styles.tabPills}>
        {PILL_ORDER.map(tab => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? styles.pillActive : styles.pill}
            onClick={() => {
              playPop()
              if (tab === activeTab) {
                if (PILL_VIEW[tab] !== 'home') onOpen(PILL_VIEW[tab])
              } else {
                setActiveTab(tab) // CubeTab3D springs to this face
              }
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className={styles.cubeWrap}>
        <div
          className={popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => { if (e.animationName.includes('Pop')) setPopping(false) }}
        >
          <CubeTab3D
            size={176}
            targetTab={activeTab}
            onFaceChange={setActiveTab}
            onTap={popCube}
            onHold={() => {
              playPop()
              onOpen('holdmenu')
            }}
          />
        </div>
      </div>

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
