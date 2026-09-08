import { useState } from 'react'
import { VERIFIED_CHECK_SRC, type VerifiedCheckKind } from './verifiedCheck'
import styles from './FeedAuthor.module.css'

/** Always visible identity, with no scrolling/fading text or extra render loop. */
export default function FeedAuthor({ username, caption, avatarURL, verified, onOpen, own = false }: {
  username: string
  caption: string
  avatarURL?: string | null
  verified: VerifiedCheckKind | null
  onOpen?: () => void
  own?: boolean
}) {
  const [failedURL, setFailedURL] = useState<string | null>(null)
  const initials = username.replace(/^@/, '').slice(0, 2).toUpperCase() || 'P'
  const content = <>
    <span className={styles.avatar} aria-hidden="true">
      {avatarURL && avatarURL !== failedURL
        ? <img src={avatarURL} alt="" draggable={false} onError={() => setFailedURL(avatarURL)} />
        : initials}
    </span>
    <span className={styles.copy}>
      <span className={styles.identity}>
        <span className={styles.username}>{username}</span>
        {verified && <img src={VERIFIED_CHECK_SRC[verified]} className={styles.verified} alt="Verified" draggable={false} />}
      </span>
      <span className={styles.caption} title={caption}>{caption}</span>
    </span>
  </>
  return onOpen
    ? <button className={styles.author} type="button" data-feed-byline="true"
      aria-label={`${username}. ${caption}. ${own ? 'Open your profile' : `Open ${username}'s profile`}`}
      onClick={onOpen}>{content}</button>
    : <div className={styles.author} data-feed-byline="true">{content}</div>
}
