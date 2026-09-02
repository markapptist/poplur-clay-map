import { useMemo, useState } from 'react'
import styles from './FeedMixPanel.module.css'
import {
  DEFAULT_FEED_MIX,
  FEED_MIX_SOURCES,
  adjustFeedMix,
  feedMixSequence,
  feedMixShares,
  readFeedMix,
  writeFeedMix,
  type FeedMixSource,
} from './feedMixControl'
import { demoInventory } from './demoFeedMedia'

/**
 * Test surface for the Feed's demo inventory blend (?view=feedmix).
 *
 * Three sliders that always total 100. Moving one lets the other two absorb
 * the difference in proportion, so a drag never silently zeroes a source.
 *
 * It shows the TARGET mix and the ACHIEVED mix side by side: a source with no
 * inventory cannot fill its slots, and hiding that gap would make the panel
 * lie about what the feed is actually showing.
 */

const PRESENTATION: Record<FeedMixSource, { label: string; color: string; mark: string }> = {
  photos: { label: 'PHOTO CARDS', color: '#f63b9a', mark: 'P' },
  videos: { label: 'VIDEO CREATIVES', color: '#7c3aed', mark: 'V' },
  ads: { label: 'GOOGLE ADS', color: '#f59e0b', mark: 'A' },
}

const PREVIEW_SLOTS = 24

export default function FeedMixPanel() {
  const [mix, setMix] = useState(readFeedMix)
  const inventory = useMemo(() => demoInventory(), [])

  const sequence = useMemo(() => feedMixSequence(mix, PREVIEW_SLOTS), [mix])
  // A source with zero inventory cannot fill its slots, so the achieved share
  // is measured on the sequence AFTER dropping the sources that have nothing.
  const deliverable = useMemo(
    () => sequence.filter(source => inventory[source] > 0),
    [sequence, inventory],
  )
  const achieved = useMemo(() => feedMixShares(deliverable), [deliverable])

  const apply = (source: FeedMixSource, next: number) => {
    setMix(writeFeedMix(adjustFeedMix(mix, source, next)))
  }

  const starved = FEED_MIX_SOURCES.filter(source => mix[source] > 0 && inventory[source] === 0)

  return (
    <div className={styles.stage}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Feed inventory mix</h1>
        <p className={styles.subtitle}>
          How demo inventory is blended. Real published posts are ranked ahead of all of
          this and are never part of the mix.
        </p>

        {FEED_MIX_SOURCES.map(source => {
          const { label, color } = PRESENTATION[source]
          const stock = inventory[source]
          return (
            <div key={source} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.label}>
                  <span className={styles.swatch} style={{ background: color }} />
                  {label}
                </span>
                <span>
                  <span className={`${styles.stock} ${stock === 0 ? styles.empty : ''}`}>
                    {stock === 0
                      ? source === 'ads' ? 'needs a native shell' : 'no files yet'
                      : Number.isFinite(stock) ? `${stock} available` : 'served on demand'}
                  </span>
                  {'  '}
                  <span className={styles.value}>{mix[source]}%</span>
                </span>
              </div>
              <input
                className={styles.slider}
                type="range"
                min={0}
                max={100}
                step={1}
                value={mix[source]}
                aria-label={`${label} share`}
                onChange={event => apply(source, Number(event.target.value))}
              />
            </div>
          )
        })}

        <div className={styles.total}>
          <span>Total</span>
          <span className={styles.totalValue}>
            {FEED_MIX_SOURCES.reduce((sum, source) => sum + mix[source], 0)}%
          </span>
        </div>

        <p className={styles.barLabel}>TARGET</p>
        <div className={styles.bar}>
          {FEED_MIX_SOURCES.map(source => (
            <div
              key={source}
              className={styles.barSegment}
              style={{ width: `${mix[source]}%`, background: PRESENTATION[source].color }}
            />
          ))}
        </div>

        <p className={styles.barLabel}>
          ACHIEVED — {FEED_MIX_SOURCES.map(source => `${PRESENTATION[source].mark} ${achieved[source]}%`).join('   ')}
        </p>
        <div className={styles.strip}>
          {deliverable.map((source, slot) => (
            <span
              key={`${source}-${slot}`}
              className={styles.slot}
              style={{ background: PRESENTATION[source].color }}
              title={PRESENTATION[source].label}
            >
              {PRESENTATION[source].mark}
            </span>
          ))}
        </div>

        {starved.length > 0 && (
          <p className={styles.note}>
            {starved.map(source => PRESENTATION[source].label).join(' and ')}
            {starved.length > 1 ? ' have' : ' has'} no inventory here, so those slots fall through
            to the sources that do. AdMob is a native SDK, so ad slots never fill in this browser
            preview however the sliders are set — the share is still forwarded to the shell, which
            owns the placement. The achieved row reflects what this surface can actually show.
          </p>
        )}

        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={() => setMix(writeFeedMix(DEFAULT_FEED_MIX))}>
            Reset to default
          </button>
          <button className={styles.button} type="button" onClick={() => setMix(writeFeedMix({ photos: 34, videos: 33, ads: 33 }))}>
            Even thirds
          </button>
        </div>
      </div>
    </div>
  )
}
