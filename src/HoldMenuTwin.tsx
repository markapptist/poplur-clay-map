import React, { useState } from 'react'
import styles from './HoldMenuTwin.module.css'

// Web twin of CubeHoldMenuOverlay.swift — the cube's long-press "hold menu".
// A dimmed backdrop, a rounded card of glossy 3D icon tiles (chunked into rows
// of ≤4), a SCRUB ↕ hint on the right, and a selection glow. The item set is
// context-sensitive per tab, exactly like the app (HomeView.swift /
// MapView.mapCubeMenuItems).

type Tab = 'map' | 'feed' | 'camera' | 'profile'

interface Item { icon: string; title: string }

const MENUS: Record<Tab, Item[]> = {
  map: [
    { icon: 'Search', title: 'LOCATE' },
    { icon: 'Create', title: 'POST' },
    { icon: 'Tour', title: 'TOUR' },
    { icon: 'Home', title: 'HOME' },
    { icon: 'Chat', title: 'CHAT' },
  ],
  feed: [
    { icon: 'TVGuide', title: 'TV GUIDE' },
    { icon: 'News', title: 'NEWS' },
    { icon: 'Music', title: 'MUSIC' },
    { icon: 'YouTube', title: 'YOUTUBE' },
    { icon: 'Chat', title: 'CHAT' },
  ],
  camera: [
    { icon: 'CameraRoll', title: 'CAMERA ROLL' },
    { icon: 'Create', title: 'CREATE' },
    { icon: 'Home', title: 'HOME' },
    { icon: 'Chat', title: 'CHAT' },
    { icon: 'Store', title: 'STORE' },
    { icon: 'Games', title: 'GAMES' },
  ],
  profile: [
    { icon: 'Stats', title: 'STATS' },
    { icon: 'Create', title: 'CREDITS' },
    { icon: 'Store', title: 'STORE' },
    { icon: 'Settings', title: 'SETTINGS' },
    { icon: 'Chat', title: 'CHAT' },
  ],
}

const TAB_LABELS: Record<Tab, string> = { map: 'Map', feed: 'Feed', camera: 'Camera', profile: 'Profile' }

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export default function HoldMenuTwin() {
  // Default to the camera context (we arrive here right after the camera tab).
  const [tab, setTab] = useState<Tab>('camera')
  const items = MENUS[tab]
  // The scrub cursor opens on the second tile (not the rightmost, which would
  // sit under the SCRUB hint).
  const [selected, setSelected] = useState(1)
  const rows = chunk(items, 4)

  const pick = (t: Tab) => { setTab(t); setSelected(1) }

  return (
    <div className={styles.stage}>
      {/* Dimmed backdrop with the pressed cube glowing underneath */}
      <div className={styles.backdrop} />
      <div className={styles.cubeGhost} aria-hidden="true" />

      {/* The wheel card */}
      <div className={styles.card}>
        {rows.map((row, ri) => (
          <div key={ri} className={styles.row}>
            {row.map((it, ci) => {
              const idx = ri * 4 + ci
              const on = idx === selected
              return (
                <button
                  key={it.title}
                  className={on ? styles.tileOn : styles.tile}
                  onClick={() => setSelected(idx)}
                >
                  <img className={styles.tileIcon} src={`holdmenu/${it.icon}.png`} alt="" draggable={false} />
                  <span className={styles.tileLabel}>{it.title}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* SCRUB ↕ hint on the right, like the app */}
      <div className={styles.scrub} aria-hidden="true">
        <span className={styles.scrubChev}>⌃</span>
        <span className={styles.scrubText}>SCRUB</span>
        <span className={styles.scrubChev}>⌄</span>
      </div>

      {/* Context switcher (dev): the app derives this from the active tab */}
      <div className={styles.tabs}>
        {(Object.keys(MENUS) as Tab[]).map(t => (
          <button
            key={t}
            className={t === tab ? styles.tabOn : styles.tab}
            onClick={() => pick(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  )
}
