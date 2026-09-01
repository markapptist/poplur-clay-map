import sideStyles from './SideControlIcon.module.css'
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
  channelNumber,
  onChannelUp,
  onChannelDown,
  onPostPrevious,
  onPostNext,
  channelIconUrl,
  channelName,
  postActionsAvailable = true,
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
  /** Feed only: step the TV's own channel, in the rail beside the screen it
   *  changes. Absent on a profile post, which has no channel to step. */
  channelNumber?: number
  onChannelUp?: () => void
  onChannelDown?: () => void
  /** Feed only: walk the other people posting on this channel. */
  onPostPrevious?: () => void
  onPostNext?: () => void
  channelIconUrl?: string
  channelName?: string
  /** Share, comment, and radius reactions require a concrete post. */
  postActionsAvailable?: boolean
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
        disabled={!postActionsAvailable}
        onActivate={onShare}
      />
      <SideControlIconButton
        icon="feed.captions"
        aria-label={captionsOn ? 'Turn closed captions off' : 'Turn closed captions on'}
        aria-pressed={captionsOn}
        onActivate={onToggleCaptions}
      />
      {/* One comments control. Showing, hiding and adding were three buttons
          for one idea — and the window you open to read is the same window you
          type into, so opening and closing belong on the same button. */}
      <SideControlIconButton
        icon="feed.comment"
        aria-pressed={commentsOpen}
        aria-label={commentsOpen ? 'Hide comments' : 'Show comments and add one'}
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onComment}
      />
      <SideControlIconButton
        icon="feed.like"
        aria-label="Increase this post's radius by one"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onLike}
      />
      <SideControlIconButton
        icon="feed.dislike"
        aria-label="Reduce this post's radius by one"
        activation="pointerdown"
        disabled={!postActionsAvailable}
        onActivate={onDislike}
      />
      {channelIconUrl && (
        // The channel you are on, wearing the same tile as every other side
        // control so the rail reads as one column rather than a column with an
        // ornament in it. It reports; the arrows beneath it do the changing.
        <span
          className={sideStyles.button}
          role="img"
          aria-label={channelName ? `Channel ${channelNumber} ${channelName}` : `Channel ${channelNumber}`}
          data-feed-channel-badge=""
        >
          <img className={sideStyles.image} src={channelIconUrl} alt="" draggable={false} />
        </span>
      )}
      {channelNumber != null && onChannelUp && onChannelDown && (
        <SideControlIconButton
          icon="global.channel_up"
          aria-label="Channel up"
          activation="pointerdown"
          onActivate={onChannelUp}
        />
      )}
      {channelNumber != null && (
        // The channel's only counter, sitting between the arrows that move it.
        <span className={styles.channelNumber} aria-hidden="true">{channelNumber}</span>
      )}
      {channelNumber != null && onChannelUp && onChannelDown && (
        <SideControlIconButton
          icon="global.channel_down"
          aria-label="Channel down"
          activation="pointerdown"
          onActivate={onChannelDown}
        />
      )}
      {onPostPrevious && onPostNext && (
        // The same two arrows turned on their side: up/down changes the
        // channel, left/right walks the people posting on it. The rail is a
        // strict 44px icon grid, so these are side buttons like everything
        // else in it rather than a wider clay cluster it would crush.
        <SideControlIconButton
          icon="global.channel_up"
          aria-label="Previous post"
          activation="pointerdown"
          disabled={!postActionsAvailable}
          imageStyle={{ transform: 'rotate(-90deg)' }}
          onActivate={onPostPrevious}
        />
      )}
      {onPostPrevious && onPostNext && (
        <SideControlIconButton
          icon="global.channel_down"
          aria-label="Next post"
          activation="pointerdown"
          disabled={!postActionsAvailable}
          imageStyle={{ transform: 'rotate(-90deg)' }}
          onActivate={onPostNext}
        />
      )}
      {onDelete && (
        <span className={deletePending ? styles.deletePending : undefined} aria-busy={deletePending || undefined}>
          <SideControlIconButton
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
