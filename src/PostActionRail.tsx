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
  onLike,
  onDislike,
  postActionsAvailable = true,
  onShowOnMap,
  onDelete,
  deletePending = false,
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
      fillReserveBelow="calc(4 * var(--poplur-feed-ctl) + var(--poplur-feed-number) + 4 * var(--poplur-feed-gap) + var(--poplur-feed-seam))"
    >
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
