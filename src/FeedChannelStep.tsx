import SideControlIconButton from './SideControlIcon'
import type { ControlSide } from './controlPlacement'
import styles from './FeedChannelStep.module.css'

/**
 * The feed's own dials, in a tighter column directly beneath the control rail.
 *
 * They are deliberately NOT rail children: that rail pins every child to 44px,
 * and this many of them stands taller than the channel dial on the opposite
 * edge could ever be. At 34px — the dial's own tile size — the left column
 * ends on the same pixel as the right, which is what makes the two read as a
 * pair rather than two lists that happen to face each other.
 *
 * It lives here rather than in PostActionRail because a profile post has no
 * channel to step; the rail is shared with Profile and stays exactly itself.
 */
export default function FeedChannelStep({
  side,
  channelNumber,
  postActionsAvailable,
  onChannelUp,
  onChannelDown,
  onPostPrevious,
  onPostNext,
}: {
  side: ControlSide
  channelNumber: number
  postActionsAvailable: boolean
  onChannelUp: () => void
  onChannelDown: () => void
  onPostPrevious: () => void
  onPostNext: () => void
}) {
  return (
    <div
      className={`${styles.group} ${side === 'right' ? styles.groupRight : styles.groupLeft}`}
      role="group"
      aria-label="Channel and post controls"
      data-feed-channel-step=""
    >
      <SideControlIconButton
        icon="global.channel_up"
        aria-label="Channel up"
        activation="pointerdown"
        imageSize={30}
        onActivate={onChannelUp}
      />
      <span className={styles.number} aria-hidden="true">{channelNumber}</span>
      <SideControlIconButton
        icon="global.channel_down"
        aria-label="Channel down"
        activation="pointerdown"
        imageSize={30}
        onActivate={onChannelDown}
      />
      {/* The same two arrows turned on their side: up/down changes the
          channel, left/right walks the people posting on it. */}
      <SideControlIconButton
        icon="global.channel_up"
        aria-label="Previous post"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        imageSize={30}
        imageStyle={{ transform: 'rotate(-90deg)' }}
        onActivate={onPostPrevious}
      />
      <SideControlIconButton
        icon="global.channel_down"
        aria-label="Next post"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        imageSize={30}
        imageStyle={{ transform: 'rotate(-90deg)' }}
        onActivate={onPostNext}
      />
    </div>
  )
}
