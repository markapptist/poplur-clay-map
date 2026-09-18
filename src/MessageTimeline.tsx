import { useMemo, useState, useSyncExternalStore } from 'react'
import styles from './MessageTimeline.module.css'
import ProfilePostPreview from './ProfilePostPreview'
import { accountSnapshot, onAccountChange } from './accountStore'
import { useAuthoredPosts } from './useAuthoredPosts'
import { nativeFeedPostsSnapshot, onNativeFeedPosts } from './nativeFeedPosts'
import {
  profilePostsFromRealtime,
  profileRecipientUid,
  visitedProfilePhoto,
  type RealtimeProfilePost,
} from './profileRealtimePosts'
import { relativeWhen } from './newsMessages'
import { playPop } from './pop'
import { takeMessageTimelineRequest } from './messageTimelineRequest'
import { presentableHandle, timelineRows, timelineStats } from './messageTimelineRows'

/**
 * Your Pop Messages as a timeline — the profile a message deserves, in the
 * shape people already read one in: who, when, the whole text, how far it
 * went. Opened from News' drawer ("Profile · Your messages") and from a news
 * author's name; the Messages TAB this replaces on the profile page is gone,
 * so this is the one place a message timeline lives.
 *
 * A hold-menu subscreen, like Notifications — not a fourth tab. It reads the
 * same shared post snapshot the profile grid does and the same per-account
 * projection, so a message that exists on the profile exists here, and a
 * deleted one leaves both without a reload.
 *
 * Tapping your own message opens the pop itself — comments, delete, its
 * radius on the card — through the same route a notification about it takes.
 * Someone else's timeline is read-only: their text is here in full, and the
 * routes that open a pop all assume the profile behind it is yours.
 */

function postIsVideo(post: RealtimeProfilePost): boolean {
  return post.mediaType === 'video'
    || (post.mediaType == null && /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(post.video))
}

function postPoster(post: RealtimeProfilePost): string {
  if (post.poster) return post.poster
  if (!postIsVideo(post)) return post.video
  return 'logo_icon.png'
}

export default function MessageTimeline({ onClose }: { onClose: () => void }) {
  // Taken ONCE, on mount — see messageTimelineRequest. A useState initializer
  // is the one place that runs exactly once per instance.
  const [request] = useState(() => takeMessageTimelineRequest())
  const viewUser = request?.handle ?? null

  const account = useSyncExternalStore(onAccountChange, accountSnapshot, accountSnapshot)
  const realtimePosts = useSyncExternalStore(onNativeFeedPosts, nativeFeedPostsSnapshot, nativeFeedPostsSnapshot)

  // Whose posts: the visited handle resolved to its stable uid off the shared
  // post wire, exactly as the profile grid does — never the handle alone.
  const authoredUid = viewUser ? profileRecipientUid(realtimePosts, viewUser) : account.uid
  const authored = useAuthoredPosts(authoredUid)

  const posts = useMemo(
    () => profilePostsFromRealtime(authored.snapshot?.posts ?? realtimePosts, account.uid, viewUser, null),
    [authored.snapshot, realtimePosts, account.uid, viewUser],
  )
  const rows = useMemo(() => timelineRows(posts), [posts])
  const stats = timelineStats(rows)

  const visiting = Boolean(viewUser)
  const photo = visiting
    ? visitedProfilePhoto(realtimePosts, authoredUid, viewUser)
    : account.photoURL
  const name = visiting
    ? presentableHandle(viewUser)
    : (account.displayName?.trim() || account.username?.trim() || 'You')
  const handle = visiting ? '' : presentableHandle(account.username)

  const openPop = (post: RealtimeProfilePost) => {
    if (visiting || !post.id) return
    playPop()
    // The same route a notification about this pop takes: the shell closes
    // this menu, lands on the profile, and the pop opens in its viewer.
    window.dispatchEvent(new CustomEvent('poplur-open-post-notification', {
      detail: { postId: post.id, comments: false },
    }))
  }

  return (
    <section className={styles.screen} aria-label="Pop Messages" data-clay-scroll>
      <header className={styles.head}>
        <div className={styles.who}>
          <span className={styles.avatar} aria-hidden="true">
            {photo
              ? <img src={photo} alt="" draggable={false} />
              : <i>{(name.replace(/^@/, '')[0] ?? 'P').toUpperCase()}</i>}
          </span>
          <div className={styles.names}>
            <strong>{name}</strong>
            {handle && <span>{handle}</span>}
          </div>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Pop Messages</dt>
            <dd>{stats.count}</dd>
          </div>
          <div>
            <dt>Reach</dt>
            <dd>{stats.reachKm.toFixed(1)}<small> km</small></dd>
          </div>
        </dl>
        <p className={styles.line}>
          {visiting ? 'What they have said, in full.' : 'Everything you have said, in full — newest first.'}
        </p>
      </header>

      {authored.loading && rows.length === 0 ? (
        <p className={styles.empty} role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{visiting ? 'No Pop Messages yet.' : 'No Pop Messages yet. Write one from News.'}</p>
      ) : (
        <ol className={styles.timeline}>
          {rows.map((post, index) => {
            const body = (
              <>
                <span className={styles.rowAvatar} aria-hidden="true">
                  {photo ? <img src={photo} alt="" draggable={false} /> : <i>{(name.replace(/^@/, '')[0] ?? 'P').toUpperCase()}</i>}
                </span>
                <div className={styles.body}>
                  <div className={styles.top}>
                    <strong>{name}</strong>
                    {handle && <span className={styles.handle}>{handle}</span>}
                    <span className={styles.ch}>{post.ch}</span>
                    {post.createdAtMillis ? <time className={styles.when}>{relativeWhen(post.createdAtMillis)}</time> : null}
                  </div>
                  <p className={styles.text}>{post.title}</p>
                  {!post.messageCard && (
                    <span className={styles.attachment}>
                      <ProfilePostPreview src={postPoster(post)} />
                      {postIsVideo(post) && <span>Video</span>}
                    </span>
                  )}
                  {post.reachKm != null && (
                    <span className={styles.radius}>
                      <i aria-hidden="true">◆</i>{post.reachKm.toFixed(1)} km
                    </span>
                  )}
                </div>
              </>
            )
            const key = `${post.id ?? post.video}-${index}`
            return (
              <li key={key} className={styles.row}>
                {visiting || !post.id
                  ? <div className={styles.rowInner}>{body}</div>
                  : (
                    <button
                      type="button"
                      className={`${styles.rowInner} ${styles.rowOpen}`}
                      aria-label={`Open Pop Message: ${post.title}`}
                      onClick={() => openPop(post)}
                    >
                      {body}
                    </button>
                  )}
              </li>
            )
          })}
        </ol>
      )}

      <button type="button" className={styles.close} onClick={onClose}>CLOSE</button>
    </section>
  )
}
