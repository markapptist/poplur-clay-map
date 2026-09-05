import SideControlIconButton from './SideControlIcon'
import type { ControlSide } from './controlPlacement'
import type { ProfilePostStepAvailability, ProfilePostStepDirection } from './profilePostSteps'
import styles from './ProfilePostStep.module.css'

/**
 * The inner arrows under an opened profile post's action rail: the same four
 * chevrons the feed's channel stepper wears, here walking the grid the post
 * was opened from. Up and down are the tile above and below (one row, same
 * column); left and right are the previous and next tile in reading order.
 * An arrow with nowhere to go is disabled, not wrapped — the grid has edges.
 *
 * Like FeedChannelStep this is NOT a rail child: PostActionRail already
 * reserves this block beneath itself, and the column anchors to the home
 * chrome so it ends on the same line whatever the rail's height.
 */
const fit = { width: '100%', height: '100%', objectFit: 'contain' } as const

export default function ProfilePostStep({
  side,
  availability,
  onStep,
}: {
  side: ControlSide
  availability: ProfilePostStepAvailability
  onStep: (direction: ProfilePostStepDirection) => void
}) {
  return (
    <div
      className={`${styles.group} ${side === 'right' ? styles.groupRight : styles.groupLeft}`}
      role="group"
      aria-label="Browse this profile's posts"
      data-profile-post-step=""
    >
      <SideControlIconButton
        icon="global.channel_up"
        aria-label="Post above"
        activation="pointerdown"
        disabled={!availability.up}
        fluid
        imageStyle={fit}
        data-profile-post-step-dir="up"
        onActivate={() => onStep('up')}
      />
      <SideControlIconButton
        icon="global.channel_down"
        aria-label="Post below"
        activation="pointerdown"
        disabled={!availability.down}
        fluid
        imageStyle={fit}
        data-profile-post-step-dir="down"
        onActivate={() => onStep('down')}
      />
      {/* The same chevron turned on its side, exactly as the feed does for
          its previous/next post pair. */}
      <SideControlIconButton
        icon="global.channel_up"
        aria-label="Previous post"
        activation="pointerdown"
        disabled={!availability.left}
        fluid
        imageStyle={{ ...fit, transform: 'rotate(-90deg)' }}
        data-profile-post-step-dir="left"
        onActivate={() => onStep('left')}
      />
      <SideControlIconButton
        icon="global.channel_up"
        aria-label="Next post"
        activation="pointerdown"
        disabled={!availability.right}
        fluid
        imageStyle={{ ...fit, transform: 'rotate(90deg)' }}
        data-profile-post-step-dir="right"
        onActivate={() => onStep('right')}
      />
    </div>
  )
}
