import React, { useEffect, useState } from 'react'
import styles from './StatsScreen.module.css'
import { radiusStats, RADIUS_CHANGE_EVENT } from './radiusLedger'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function funnySummary(s: ReturnType<typeof radiusStats>): string[] {
  const lines: string[] = []

  if (s.radiusKm < 50) {
    lines.push("Your radius is still in its cozy phase — think of it as a warm-up lap around the neighbourhood.")
  } else if (s.radiusKm < 200) {
    lines.push(`${Math.round(s.radiusKm)} km of pure influence. That's roughly the range of a very ambitious pizza delivery.`)
  } else {
    lines.push(`${fmt(s.radiusKm)} km! Your reach extends further than most people's WiFi complaints.`)
  }

  if (s.views === 0) {
    lines.push("Zero views so far. Your content is playing the long game — mysterious, exclusive, possibly invisible.")
  } else if (s.views === 1) {
    lines.push("1 view. Somebody out there clicked. We're not saying it was you, but we're also not NOT saying that.")
  } else {
    lines.push(`${fmt(s.views)} views and counting. Each one is a tiny stranger choosing YOU over doomscrolling.`)
  }

  if (s.likes === 0 && s.dislikes === 0) {
    lines.push("Zero engagement — the internet has chosen to remain neutral about your existence. Switzerland would be proud.")
  } else if (s.likes > 0 && s.dislikes === 0) {
    lines.push("A perfect like-to-dislike ratio. Scientists would call this 'statistically suspicious.' Keep it up.")
  } else if (s.dislikes > s.likes) {
    lines.push("More dislikes than likes? You're not cringe — you're avant-garde. History will vindicate you.")
  } else {
    lines.push("More likes than dislikes. You're basically the internet's golden child right now.")
  }

  if (s.comments === 0) {
    lines.push("No comments yet. Either your content left everyone speechless, or… yeah, let's go with speechless.")
  } else {
    lines.push(`${fmt(s.comments)} comments — people have opinions about you, and honestly? That's a superpower.`)
  }

  return lines
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

  const engData = [
    { label: 'Views', value: stats.views, color: '#f63b9a' },
    { label: 'Likes', value: stats.likes, color: '#4ade80' },
    { label: 'Comments', value: stats.comments, color: '#38bdf8' },
    { label: 'Visitors', value: stats.profileVisits, color: '#fbbf24' },
    { label: 'Dislikes', value: stats.dislikes, color: '#a78bfa' },
  ]
  const engTotal = engData.reduce((s, d) => s + d.value, 0)
  let cumPct = 0
  const pieGradient = engTotal > 0
    ? engData.filter(d => d.value > 0).map(d => {
        const start = cumPct
        cumPct += (d.value / engTotal) * 100
        return `${d.color} ${start}% ${cumPct}%`
      }).join(', ')
    : '#2a2a3e 0% 100%'

  const barData = [
    { label: 'Views', value: stats.views, color: '#f63b9a' },
    { label: 'Likes', value: stats.likes, color: '#4ade80' },
    { label: 'Dislike', value: stats.dislikes, color: '#f87171' },
    { label: 'Cmts', value: stats.comments, color: '#38bdf8' },
    { label: 'Visits', value: stats.profileVisits, color: '#fbbf24' },
    { label: 'Inactive', value: stats.inactivePosts, color: '#a78bfa' },
  ]
  const barMax = Math.max(...barData.map(d => d.value), 1)

  const r = stats.radiusKm
  const linePoints = [r * 0.05, r * 0.15, r * 0.28, r * 0.45, r * 0.62, r * 0.8, r]
  const lineMax = Math.max(...linePoints, 1)
  const svgW = 300, svgH = 150, pad = 12
  const plotW = svgW - pad * 2, plotH = svgH - pad * 2
  const coords = linePoints.map((v, i) => ({
    x: pad + (i / (linePoints.length - 1)) * plotW,
    y: pad + plotH - (v / lineMax) * plotH,
  }))
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')
  const areaPath = `${linePath} L${coords[coords.length - 1].x},${svgH - pad} L${coords[0].x},${svgH - pad} Z`

  const summary = funnySummary(stats)

  return (
    <div className={styles.screen}>
      <div className={styles.globeSection}>
        <div className={styles.globeWrap}>
          <div className={styles.globe} />
          <div className={styles.pulseRing} />
          <div className={styles.pulseRing} />
          <div className={styles.pulseRing} />
        </div>

        <div className={`${styles.card} ${styles.cardTop}`}>
          <span className={styles.cardValue}>{fmt(stats.radiusKm)}</span>
          <span className={styles.cardLabel}>RADIUS KM</span>
          <div className={styles.miniFlow}>
            <span className={styles.miniGain}>+{fmt(stats.gains)}</span>
            <div className={styles.miniTrack}>
              <div className={styles.miniFillGain} style={{ width: `${gainPct}%` }} />
              <div className={styles.miniFillLoss} style={{ width: `${100 - gainPct}%` }} />
            </div>
            <span className={styles.miniLoss}>-{fmt(stats.losses)}</span>
          </div>
        </div>

        <div className={`${styles.card} ${styles.cardLeftTop}`}>
          <span className={styles.cardIcon}>👁️</span>
          <span className={styles.cardValue}>{fmt(stats.views)}</span>
          <span className={styles.cardLabel}>POSTS VIEWED</span>
        </div>

        <div className={`${styles.card} ${styles.cardRightTop}`}>
          <span className={styles.cardIcon}>👥</span>
          <span className={styles.cardValue}>{fmt(stats.profileVisits)}</span>
          <span className={styles.cardLabel}>PEOPLE REACHED</span>
        </div>

        <div className={`${styles.card} ${styles.cardLeftBottom}`}>
          <span className={styles.cardIcon}>💬</span>
          <span className={styles.cardValue}>{fmt(stats.comments)}</span>
          <span className={styles.cardLabel}>COMMENTS</span>
        </div>

        <div className={`${styles.card} ${styles.cardRightBottom}`}>
          <span className={styles.cardIcon}>❤️</span>
          <span className={styles.cardValue}>{fmt(stats.likes)}</span>
          <span className={styles.cardLabel}>LIKES</span>
        </div>

        <div className={`${styles.card} ${styles.cardBottom}`}>
          <span className={styles.cardIcon}>👎</span>
          <span className={styles.cardValue}>{fmt(stats.dislikes)}</span>
          <span className={styles.cardLabel}>DISLIKES</span>
        </div>
      </div>

      {/* ── Scrollable content below ───────────────────────────────── */}

      <div className={styles.summary}>
        <h2 className={styles.summaryTitle}>Your Stats Story</h2>
        {summary.map((line, i) => (
          <p key={i} className={styles.summaryLine}>{line}</p>
        ))}
      </div>

      <div className={styles.chartSection}>
        <h3 className={styles.chartTitle}>Engagement Breakdown</h3>
        <div className={styles.pieWrap}>
          <div className={styles.pie3d}>
            <div
              className={styles.pieDisc}
              style={{ background: `conic-gradient(${pieGradient})` }}
            />
          </div>
          <div className={styles.pieLegend}>
            {engData.map(d => (
              <div key={d.label} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: d.color }} />
                <span className={styles.legendLabel}>{d.label}</span>
                <span className={styles.legendVal}>{fmt(d.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.chartSection}>
        <h3 className={styles.chartTitle}>Stats Overview</h3>
        <div className={styles.barChart}>
          {barData.map((d, i) => (
            <div key={d.label} className={styles.barCol}>
              <div
                className={styles.bar3d}
                style={{
                  '--bar-h': `${Math.max((d.value / barMax) * 130, 10)}px`,
                  '--bar-color': d.color,
                  '--bar-delay': `${0.8 + i * 0.12}s`,
                } as React.CSSProperties}
              >
                <div className={styles.barFront} />
                <div className={styles.barSide} />
                <div className={styles.barTop} />
              </div>
              <span className={styles.barLabel}>{d.label}</span>
              <span className={styles.barVal}>{fmt(d.value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.chartSection}>
        <h3 className={styles.chartTitle}>Radius Growth</h3>
        <div className={styles.lineWrap}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} className={styles.lineSvg}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f63b9a" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#f63b9a" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#areaGrad)" className={styles.lineArea} />
            <path
              d={linePath}
              fill="none"
              stroke="#f63b9a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.linePath}
            />
            {coords.map((c, i) => (
              <circle
                key={i}
                cx={c.x}
                cy={c.y}
                r="5"
                fill="#f63b9a"
                stroke="#121228"
                strokeWidth="2.5"
                className={styles.lineDot}
                style={{ animationDelay: `${1.4 + i * 0.1}s` }}
              />
            ))}
          </svg>
          <div className={styles.lineLabels}>
            {['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'Now'].map(l => (
              <span key={l} className={l === 'Now' ? styles.lineLabelNow : undefined}>{l}</span>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.spacer} />
    </div>
  )
}
