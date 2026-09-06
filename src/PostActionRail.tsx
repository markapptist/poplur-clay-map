import type { ReactNode } from 'react'
import SideControlIconButton from './SideControlIcon'
import TabControlRail from './TabControlRail'
import type { ControlSide } from './controlPlacement'
import styles from './PostActionRail.module.css'

/**
 * The action rail shared by Feed and an opened Profile post.
 *
 * Keeping the markup here is intentional: these controls are a product
 * language, not two similar-looking copies that can drift apart over time.
 * Delete is optional because it only belongs to authenticated owner posts.
 */
/** The feed's channel stepper, which sits under this rail in the same column:
 *  four dial-sized controls, two readouts, five gaps and the seam above. In
 *  terms of the column's own variables, never a number — the stepper grows
 *  with the control size, and a literal would misreserve the moment it did. */
const FEED_STEPPER_RESERVE =
  'calc(4 * var(--poplur-feed-ctl) + 2 * var(--poplur-feed-number) + 5 * var(--poplur-feed-gap) + var(--poplur-feed-seam))'

export default function PostActionRail({
  side,
  label,
  muted,
  captionsOn,
  commentsOpen,
  onToggleMute,
  onShare,
  onToggleCaptions,
  onComment,
  onDMPoster,
  onLike,
  onDislike,
  postActionsAvailable = true,
  onShowOnMap,
  onDelete,
  deletePending = false,
  reserveBelow,
  head,
}: {
  side: ControlSide
  label: string
  muted: boolean
  captionsOn: boolean
  /** The comments window is up, so the one comments button now closes it. */
  commentsOpen: boolean
  onToggleMute: () => void
  onShare: () => void
  onToggleCaptions: () => void
  onComment: () => void
  /** Message the poster. Present only on somebody ELSE'S post that carries a
   *  stable owner id — your own post has nobody to DM. */
  onDMPoster?: () => void
  onLike: () => void
  onDislike: () => void
  /** Share, comment, and radius reactions require a concrete post. */
  postActionsAvailable?: boolean
  /** "Where was this posted?" — present only when the post carries a public
   *  origin the map can fly to (a profile's opened post does; a demo clip
   *  does not). */
  onShowOnMap?: () => void
  onDelete?: () => void
  deletePending?: boolean
  /** The room to leave below this rail for whatever shares its column. The
   *  default is the feed's channel stepper; an opened profile post has the
   *  four inner arrows instead, which are a shorter block, and reserving the
   *  feed's there left the rail overflowing its own box. */
  reserveBelow?: string
  /** Controls that belong to THIS post but are not rail actions — the feed's
   *  block button and its media timer, which used to ride on the shoulder of
   *  the channel dial opposite. Rendered above the actions so the rail reads
   *  top-down: what this post is, then what you can do with it. */
  head?: ReactNode
}) {
  return (
    // Fill, because this rail is one of the feed's PAIRED columns: it has to
    // reach the same bottom line as the channel dial opposite. The reserve is
    // the channel stepper's own block, which sits under this rail in the same
    // column — five dial-sized controls with 5px between them, plus the gap
    // above. Written in terms of --poplur-feed-dial, not a number: the stepper
    // grows with the dial, so a literal here would misreserve the moment the
    // column changed height.
    <TabControlRail
      side={side}
      label={label}
      fill
      fillReserveBelow={reserveBelow ?? FEED_STEPPER_RESERVE}
    >
      {head}
      <SideControlIconButton
        fluid
        icon="feed.mute"
        aria-label={muted ? 'Unmute feed video' : 'Mute feed video'}
        aria-pressed={muted}
        activation="pointerdown"
        onActivate={onToggleMute}
      />
      <SideControlIconButton
        fluid
        icon="feed.share"
        aria-label="Share post"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onShare}
      />
      <SideControlIconButton
        fluid
        icon="feed.captions"
        aria-label={captionsOn ? 'Turn closed captions off' : 'Turn closed captions on'}
        aria-pressed={captionsOn}
        onActivate={onToggleCaptions}
      />
      {/* One comments control. Showing, hiding and adding were three buttons
          for one idea — and the window you open to read is the same window you
          type into, so opening and closing belong on the same button. */}
      <SideControlIconButton
        fluid
        icon="feed.comment"
        aria-pressed={commentsOpen}
        aria-label={commentsOpen ? 'Hide comments' : 'Show comments and add one'}
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onComment}
      />
      {onDMPoster && (
        <SideControlIconButton
          fluid
          icon="feed.dm"
          aria-label="Message the poster"
          activation="pointerdown"
          disabled={!postActionsAvailable}
          onActivate={onDMPoster}
        />
      )}
      <SideControlIconButton
        fluid
        icon="feed.like"
        aria-label="Increase this post's radius by one"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onLike}
      />
      <SideControlIconButton
        fluid
        icon="feed.dislike"
        aria-label="Reduce this post's radius by one"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onDislike}
      />
      {onShowOnMap && (
        <SideControlIconButton
          fluid
          icon="profile.map"
          aria-label="See where this pop was posted on the map"
          activation="pointerdown"
          onActivate={onShowOnMap}
        />
      )}
      {onDelete && (
        <span className={deletePending ? styles.deletePending : undefined} aria-busy={deletePending || undefined}>
          <SideControlIconButton
            fluid
            icon="profile.delete"
            aria-label={deletePending ? 'Deleting this post' : 'Delete this post'}
            disabled={deletePending}
            loading={deletePending}
            onActivate={() => { if (!deletePending) onDelete() }}
          />
        </span>
      )}
    </TabControlRail>
  )
}
