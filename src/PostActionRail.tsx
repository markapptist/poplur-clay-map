import { useId } from 'react'
import ClayCornerButton from './ClayCornerButton'
import ClayMuteButton from './ClayMuteButton'
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
  const prefix = useId().replace(/:/g, '')
  const gradient = (name: string) => `${prefix}-${name}`

  return (
    <TabControlRail side={side} label={label}>
      <ClayMuteButton muted={muted} onToggle={onToggleMute} size={44} />
      <ClayCornerButton kind="share" label="Share this post" size={44} still onPress={onShare} />
      <button
        type="button"
        className={styles.ccGlyphButton}
        aria-label={captionsOn ? 'Turn closed captions off' : 'Turn closed captions on'}
        aria-pressed={captionsOn}
        onClick={onToggleCaptions}
      >
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" className={styles.ccGlyph}>
          <defs>
            <linearGradient id={gradient('face')} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#ffb3d7" /><stop offset=".46" stopColor="#f24c9c" /><stop offset="1" stopColor="#8d124d" />
            </linearGradient>
            <linearGradient id={gradient('edge')} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#a81558" /><stop offset="1" stopColor="#510725" />
            </linearGradient>
            <radialGradient id={gradient('glow')} cx="35%" cy="20%" r="78%">
              <stop stopColor="#d9fbff" /><stop offset=".45" stopColor="#6ee7fa" /><stop offset="1" stopColor="#228bbd" />
            </radialGradient>
          </defs>
          <path d="M9 35 24 43 39 35 24 28Z" fill="rgba(0,0,0,.42)" />
          <path d="M8 16v19l16 9V25Z" fill={`url(#${gradient('edge')})`} />
          <path d="M40 16v19l-16 9V25Z" fill={`url(#${gradient('edge')})`} />
          <path d="M24 5 40 14 24 25 8 14Z" fill={`url(#${gradient('face')})`} />
          <text
            x="24"
            y="18.5"
            textAnchor="middle"
            className={styles.ccText}
            fill={captionsOn ? `url(#${gradient('glow')})` : '#fff2f8'}
          >CC</text>
          <path d="M24 5 40 14 24 25 8 14Z" fill="none" stroke="rgba(20,4,12,.55)" strokeWidth="1" />
          <path d="M8 14v21l16 9 16-9V14M24 25v19" fill="none" stroke="rgba(20,4,12,.4)" strokeWidth="1" />
        </svg>
      </button>
      <ClayCornerButton
        kind="comments"
        active={commentsAtEnd}
        label={commentsAtEnd ? 'Hide end-of-video comments' : 'Show end-of-video comments'}
        size={44}
        still
        onPress={onToggleCommentsAtEnd}
      />
      <ClayCornerButton kind="comment" label="Comment on this post" size={44} still onPress={onComment} />
      <ClayCornerButton
        kind="thumbUp"
        label="Increase this post's radius by one"
        size={44}
        still
        prism
        onPress={onLike}
      />
      <ClayCornerButton
        kind="thumbDown"
        label="Reduce this post's radius by one"
        size={44}
        still
        prism
        onPress={onDislike}
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
