import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import styles from './MessageTimeline.module.css'
import ProfilePostPreview from './ProfilePostPreview'
import ShaderVideoPlayer from './ShaderVideoPlayer'
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
import { presentableHandle, timelineRows, timelineStats } from './messageTimelineRows'

/** A profile nested inside Messages. Its list and individual message views
 * stay on that screen; closing them never selects the main Profile or Browser.
 * The same authored-post projection keeps edits and deletions live here. */

function postIsVideo(post: RealtimeProfilePost): boolean {
  return post.mediaType === 'video'
    || (post.mediaType == null && /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(post.video))
}

function postPoster(post: RealtimeProfilePost): string {
  if (post.poster) return post.poster
  if (!postIsVideo(post)) return post.video
  return 'logo_icon.png'
}

export default function MessageTimeline({ viewUser = null, bindBack, active = true }: {
  viewUser?: string | null
  bindBack?: (back: (() => boolean) | null) => void
  active?: boolean
}) {
  const [openedPostId, setOpenedPostId] = useState<string | null>(null)
  useEffect(() => {
    bindBack?.(() => {
      if (!openedPostId) return false
      setOpenedPostId(null)
      return true
    })
    return () => bindBack?.(null)
  }, [bindBack, openedPostId])

  // NOT useSyncExternalStore: accountSnapshot() builds a fresh object per call
  // (a new identity every read = an infinite re-render), so subscribe the way
  // ProfileTwin does — a state seeded from the store, kept current by its
  // listener, which also fires once on subscribe with the latest value.
  const [account, setAccount] = useState(accountSnapshot)
  useEffect(() => onAccountChange(setAccount), [])
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
  const openedPost = rows.find(post => post.id === openedPostId)
  const displayedRows = openedPost ? [openedPost] : rows

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
    setOpenedPostId(post.id)
  }

  return (
    <section className={styles.screen} aria-label={openedPost ? 'Pop Message' : 'Pop Messages'} data-clay-scroll>
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
          {displayedRows.map((post, index) => {
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
                      {openedPost && postIsVideo(post)
                        ? <ShaderVideoPlayer src={post.video} poster={post.poster} active={active} />
                        : <ProfilePostPreview src={postPoster(post)} />}
                      {postIsVideo(post) && !openedPost && <span>Video</span>}
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
                {visiting || !post.id || openedPost
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
    </section>
  )
}
