import React, { useEffect, useState } from 'react'
import styles from './HomeTwin.module.css'
import { modelSprite } from './modelSprite'
import { playPop } from './pop'
import type { HarnessView } from './ViewHarness'

// Browser twin of the iOS Home screen (map tab state), rebuilt from
// HomeView.swift + RecordingCountdownView.swift + RadiusNumberDisplayFIXED.swift.
// Both bottom counters share the CounterSeparatorMetrics vertical grid so their
// fraction bars sit level, exactly like the .counterSeparator alignment guide.

// clay_icon_cube.glb face yaws (camera yaw that faces each tab's cube face),
// per CubeTabView.swift: +Z front=Profile, +X right=Map, -Z back=Camera, -X left=Feed.
const CUBE_FACE_YAW: Record<string, number> = {
  profile: 0,
  map: 90,
  post: 180,
  feed: -90,
}

const TAB_PILLS: { label: string; view: HarnessView }[] = [
  { label: 'map', view: 'home' },
  { label: 'feed', view: 'feed' },
  { label: 'post', view: 'camera' },
  { label: 'profile', view: 'profile' },
]

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const RADIUS_METERS = 41_800
const EARTH_RADIUS_KM = 6_371

export default function HomeTwin({ onOpen }: { onOpen: (view: HarnessView) => void }) {
  const [cubeSrc, setCubeSrc] = useState<string | null>(null)
  const [popping, setPopping] = useState(false)

  useEffect(() => {
    let alive = true
    modelSprite('clay_icon_cube.glb', { yaw: CUBE_FACE_YAW.map, pitch: 10, size: 512 })
      .then(src => { if (alive) setCubeSrc(src) })
      .catch(() => { /* fallback PNG stays */ })
    return () => { alive = false }
  }, [])

  const popCube = () => {
    playPop()
    setPopping(true)
  }

  return (
    <section className={styles.home}>
      <div className={styles.groundGlow} />

      <div className={styles.tabPills}>
        {TAB_PILLS.map(pill => (
          <button
            key={pill.label}
            type="button"
            className={pill.view === 'home' ? styles.pillActive : styles.pill}
            onClick={() => {
              playPop()
              if (pill.view !== 'home') onOpen(pill.view)
            }}
          >
            {pill.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.cubeWrap}
        onClick={popCube}
        aria-label="Poplur cube"
      >
        <div
          className={popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => { if (e.animationName.includes('Pop')) setPopping(false) }}
        >
          <img
            className={styles.cube}
            src={cubeSrc ?? 'clay_cube.png'}
            alt=""
            draggable="false"
          />
          {cubeSrc && (
            // The iOS app draws each tab's icon + label onto the cube skin at
            // runtime (CubeTabView faceEmissionMask); mirror that here.
            <div className={styles.cubeFace}>
              <svg viewBox="0 0 24 24" width="42" height="42" aria-hidden="true">
                <path
                  d="M9 2.6 3.6 4.6a1 1 0 0 0-.6.9v14.6a1 1 0 0 0 1.4.9L9 19.2l6 2.2 5.4-2a1 1 0 0 0 .6-.9V3.9a1 1 0 0 0-1.4-.9L15 4.8zM9.75 4.7l4.5 1.65v12.95l-4.5-1.65z"
                  fill="currentColor"
                  fillRule="evenodd"
                />
              </svg>
              <span>Map</span>
            </div>
          )}
        </div>
      </button>

      <div className={styles.bottomRow}>
        <TrendingCounter />
        <RadiusCounter />
      </div>
    </section>
  )
}

// LEFT counter — RecordingCountdownView post-count state, trend up.
function TrendingCounter() {
  return (
    <div className={styles.counterLeft}>
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
        {POST_COUNT} posts · {(RADIUS_METERS / 1000).toFixed(1)} km
      </div>
    </div>
  )
}

// RIGHT counter — RadiusNumberDisplay. 41.8 km of 6,371 km ⇒ bronze rank.
function RadiusCounter() {
  return (
    <div className={styles.counterRight}>
      <div className={styles.radiusLabelRow}>
        <span className={styles.counterLabelText}>RADIUS</span>
        <svg className={styles.rankIcon} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M12 2l8 3v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5z" fill="currentColor" />
        </svg>
      </div>
      <div className={styles.radiusNumeratorBox}>
        <span className={styles.radiusValue}>{(RADIUS_METERS / 1000).toFixed(1)}</span>
        <span className={styles.radiusUnit}>km</span>
      </div>
      <div className={`${styles.separator} ${styles.separatorBronze}`} />
      <div className={styles.radiusDenominatorBox}>
        <span className={styles.earthValue}>{EARTH_RADIUS_KM.toLocaleString()}</span>
        <span className={styles.earthUnit}>km</span>
      </div>
      <div className={styles.counterFooterSpacer} />
    </div>
  )
}
