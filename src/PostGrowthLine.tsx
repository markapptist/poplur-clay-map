// ── How a pop grew ───────────────────────────────────────────────────────────
//
// One line under an opened pop: where its reach started, where it is now, how
// long that took, and what moved it — with the curve itself drawn above as a
// sparkline. "5.0 km when posted → 6.4 km now · over 26 hours · 2 views · 1
// like." The data is the pop's own history (posts/{id}/radiusHistory, written
// by the server with every change), so nothing here is inferred.
//
// Self-contained on purpose: the post viewer and the map's opened-pop card
// both mount it, and neither has to know how the history is read.
import React from 'react'
import styles from './PostGrowthLine.module.css'
import { KM_TO_MI } from './units'
import { describeSpan, usePostRadiusHistory, type RadiusHistorySummary } from './postRadiusHistory'

/** The counter's own number rule: grouped integers from 1,000 up, tenths below. */
export function formatDistance(meters: number, useMiles: boolean): string {
  const km = Math.max(0, meters) / 1_000
  const shown = useMiles ? km * KM_TO_MI : km
  const number = shown >= 1_000
    ? Math.round(shown).toLocaleString('en-US')
    : (Math.round(shown * 10) / 10).toFixed(1)
  return `${number} ${useMiles ? 'mi' : 'km'}`
}

export interface GrowthLineText {
  from: string
  to: string
  /** "▲ 1.4 km", "▼ 0.6 km", or "unchanged". */
  change: string
  direction: 'up' | 'down' | 'flat'
  span: string
  /** "2 views · 1 like", or '' when nothing has moved it. */
  counts: string
  /** "when posted" for a true creation point, "first recorded" otherwise. */
  opening: string
  /** The whole line, for a screen reader and for probes. */
  sentence: string
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Pure: the words for a curve. */
export function formatGrowthLine(summary: RadiusHistorySummary, useMiles: boolean): GrowthLineText {
  const from = formatDistance(summary.initialMeters, useMiles)
  const to = formatDistance(summary.currentMeters, useMiles)
  const direction: GrowthLineText['direction'] = summary.growthMeters > 0 ? 'up' : summary.growthMeters < 0 ? 'down' : 'flat'
  const change = direction === 'flat'
    ? 'unchanged'
    : `${direction === 'up' ? '▲' : '▼'} ${formatDistance(Math.abs(summary.growthMeters), useMiles)}`
  const span = summary.spanMs < 60_000 ? 'just posted' : `over ${describeSpan(summary.spanMs)}`
  const parts: string[] = []
  if (summary.kinds.view) parts.push(plural(summary.kinds.view, 'view'))
  if (summary.kinds.like) parts.push(plural(summary.kinds.like, 'like'))
  if (summary.kinds.comment) parts.push(plural(summary.kinds.comment, 'comment'))
  if (summary.kinds.dislike) parts.push(plural(summary.kinds.dislike, 'dislike'))
  if (summary.causes.decay) parts.push(plural(summary.causes.decay, 'decay step'))
  if (summary.causes.boost) parts.push(plural(summary.causes.boost, 'boost'))
  const counts = parts.join(' · ')
  // "when posted" is a claim about the beginning; only a 'create' point is
  // one. A curve that opens on a reconstructed or later point says so.
  const opening = summary.firstCause === 'create' ? 'when posted' : 'first recorded'
  const sentence = direction === 'flat' && summary.points.length === 1
    ? `${from} ${opening}, ${span}`
    : `${from} ${opening} → ${to} now, ${change}, ${span}${counts ? `, ${counts}` : ''}`
  return { from, to, change, direction, span, counts, opening, sentence }
}

/**
 * Pure: the sparkline as SVG path data. Time runs left to right across the
 * width, reach bottom to top, with the first and last points pinned to the
 * edges so the curve always spans the box. A single point draws a flat line.
 */
export function sparklinePath(
  points: readonly { atMillis: number; radiusMeters: number }[],
  width: number,
  height: number,
  inset = 2,
): { line: string; area: string; endX: number; endY: number } {
  const w = Math.max(1, width - inset * 2)
  const h = Math.max(1, height - inset * 2)
  if (!points.length) return { line: '', area: '', endX: inset, endY: inset + h }
  const t0 = points[0].atMillis
  const t1 = points[points.length - 1].atMillis
  const span = Math.max(1, t1 - t0)
  let lo = Infinity
  let hi = -Infinity
  for (const p of points) { lo = Math.min(lo, p.radiusMeters); hi = Math.max(hi, p.radiusMeters) }
  const range = Math.max(1, hi - lo)
  const x = (t: number) => inset + (points.length === 1 ? 0 : ((t - t0) / span) * w)
  const y = (r: number) => inset + h - ((r - lo) / range) * h
  const xs = points.map(p => [x(p.atMillis), y(p.radiusMeters)] as const)
  const f = (n: number) => (Math.round(n * 10) / 10).toString()
  let line = points.length === 1
    ? `M${f(inset)} ${f(xs[0][1])} L${f(inset + w)} ${f(xs[0][1])}`
    : xs.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${f(px)} ${f(py)}`).join(' ')
  const endX = points.length === 1 ? inset + w : xs[xs.length - 1][0]
  const endY = xs[xs.length - 1][1]
  const area = `${line} L${f(endX)} ${f(inset + h)} L${f(inset)} ${f(inset + h)} Z`
  return { line, area, endX, endY }
}

const SPARK_W = 132
const SPARK_H = 30

export default function PostGrowthLine({
  postId,
  useMiles,
  className,
}: {
  /** The pop's post id — the map's `firestore:` prefix is fine. */
  postId: string | null | undefined
  useMiles: boolean
  className?: string
}) {
  const { summary, loaded } = usePostRadiusHistory(postId)
  // Nothing to say until the history has been read; a pop with none (a post
  // older than the history, not yet backfilled) shows nothing rather than a
  // guess.
  if (!loaded || !summary) return null
  const text = formatGrowthLine(summary, useMiles)
  const spark = sparklinePath(summary.points, SPARK_W, SPARK_H)
  const tone = text.direction === 'up' ? styles.up : text.direction === 'down' ? styles.down : styles.flat
  return (
    <div
      className={`${styles.growth} ${tone}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`How this pop grew: ${text.sentence}`}
      data-pop-growth="true"
      data-pop-growth-from-m={summary.initialMeters}
      data-pop-growth-to-m={summary.currentMeters}
      data-pop-growth-points={summary.points.length}
      title={`${text.sentence}. Earned radius loses 5% per day, applied hourly. A dislike removes up to 1 km of earned radius. Discovery seed stays; boosts follow their expiry.`}
    >
      <svg className={styles.spark} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden="true">
        <path className={styles.sparkArea} d={spark.area} />
        <path className={styles.sparkLine} d={spark.line} />
        <circle className={styles.sparkEnd} cx={spark.endX} cy={spark.endY} r="2.6" />
      </svg>
      <div className={styles.words} aria-hidden="true">
        <span className={styles.from}>{text.from}<i className={styles.opening}> {text.opening}</i></span>
        <span className={styles.arrow}>→</span>
        <span className={styles.to}>{text.to}</span>
        <span className={styles.change}>{text.change}</span>
        <span className={styles.meta}>{text.span}{text.counts ? ` · ${text.counts}` : ''}</span>
      </div>
    </div>
  )
}
