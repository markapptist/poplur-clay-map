import React, { useEffect, useState } from 'react'
import styles from './StatsScreen.module.css'
import { radiusStats, RADIUS_CHANGE_EVENT } from './radiusLedger'

const BADGES = [
  { icon: '🌍', label: 'First Pop', threshold: 1, key: 'views' },
  { icon: '💬', label: 'Commentator', threshold: 5, key: 'comments' },
  { icon: '❤️', label: 'Well Liked', threshold: 10, key: 'likes' },
  { icon: '👤', label: 'Visitor', threshold: 5, key: 'profileVisits' },
  { icon: '🔥', label: '100 km Club', threshold: 100, key: 'radiusKm' },
  { icon: '🏆', label: 'World Radius', threshold: 500, key: 'radiusKm' },
] as const

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export default function StatsScreen({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState(radiusStats)

  useEffect(() => {
    const refresh = () => setStats(radiusStats())
    window.addEventListener(RADIUS_CHANGE_EVENT, refresh)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, refresh)
  }, [])

  const total = stats.gains + stats.losses
  const gainPct = total > 0 ? (stats.gains / total) * 100 : 50

  return (
    <div className={styles.screen}>
      {/* Spinning globe with pulse rings */}
      <div className={styles.globeWrap}>
        <div className={styles.globe} />
        <div className={styles.pulseRing} />
        <div className={styles.pulseRing} />
        <div className={styles.pulseRing} />
      </div>

      {/* Radius readout */}
      <div className={styles.radiusLabel}>
        YOUR RADIUS
        <br />
        <span className={styles.radiusValue}>{fmt(stats.radiusKm)}</span>
        <span className={styles.radiusUnit}>km</span>
      </div>

      {/* Gain / loss bar */}
      <div className={styles.flowBar}>
        <span className={styles.flowGain}>+{fmt(stats.gains)}</span>
        <div className={styles.flowTrack}>
          <div
            className={`${styles.flowFill} ${styles.flowFillGain}`}
            style={{ width: `${gainPct}%` }}
          />
          <div
            className={`${styles.flowFill} ${styles.flowFillLoss}`}
            style={{ width: `${100 - gainPct}%` }}
          />
        </div>
        <span className={styles.flowLoss}>-{fmt(stats.losses)}</span>
      </div>

      {/* Pop-up book cards */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardIcon}>📍</span>
          <span className={styles.cardValue}>{fmt(stats.radiusKm)}</span>
          <span className={styles.cardLabel}>Radius km</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardIcon}>👁️</span>
          <span className={styles.cardValue}>{fmt(stats.views)}</span>
          <span className={styles.cardLabel}>Posts Viewed</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardIcon}>👥</span>
          <span className={styles.cardValue}>{fmt(stats.profileVisits)}</span>
          <span className={styles.cardLabel}>People Reached</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardIcon}>💬</span>
          <span className={styles.cardValue}>{fmt(stats.comments)}</span>
          <span className={styles.cardLabel}>Comments</span>
        </div>
      </div>

      {/* Stat tiles */}
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{fmt(stats.likes)}</span>
          <span className={styles.tileLabel}>Likes</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{fmt(stats.dislikes)}</span>
          <span className={styles.tileLabel}>Dislikes</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{fmt(stats.inactivePosts)}</span>
          <span className={styles.tileLabel}>Inactive</span>
        </div>
      </div>

      {/* Badges */}
      <div className={styles.badges}>
        {BADGES.map(b => {
          const val = stats[b.key as keyof typeof stats]
          const earned = typeof val === 'number' && val >= b.threshold
          return (
            <div
              key={b.label}
              className={`${styles.badge} ${earned ? '' : styles.badgeLocked}`}
            >
              <span className={styles.badgeIcon}>{b.icon}</span>
              {b.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}
