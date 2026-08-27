import React, { useEffect, useRef, useState } from 'react'
import {
  MAP_CONQUER_FLIP_MS,
  mapConquerGlanceRows,
  type MapConquerSnapshot,
} from './mapConquer'
import styles from './ConquerGlance.module.css'

export default function ConquerGlance({
  snapshot,
  open,
  onOpen,
  onDismiss,
}: {
  snapshot: MapConquerSnapshot | null
  open: boolean
  onOpen: () => void
  onDismiss?: () => void
}) {
  const rows = mapConquerGlanceRows(snapshot, open)
  const allRows = snapshot?.rows ?? []
  const totalKm = allRows.reduce((sum, row) => sum + row.radiusKm, 0)
  const topFame = allRows[0]?.fame ?? 0
  const [flipRevision, setFlipRevision] = useState(0)
  const glanceRef = useRef<HTMLButtonElement>(null)

  // Opening from the side rail is a disclosure action. Move focus into the
  // newly revealed popup so keyboard and switch-control users land on the same
  // "open full board" decision as touch users.
  useEffect(() => {
    if (open) glanceRef.current?.focus({ preventScroll: true })
  }, [open])

  // This is a compact popover, not a modal. Let the next map/control gesture
  // continue normally while closing it. The Conquer toggle is exempt because
  // its click owns the open/closed transition; dismissing during capture would
  // make that same click immediately reopen the card.
  useEffect(() => {
    if (!open || !onDismiss) return
    const dismissFromPointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && glanceRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-map-conquer-toggle]')) return
      onDismiss()
    }
    const dismissFromNativeMap = () => onDismiss()
    const dismissFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', dismissFromPointer, { capture: true, passive: true })
    document.addEventListener('keydown', dismissFromKeyboard, { capture: true })
    window.addEventListener('poplur-native-map-tap', dismissFromNativeMap)
    return () => {
      document.removeEventListener('pointerdown', dismissFromPointer, { capture: true })
      document.removeEventListener('keydown', dismissFromKeyboard, { capture: true })
      window.removeEventListener('poplur-native-map-tap', dismissFromNativeMap)
    }
  }, [onDismiss, open])

  // Replays the real board's split-flap motion, but only while this compact
  // preview is actually mounted and visible. Reduced-motion users
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

  if (!open) return null

  return (
    <button
      ref={glanceRef}
      id="poplur-conquer-glance"
      type="button"
      className={styles.glance}
      aria-label="Open the full Conquer Board"
      aria-controls="poplur-conquer-board"
      aria-haspopup="dialog"
      data-poplur-conquer-glance
      data-conquer-scope={snapshot?.scope.toLowerCase()}
      data-poplur-native-hit-region
      onClick={onOpen}
    >
      <span className={styles.terrain} aria-hidden="true" />
      <span className={styles.board}>
        <span className={styles.heading}>
          <span>
            <small><i aria-hidden="true" /> {snapshot?.scope ?? 'LOCAL'} · DOMINATION LIVE</small>
            <strong>Conquer Board</strong>
          </span>
          <em>PREVIEW</em>
        </span>
        <span className={styles.stats}>
          <span><strong>{allRows.length || '—'}</strong><small>IN VIEW</small></span>
          <span><strong>{allRows.length ? Math.round(totalKm).toLocaleString() : '—'}</strong><small>KM HELD</small></span>
          <span><strong>{topFame ? topFame.toLocaleString() : '—'}</strong><small>TOP FAME</small></span>
        </span>
        {rows.length ? (
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
        ) : (
          <span className={styles.empty} role="status">
            <strong>{snapshot ? 'NO CONQUERED AREAS' : 'STANDINGS LOADING'}</strong>
            <small>{snapshot ? 'Explore the complete board' : 'Open the board while this area ranks'}</small>
          </span>
        )}
        <span className={styles.footer}>
          <span>TOP 3 OF {allRows.length || '—'}</span>
          <b>OPEN FULL BOARD ↗</b>
        </span>
      </span>
    </button>
  )
}
