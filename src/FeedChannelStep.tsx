import SideControlIconButton from './SideControlIcon'
import type { ControlSide } from './controlPlacement'
import styles from './FeedChannelStep.module.css'

/**
 * The feed's channel stepper — up, the channel number, down — directly
 * beneath the control rail, sized by the same --poplur-feed-ctl tile so the
 * two read as one column.
 *
 * It is deliberately NOT a rail child: the rail is shared with Profile, and a
 * profile post has no channel to step, so the rail stays exactly itself.
 * The post ◀ ▶ pair that used to follow the channel pair is gone: the edge
 * tap already steps posts, and the three rows the pair cost were what kept
 * every button on a phone at 37px.
 */
export default function FeedChannelStep({
  side,
  channelNumber,
  onChannelUp,
  onChannelDown,
}: {
  side: ControlSide
  channelNumber: number
  onChannelUp: () => void
  onChannelDown: () => void
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
        fluid
        imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onActivate={onChannelUp}
      />
      <span className={styles.number} aria-hidden="true">{channelNumber}</span>
      <SideControlIconButton
        icon="global.channel_down"
        aria-label="Channel down"
        activation="pointerdown"
        fluid
        imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onActivate={onChannelDown}
      />
      {/* No post arrows here any more. Stepping through the people posting
          on a channel is the edge tap — the coach card teaches exactly that —
          and the sideways pair that duplicated it cost the column three rows,
          which on a phone squeezed every control to 37px. With the channel
          pair alone the column is nine rows and its buttons stand at the
          size of the clay chevrons beneath them. */}
    </div>
  )
}
