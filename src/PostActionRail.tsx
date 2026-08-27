import ClayCornerButton from './ClayCornerButton'
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
  commentsAtEnd,
  onToggleMute,
  onShare,
  onToggleCaptions,
  onToggleCommentsAtEnd,
  onComment,
  onLike,
  onDislike,
  onDelete,
  deletePending = false,
}: {
  side: ControlSide
  label: string
  muted: boolean
  captionsOn: boolean
  commentsAtEnd: boolean
  onToggleMute: () => void
  onShare: () => void
  onToggleCaptions: () => void
  onToggleCommentsAtEnd: () => void
  onComment: () => void
  onLike: () => void
  onDislike: () => void
  onDelete?: () => void
  deletePending?: boolean
}) {
  return (
    <TabControlRail side={side} label={label}>
      <SideControlIconButton
        icon="feed.mute"
        aria-label={muted ? 'Unmute feed video' : 'Mute feed video'}
        aria-pressed={muted}
        activation="pointerdown"
        onActivate={onToggleMute}
      />
      <SideControlIconButton
        icon="feed.share"
        aria-label="Share post"
        activation="pointerdown"
        onActivate={onShare}
      />
      <SideControlIconButton
        icon="feed.captions"
        aria-label={captionsOn ? 'Turn closed captions off' : 'Turn closed captions on'}
        aria-pressed={captionsOn}
        onActivate={onToggleCaptions}
      />
      <SideControlIconButton
        icon="feed.comments_collapse"
        aria-pressed={commentsAtEnd}
        aria-label={commentsAtEnd ? 'Hide end-of-video comments' : 'Show end-of-video comments'}
        activation="pointerdown"
        onActivate={onToggleCommentsAtEnd}
      />
      <SideControlIconButton
        icon="feed.comment"
        aria-label="Comment on this post"
        activation="pointerdown"
        onActivate={onComment}
      />
      <SideControlIconButton
        icon="feed.like"
        aria-label="Increase this post's radius by one"
        activation="pointerdown"
        onActivate={onLike}
      />
      <SideControlIconButton
        icon="feed.dislike"
        aria-label="Reduce this post's radius by one"
        activation="pointerdown"
        onActivate={onDislike}
      />
      {onDelete && (
        <span className={deletePending ? styles.deletePending : undefined} aria-busy={deletePending || undefined}>
          <ClayCornerButton
            kind="delete"
            label={deletePending ? 'Deleting this post' : 'Delete this post'}
            size={44}
            still
            activateOnClick
            onPress={() => { if (!deletePending) onDelete() }}
          />
        </span>
      )}
    </TabControlRail>
  )
}
