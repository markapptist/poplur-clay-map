import { useRef } from 'react'
import { CHANNELS } from './FeedTwin'
import type { ControlSide } from './controlPlacement'
import { channelUrl } from './assetPacks'
import styles from './FeedChannelRail.module.css'

/**
 * Every channel, down the right edge, as its own button.
 *
 * The up/down arrows on the left walk neighbours; this is the whole dial at
 * once, so a viewer eight channels away is one press rather than eight. The
 * channel you are on is lit, because a picker that does not say where you
 * already are makes you count.
 *
 * It is deliberately NOT the 44px TabControlRail: fifteen channels at that
 * pitch is taller than a phone. These tiles are sized so the full set fits
 * without scrolling, which is the entire point of showing them all.
 */
export default function FeedChannelRail({
  activeIndex,
  onPick,
  side,
  hidden = false,
}: {
  activeIndex: number
  onPick: (index: number) => void
  /** Which edge the dial hangs on. It takes the edge the control rail is NOT
   *  on, so the two columns always face each other. */
  side: ControlSide
  hidden?: boolean
}) {
  // Hold and drag to scrub, the way the hold menu does: the channel under your
  // thumb is the channel you get, so flipping to a distant one is one gesture
  // rather than one press per channel. A plain tap still lands on its own tile.
  const railRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  const lastPicked = useRef(activeIndex)

  const pickAt = (clientY: number) => {
    const rail = railRef.current
    if (!rail) return
    const tiles = [...rail.querySelectorAll('[data-feed-channel-tile]')]
    let closest = -1
    let best = Number.POSITIVE_INFINITY
    tiles.forEach((tile, index) => {
      const box = tile.getBoundingClientRect()
      const distance = Math.abs(clientY - (box.top + box.height / 2))
      if (distance < best) { best = distance; closest = index }
    })
    if (closest < 0 || closest === lastPicked.current) return
    lastPicked.current = closest
    onPick(closest)
  }

  return (
    <div
      ref={railRef}
      className={`${styles.rail} ${side === 'right' ? styles.railRight : styles.railLeft}${hidden ? ` ${styles.railHidden}` : ''}`}
      role="tablist"
      aria-label="Channels"
      aria-hidden={hidden || undefined}
      data-feed-channel-rail=""
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return
        scrubbing.current = true
        lastPicked.current = activeIndex
        event.currentTarget.setPointerCapture(event.pointerId)
        pickAt(event.clientY)
      }}
      onPointerMove={event => {
        if (!scrubbing.current) return
        pickAt(event.clientY)
      }}
      onPointerUp={event => {
        scrubbing.current = false
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancel={() => { scrubbing.current = false }}
    >
      {CHANNELS.map((channel, index) => {
        const active = index === activeIndex
        return (
          <button
            key={channel.id}
            type="button"
            role="tab"
            className={active ? `${styles.tile} ${styles.tileOn}` : styles.tile}
            aria-selected={active}
            aria-label={`Channel ${channel.number} ${channel.name}`}
            data-feed-channel-tile={channel.id}
            tabIndex={hidden ? -1 : 0}
            onClick={() => onPick(index)}
          >
            <img src={channelUrl(`${channel.icon}.png`)} alt="" draggable={false} />
          </button>
        )
      })}
    </div>
  )
}
