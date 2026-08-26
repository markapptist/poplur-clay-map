import React, { useEffect, useState } from 'react'
import {
  MAP_CONQUER_FLIP_MS,
  mapConquerGlanceRows,
  type MapConquerSnapshot,
} from './mapConquer'
import styles from './ConquerGlance.module.css'

export default function ConquerGlance({
  snapshot,
  atFarthestZoom,
  onOpen,
}: {
  snapshot: MapConquerSnapshot | null
  atFarthestZoom: boolean
  onOpen: () => void
}) {
  const rows = mapConquerGlanceRows(snapshot, atFarthestZoom)
  const [flipRevision, setFlipRevision] = useState(0)

  // Replays the real board's split-flap motion, but only while this tiny
  // end-stop preview is actually mounted and visible. Reduced-motion users
  // keep the same ranking without an otherwise purposeless timer.
  useEffect(() => {
    if (!rows.length) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let timer = 0
    const stop = () => {
      window.clearInterval(timer)
      timer = 0
    }
    const start = () => {
      if (document.hidden || reducedMotion?.matches || timer) return
      timer = window.setInterval(() => {
        setFlipRevision(revision => revision + 1)
      }, MAP_CONQUER_FLIP_MS)
    }
    const sync = () => {
      stop()
      start()
    }
    start()
    document.addEventListener('visibilitychange', sync)
    reducedMotion?.addEventListener?.('change', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
      reducedMotion?.removeEventListener?.('change', sync)
    }
  }, [rows.length, snapshot?.generatedAt])

  if (!rows.length) return null

  return (
    <button
      type="button"
      className={styles.glance}
      aria-label="Open Conquer Board"
      data-poplur-conquer-glance
      data-poplur-native-hit-region
      onClick={onOpen}
    >
      <span className={styles.heading}>
        <b><i aria-hidden="true" /> CONQUER</b>
        <em>TOP 3</em>
      </span>
      <span className={styles.list} key={`conquer-glance-${flipRevision}`}>
        {rows.map((row, index) => (
          <span
            className={styles.row}
            key={`${row.owner}-${flipRevision}`}
            style={{
              '--conquer-color': row.color,
              '--flip-delay': `${index * 54}ms`,
            } as React.CSSProperties}
          >
            <b className={styles.rank}>{index + 1}</b>
            <span className={styles.avatar}>
              {row.avatar
                ? <img src={row.avatar} alt="" draggable={false} />
                : <b aria-hidden="true">{row.label.replace('@', '').slice(0, 1).toUpperCase()}</b>}
            </span>
            <span className={styles.name}>{row.mine ? 'YOU' : row.label}</span>
            <strong className={styles.fame}>{row.fame.toLocaleString()}</strong>
          </span>
        ))}
      </span>
      <span className={styles.footer}>AREA YOU ARE VIEWING <b>OPEN ↗</b></span>
    </button>
  )
}
