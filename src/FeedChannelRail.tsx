import { useMemo, type ReactNode } from 'react'
import { CHANNELS } from './FeedTwin'
import type { ControlSide } from './controlPlacement'
import { channelUrl } from './assetPacks'
import ClayWheel from './ClayWheel'
import { SIDE_DIAL_PRESENTATION } from './sideDialPresentation'
import dialStyles from './SideDial.module.css'
import styles from './FeedChannelRail.module.css'

/**
 * The feed's channel dial: every channel on one edge of the screen.
 *
 * It is a clay wheel — the same one the hold menu spins — rather than a
 * column of tiles. A column had to choose between fitting all fifteen (32px
 * artwork you could not read) and scrolling (the lit channel wandering off
 * screen). The wheel keeps the live channel lit in the notch with its
 * neighbours curving away above and below, so what comes before and after is
 * always in view and every visible tile is large. The notch IS the channel:
 * scrubbing changes channel as each tile arrives, the way the hold menu lights
 * each tile, and the up/down stepper on the other edge still walks one at a
 * time. The dial runs upward — 101 at the bottom — so its up, the stepper's up
 * and ArrowUp are one direction: a higher channel.
 */
export default function FeedChannelRail({
  activeIndex,
  onPick,
  side,
  hidden = false,
  newChannelIds,
  head,
}: {
  activeIndex: number
  onPick: (index: number) => void
  side: ControlSide
  hidden?: boolean
  /** Controls that stand at the TOP of this column, above the dial — the
   *  post's block and delete. The same seat the camera's grid and timer take
   *  above its filter wheel: about the thing on screen, on the column the
   *  other rail leaves free. */
  head?: ReactNode
  /** Channels holding a pop the radius delivered that this viewer has not
   *  opened. Those tiles wear the NEW burst; it comes off the moment the
   *  channel is visited (FeedTwin marks the channel's pops seen on arrival). */
  newChannelIds?: ReadonlySet<string>
}) {
  const items = useMemo(() => CHANNELS.map(channel => ({
    id: channel.id,
    label: channel.name,
    render: () => (
      <span className={styles.tile}>
        <img
          className={styles.art}
          src={channelUrl(`${channel.icon}.png`)}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
        {newChannelIds?.has(channel.id) && (
          <img
            className={styles.newBadge}
            src="new-badge.png"
            alt="New pops"
            draggable={false}
            decoding="async"
          />
        )}
      </span>
    ),
  })), [newChannelIds])
  const selectedId = CHANNELS[activeIndex]?.id ?? CHANNELS[0]?.id ?? ''

  return (
    <div
      className={`${dialStyles.rail} ${side === 'right' ? dialStyles.right : dialStyles.left}${hidden ? ` ${styles.railHidden}` : ''}`}
      data-feed-channel-rail=""
      // The feed beneath owns vertical swipes (channel change) and horizontal
      // edge taps (post change). The wheel takes its own pointer first, then
      // this stops the gesture reaching the feed so a scrub is one thing.
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      // A trackpad wheel over the dial scrubs it; the feed's own channel pager
      // must not also see that wheel and step a second time.
      onWheel={event => event.stopPropagation()}
    >
      {head && <div className={styles.head}>{head}</div>}
      <div className={dialStyles.wheelBox}>
      <ClayWheel
        items={items}
        selectedId={selectedId}
        onSelect={id => {
          const index = CHANNELS.findIndex(channel => channel.id === id)
          if (index >= 0 && index !== activeIndex) onPick(index)
        }}
        ariaLabel="Channels"
        side={side}
        {...SIDE_DIAL_PRESENTATION}
        // Not flipped: the list runs UPWARD, 101 at the bottom, so up on the
        // dial, up on the stepper opposite and ArrowUp all mean the same thing
        // — a higher channel, the way a television counts.
        // goToChannel already pops; a second detent from the wheel doubled it.
        notchSound={false}
      />
      </div>
    </div>
  )
}
