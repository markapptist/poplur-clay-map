import React, { useEffect, useRef, useState } from 'react'
import styles from './TrophyRoomScreen.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'
import { playPop } from './pop'
import { RADIUS_CHANGE_EVENT } from './radiusLedger'
import {
  RARITY_COLOR,
  collectTrophyStats,
  onTrophyChange,
  trophyStates,
  type TrophyState,
} from './trophies'

// TROPHY ROOM — the profile's wall of trophies. A dark stone wall with pink
// neon shelves; every trophy in the library stands on a shelf, earned ones in
// full colour, locked ones as dark silhouettes carrying the bar they need.
// The library, the predicates and the earned-date ratchet all live in
// trophies.ts — this file only draws the wall.

const SHELF_SIZE = 3

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function earnedDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/** The locked tile's one-line count toward the bar, when it can be counted. */
function progressLine(t: TrophyState): string | null {
  if (!t.progress) return null
  const [now, goal] = t.progress(collect())
  return `${fmt(Math.min(now, goal))} / ${fmt(goal)}`
}

// progress() wants the same snapshot trophyStates just evaluated; re-collect
// lazily and only while something locked is on screen asking for a count.
let cached: ReturnType<typeof collectTrophyStats> | null = null
function collect() {
  if (!cached) cached = collectTrophyStats()
  return cached
}

export default function TrophyRoomScreen({ bindBack }: {
  /** The cube steps back from an open trophy card to the wall before closing. */
  bindBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const [states, setStates] = useState<TrophyState[]>(trophyStates)
  const [open, setOpen] = useState<TrophyState | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    const refresh = () => { cached = null; setStates(trophyStates()) }
    // Any ledger movement can flip a predicate; onTrophyChange also covers a
    // second surface stamping an earn (storage event).
    window.addEventListener(RADIUS_CHANGE_EVENT, refresh)
    const offTrophy = onTrophyChange(refresh)
    return () => {
      window.removeEventListener(RADIUS_CHANGE_EVENT, refresh)
      offTrophy()
    }
  }, [])

  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      if (openRef.current) {
        setOpen(null)
        return true
      }
      return false
    })
    return () => bindBack(null)
  }, [bindBack])

  const earned = states.filter(t => t.earnedAt != null).length
  const shelves = chunk(states, SHELF_SIZE)

  return (
    <section className={styles.screen} aria-label="Trophy room" data-clay-scroll>
      <div className={styles.wall}>
        <header className={styles.header}>
          <h1 className={styles.title}>TROPHY ROOM</h1>
          <span className={styles.count}>
            {earned} / {states.length} COLLECTED
          </span>
        </header>

        {shelves.map((row, shelfIndex) => (
          <div
            key={shelfIndex}
            className={styles.shelf}
            style={{ '--shelf-delay': `${shelfIndex * 0.07}s` } as React.CSSProperties}
          >
            {row.map(t => {
              const isEarned = t.earnedAt != null
              const line = isEarned ? null : progressLine(t)
              return (
                <button
                  key={t.id}
                  type="button"
                  className={styles.trophy}
                  data-earned={isEarned ? 'true' : 'false'}
                  style={{ '--rarity': RARITY_COLOR[t.rarity] } as React.CSSProperties}
                  onClick={() => { playPop(); setOpen(t) }}
                  aria-label={`${t.name}${isEarned ? ', earned' : ', locked'}`}
                >
                  <img
                    className={styles.art}
                    src={t.art}
                    alt=""
                    draggable={false}
                    loading="lazy"
                  />
                  <b className={styles.name}>{t.name}</b>
                  {/* Locked tiles carry their bar right on the wall — a dark
                      silhouette with no explanation reads as a bug, not a goal. */}
                  {!isEarned && (
                    <i className={styles.need}>{line ?? t.requirement}</i>
                  )}
                </button>
              )
            })}
          </div>
        ))}

        <div className={styles.hint}>
          Locked trophies show what they need. Tap any trophy for its story.
        </div>
      </div>

      {open && (
        <div
          className={`${styles.overlay} ${surfaceStyles.scrim}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${open.name} trophy`}
          onClick={() => { playPop(); setOpen(null) }}
        >
          <div
            className={`${styles.card} ${surfaceStyles.surface}`}
            style={{ '--rarity': RARITY_COLOR[open.rarity] } as React.CSSProperties}
            data-earned={open.earnedAt != null ? 'true' : 'false'}
            onClick={e => e.stopPropagation()}
          >
            <img className={styles.cardArt} src={open.art} alt="" draggable={false} />
            <span className={styles.rarity}>{open.rarity.toUpperCase()}</span>
            <h2 className={styles.cardName}>{open.name}</h2>
            <p className={styles.cardDesc}>{open.description}</p>
            <div className={styles.cardMeta}>
              <span className={styles.cardReq}>{open.requirement}</span>
              {open.earnedAt != null ? (
                <span className={styles.cardEarned}>
                  EARNED {earnedDate(open.earnedAt).toUpperCase()}
                </span>
              ) : (
                <span className={styles.cardLocked}>
                  {open.earned || open.id === 'poplur_legend'
                    ? (progressLine(open) ?? 'LOCKED')
                    : 'COMING WITH THE LIVE SERVICE'}
                </span>
              )}
            </div>
            {/* No close button: tapping anywhere off the card dismisses, and
                the cube — the universal back — closes it too (bindBack). */}
          </div>
        </div>
      )}
    </section>
  )
}
