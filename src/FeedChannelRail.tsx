import { CHANNELS } from './FeedTwin'
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
  hidden = false,
}: {
  activeIndex: number
  onPick: (index: number) => void
  hidden?: boolean
}) {
  return (
    <div
      className={hidden ? `${styles.rail} ${styles.railHidden}` : styles.rail}
      role="tablist"
      aria-label="Channels"
      aria-hidden={hidden || undefined}
      data-feed-channel-rail=""
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
            onPointerDown={event => {
              // Pointer-down like the other clay controls: the channel should
              // change under the finger, not after it lifts.
              if (event.isPrimary && event.button === 0) onPick(index)
            }}
          >
            <img src={channelUrl(`${channel.icon}.png`)} alt="" draggable={false} />
          </button>
        )
      })}
    </div>
  )
}
