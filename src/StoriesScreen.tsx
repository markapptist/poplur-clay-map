import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { accountSnapshot } from './accountStore'
import { feedUrl } from './assetPacks'
import { isNativeShell } from './nativeBridge'
import { playPop } from './pop'
import {
  nativeStoriesSnapshot,
  onNativeStories,
  reactToStory,
  replyToStory,
  requestNativeStories,
  setStoryHighlighted,
  storySections,
  voteOnStory,
  type PoplurStory,
  type StorySections,
} from './stories'
import styles from './StoriesScreen.module.css'

type Shelf = keyof StorySections

const REACTIONS = ['♥', '🔥', '😂', '👏'] as const
const STICKER_LABEL: Record<NonNullable<PoplurStory['sticker']>, string> = {
  heart: '♥',
  here: 'HERE',
  live: 'LIVE',
  hype: 'HYPE',
  call: 'CALL',
}

function fallbackStories(now: number): PoplurStory[] {
  const me = accountSnapshot()
  const ownerName = me.username ? `@${me.username.replace(/^@/, '')}` : '@you'
  return [
    {
      id: 'preview-your-story',
      ownerId: me.uid ?? 'preview-you',
      username: ownerName,
      mediaURL: feedUrl('ad-food.mp4'),
      mediaType: 'video',
      posterURL: feedUrl('posters/ad-food.jpg'),
      caption: 'late-night poutine run @nightmarket',
      createdAtMillis: now - 11 * 60_000,
      expiresAtMillis: now + 23 * 60 * 60_000,
      audience: 'public',
      isOwner: true,
      highlighted: false,
      repliesAllowed: true,
      mentions: ['@nightmarket'],
      sticker: 'here',
      music: { title: 'Pink City', artist: 'Poplur Radio' },
      poll: { question: 'Gravy first or curds first?', options: ['Gravy', 'Curds'], counts: [28, 41] },
    },
    {
      id: 'preview-favorite-story',
      ownerId: 'preview-favorite',
      username: '@basement.set',
      mediaURL: feedUrl('ad-music.mp4'),
      mediaType: 'video',
      posterURL: feedUrl('posters/ad-music.jpg'),
      caption: 'soundcheck before the doors open',
      createdAtMillis: now - 44 * 60_000,
      expiresAtMillis: now + 20 * 60 * 60_000,
      audience: 'favorites',
      isOwner: false,
      highlighted: true,
      repliesAllowed: true,
      mentions: [],
      sticker: 'live',
      music: { title: 'Warehouse Test', artist: 'Basement Set' },
    },
    {
      id: 'preview-archive-story',
      ownerId: me.uid ?? 'preview-you',
      username: ownerName,
      mediaURL: feedUrl('ad-sports.mp4'),
      mediaType: 'video',
      posterURL: feedUrl('posters/ad-sports.jpg'),
      caption: 'last week at the match',
      createdAtMillis: now - 5 * 24 * 60 * 60_000,
      expiresAtMillis: now - 4 * 24 * 60 * 60_000,
      audience: 'public',
      isOwner: true,
      highlighted: true,
      repliesAllowed: false,
      mentions: [],
    },
  ]
}

function timeLabel(story: PoplurStory, now: number): string {
  if (story.expiresAtMillis <= now) {
    return new Date(story.createdAtMillis).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  const minutes = Math.max(1, Math.floor((now - story.createdAtMillis) / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

function renderCaption(caption: string) {
  return caption.split(/(@[a-z0-9_.]+)/gi).map((part, index) => (
    /^@[a-z0-9_.]+$/i.test(part)
      ? <b key={`${part}-${index}`} className={styles.mention}>{part}</b>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  ))
}

export default function StoriesScreen({
  onCreate,
  onClose,
  bindBack,
}: {
  onCreate: () => void
  onClose: () => void
  bindBack?: (fn: (() => boolean) | null) => void
}) {
  const liveStories = useSyncExternalStore(onNativeStories, nativeStoriesSnapshot, nativeStoriesSnapshot)
  const previewNow = useRef(Date.now()).current
  const stories = isNativeShell() ? liveStories : liveStories.length ? liveStories : fallbackStories(previewNow)
  const [now, setNow] = useState(previewNow)
  const [shelf, setShelf] = useState<Shelf>('today')
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [reply, setReply] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [reactions, setReactions] = useState<Record<string, string>>({})
  const [votes, setVotes] = useState<Record<string, number>>({})
  const [highlightOverrides, setHighlightOverrides] = useState<Record<string, boolean>>({})
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    requestNativeStories()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const settledStories = useMemo(() => stories.map(story => (
    highlightOverrides[story.id] === undefined
      ? story
      : { ...story, highlighted: highlightOverrides[story.id] }
  )), [highlightOverrides, stories])
  const sections = useMemo(() => storySections(settledStories, now), [now, settledStories])
  const visible = sections[shelf]
  const viewedStory = viewerIndex === null ? null : visible[viewerIndex] ?? null

  const closeViewer = () => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    videoRef.current = null
    setViewerIndex(null)
    setReply('')
    setNotice(null)
  }

  useEffect(() => {
    bindBack?.(() => {
      if (viewerIndex === null) return false
      closeViewer()
      return true
    })
    return () => bindBack?.(null)
  }, [bindBack, viewerIndex])

  const advance = (delta = 1) => {
    if (viewerIndex === null) return
    const next = viewerIndex + delta
    if (next < 0 || next >= visible.length) {
      closeViewer()
      return
    }
    setViewerIndex(next)
    setReply('')
    setNotice(null)
  }

  useEffect(() => {
    if (!viewedStory || viewedStory.mediaType === 'video' || document.hidden) return
    const timer = window.setTimeout(() => advance(1), 6_500)
    return () => window.clearTimeout(timer)
  }, [viewedStory?.id])

  useEffect(() => {
    if (viewerIndex !== null && !viewedStory) closeViewer()
  }, [viewedStory, viewerIndex])

  const chooseShelf = (next: Shelf) => {
    playPop(.18)
    closeViewer()
    setShelf(next)
  }

  const sendReply = () => {
    if (!viewedStory || !reply.trim()) return
    playPop(.2)
    const sent = replyToStory(viewedStory.id, viewedStory.ownerId, reply)
    setReply('')
    setNotice(sent ? 'Reply sent to Mail.' : 'Replies send from the signed-in app.')
  }

  const toggleHighlight = (story: PoplurStory) => {
    const highlighted = !(highlightOverrides[story.id] ?? story.highlighted)
    playPop(.2)
    setHighlightOverrides(current => ({ ...current, [story.id]: highlighted }))
    if (!setStoryHighlighted(story.id, highlighted)) {
      setNotice(isNativeShell() ? 'Highlight could not be changed.' : 'Highlight preview updated on this screen.')
    }
  }

  return (
    <section className={styles.screen} data-poplur-screen="stories" aria-label="Poplur Stories">
      <header className={styles.header}>
        <div>
          <span>POPLUR DAILY</span>
          <h1>STORIES</h1>
        </div>
        <button
          type="button"
          className={styles.addStory}
          onClick={() => { playPop(); onCreate() }}
          aria-label="Create a Story"
        >
          <b aria-hidden="true">＋</b>
          <span>ADD STORY</span>
        </button>
      </header>

      <nav className={styles.tabs} aria-label="Story shelves">
        {([
          ['today', 'TODAY', sections.today.length],
          ['highlights', 'HIGHLIGHTS', sections.highlights.length],
          ['archive', 'ARCHIVE', sections.archive.length],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={shelf === id ? styles.tabOn : styles.tab}
            onClick={() => chooseShelf(id)}
            aria-pressed={shelf === id}
          >
            {label}<small>{count}</small>
          </button>
        ))}
      </nav>

      {visible.length ? (
        <div className={styles.storyGrid}>
          {visible.map((story, index) => (
            <button
              key={story.id}
              type="button"
              className={styles.storyCard}
              onClick={() => { playPop(.18); setViewerIndex(index) }}
              aria-label={`Open ${story.username}'s Story`}
            >
              <span className={styles.storyImage}>
                <img src={story.posterURL ?? story.mediaURL} alt="" draggable={false} />
                {story.mediaType === 'video' && <i aria-hidden="true">▶</i>}
                {story.audience === 'favorites' && <em>★ FAVORITES</em>}
              </span>
              <span className={styles.storyMeta}>
                <strong>{story.isOwner ? 'YOUR STORY' : story.username}</strong>
                <small>{story.highlighted ? '◆ HIGHLIGHT · ' : ''}{timeLabel(story, now)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <img src="/logo_icon.png" alt="" />
          <h2>{shelf === 'today' ? 'Nothing expires today.' : shelf === 'archive' ? 'Your archive starts after 24 hours.' : 'No highlights yet.'}</h2>
          <p>{shelf === 'today' ? 'Share a quick photo or clip without choosing a map spot.' : 'Only you can see Archive. Promote a memory to keep it in Highlights.'}</p>
          {shelf === 'today' && <button type="button" onClick={onCreate}>ADD YOUR STORY</button>}
        </div>
      )}

      <footer className={styles.privacyNote}>
        <b>NO COORDINATES SHOWN</b>
        <span>Stories never display where they were posted. Favorites means people you starred in Poplur Phone—not followers.</span>
      </footer>

      {viewedStory && (
        <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={`${viewedStory.username}'s Story`}>
          <div className={styles.progress} aria-hidden="true">
            {visible.map((story, index) => (
              <i key={story.id} data-state={index < viewerIndex! ? 'done' : index === viewerIndex ? 'active' : 'waiting'} />
            ))}
          </div>
          {viewedStory.mediaType === 'video' ? (
            <video
              ref={videoRef}
              key={viewedStory.id}
              className={styles.viewerMedia}
              src={viewedStory.mediaURL}
              poster={viewedStory.posterURL}
              autoPlay
              playsInline
              onEnded={() => advance(1)}
            />
          ) : (
            <img className={styles.viewerMedia} src={viewedStory.mediaURL} alt="Story" />
          )}
          <div className={styles.viewerShade} aria-hidden="true" />
          <button type="button" className={styles.previous} onClick={() => advance(-1)} aria-label="Previous Story" />
          <button type="button" className={styles.next} onClick={() => advance(1)} aria-label="Next Story" />
          <header className={styles.viewerHeader}>
            <span className={styles.avatar}>{viewedStory.username.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
            <div><strong>{viewedStory.isOwner ? 'Your Story' : viewedStory.username}</strong><small>{timeLabel(viewedStory, now)} · {viewedStory.audience === 'favorites' ? 'Favorites' : 'Everyone'}</small></div>
            {viewedStory.isOwner && (
              <button type="button" onClick={() => toggleHighlight(viewedStory)}>
                {highlightOverrides[viewedStory.id] ?? viewedStory.highlighted ? '◆ HIGHLIGHT' : '◇ HIGHLIGHT'}
              </button>
            )}
          </header>
          <div className={styles.viewerBody}>
            {viewedStory.music && <div className={styles.music}>♫ <b>{viewedStory.music.title}</b>{viewedStory.music.artist ? ` · ${viewedStory.music.artist}` : ''}</div>}
            {viewedStory.sticker && <span className={styles.sticker} data-sticker={viewedStory.sticker}>{STICKER_LABEL[viewedStory.sticker]}</span>}
            {viewedStory.caption && <p>{renderCaption(viewedStory.caption)}</p>}
            {viewedStory.poll && (
              <section className={styles.poll} aria-label="Story poll">
                <strong>{viewedStory.poll.question}</strong>
                {viewedStory.poll.options.map((option, optionIndex) => {
                  const chosen = votes[viewedStory.id] ?? viewedStory.poll?.selectedIndex
                  const total = viewedStory.poll!.counts.reduce((sum, count) => sum + count, 0) + (chosen === optionIndex && viewedStory.poll!.selectedIndex === undefined ? 1 : 0)
                  const count = viewedStory.poll!.counts[optionIndex] + (chosen === optionIndex && viewedStory.poll!.selectedIndex === undefined ? 1 : 0)
                  return (
                    <button
                      key={option}
                      type="button"
                      data-selected={chosen === optionIndex}
                      onClick={() => {
                        playPop(.18)
                        setVotes(current => ({ ...current, [viewedStory.id]: optionIndex }))
                        voteOnStory(viewedStory.id, optionIndex)
                      }}
                    >
                      <span>{option}</span><b>{chosen === undefined ? 'VOTE' : `${Math.round(count / Math.max(1, total) * 100)}%`}</b>
                    </button>
                  )
                })}
              </section>
            )}
            {!viewedStory.isOwner && (
              <div className={styles.reactions} aria-label="React to Story">
                {REACTIONS.map(reaction => (
                  <button
                    key={reaction}
                    type="button"
                    data-selected={(reactions[viewedStory.id] ?? viewedStory.reaction) === reaction}
                    onClick={() => {
                      playPop(.16)
                      setReactions(current => ({ ...current, [viewedStory.id]: reaction }))
                      reactToStory(viewedStory.id, reaction)
                    }}
                  >{reaction}</button>
                ))}
              </div>
            )}
            {!viewedStory.isOwner && viewedStory.repliesAllowed && (
              <form className={styles.reply} onSubmit={event => { event.preventDefault(); sendReply() }}>
                <input value={reply} maxLength={500} onChange={event => setReply(event.target.value)} placeholder={`Reply to ${viewedStory.username}…`} />
                <button type="submit" disabled={!reply.trim()}>SEND</button>
              </form>
            )}
            {notice && <output className={styles.notice}>{notice}</output>}
          </div>
        </div>
      )}
    </section>
  )
}
