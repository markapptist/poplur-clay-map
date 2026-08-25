import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import ClayCornerButton from './ClayCornerButton'
import { CHANNELS } from './FeedTwin'
import { OTHER_POPS, POIS } from './data'
import {
  FEED_DISCOVERY_MODES,
  feedDiscoverySnapshot,
  focusDiscoveryPost,
  onFeedDiscoveryChange,
  resetFeedDiscovery,
  searchDiscovery,
  setFeedDiscoveryMode,
  type DiscoveryDocument,
  type DiscoveryKind,
} from './feedDiscovery'
import {
  nativeFeedPostsSnapshot,
  onNativeFeedPosts,
  requestNativeFeedPosts,
} from './nativeFeedPosts'
import { postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import { requestProfileMode } from './profileMode'
import styles from './DiscoveryScreen.module.css'

type Scope = 'all' | DiscoveryKind

const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'post', label: 'POSTS' },
  { id: 'person', label: 'PEOPLE' },
  { id: 'place', label: 'PLACES' },
  { id: 'topic', label: 'TOPICS' },
]

function discoveryDocuments(): DiscoveryDocument[] {
  const nativePosts = nativeFeedPostsSnapshot()
  const posts: DiscoveryDocument[] = nativePosts.length
    ? nativePosts.map(post => ({
      id: `post:${post.id}`,
      kind: 'post',
      title: post.caption ?? `${post.username} on ${post.channelId}`,
      subtitle: `${post.username} · ${post.channelId}`,
      keywords: [post.username, post.channelId],
      channelId: post.channelId,
      postId: post.id,
      priority: Math.log1p(post.viewCount ?? 0) * 8
        + Math.log1p((post.radiusMeters ?? 0) / 1_000) * 6,
    }))
    : CHANNELS.map(channel => ({
      id: `post:preview:${channel.id}`,
      kind: 'post',
      title: channel.caption,
      subtitle: `${channel.user} · ${channel.name}`,
      keywords: [channel.id, channel.name, channel.user],
      channelId: channel.id,
      postId: `preview:${channel.id}`,
      priority: 20 - channel.number / 100,
    }))

  const peopleByHandle = new Map<string, DiscoveryDocument>()
  const addPerson = (handle: string, channelId?: string, priority = 0) => {
    const clean = handle.startsWith('@') ? handle : `@${handle}`
    if (peopleByHandle.has(clean)) return
    peopleByHandle.set(clean, {
      id: `person:${clean}`,
      kind: 'person',
      title: clean,
      subtitle: channelId ? `${channelId} creator` : 'Poplur creator',
      keywords: [clean.replace('@', ''), channelId ?? ''],
      handle: clean,
      channelId,
      priority,
    })
  }
  nativePosts.forEach(post => addPerson(post.username, post.channelId, 30))
  CHANNELS.forEach(channel => addPerson(channel.user, channel.id, 18))
  OTHER_POPS.forEach(pop => addPerson(pop.user, pop.channel, pop.world ? 14 : 22))

  const places: DiscoveryDocument[] = [
    ...POIS.map(place => ({
      id: `place:mine:${place.id}`,
      kind: 'place' as const,
      title: place.name,
      subtitle: `${place.category} · ${place.channel}`,
      keywords: [place.category, place.channel],
      channelId: place.channel,
      coords: place.coords,
      priority: 40 + place.likes / 10,
    })),
    ...OTHER_POPS.map(place => ({
      id: `place:other:${place.id}`,
      kind: 'place' as const,
      title: place.name,
      subtitle: `${place.user} · ${place.channel}`,
      keywords: [place.user, place.channel],
      channelId: place.channel,
      coords: place.coords,
      priority: place.world ? 12 : 28,
    })),
  ]

  const topics: DiscoveryDocument[] = CHANNELS.map(channel => ({
    id: `topic:${channel.id}`,
    kind: 'topic',
    title: `#${channel.id}`,
    subtitle: `${channel.name} · CH ${channel.number}`,
    keywords: [channel.caption, channel.user, channel.name],
    channelId: channel.id,
    priority: channel.id === 'live' ? 34 : 24,
  }))

  return [...posts, ...peopleByHandle.values(), ...places, ...topics]
}

function iconFor(kind: DiscoveryKind): string {
  if (kind === 'person') return '◎'
  if (kind === 'place') return '⌖'
  if (kind === 'topic') return '#'
  return '▶'
}

export default function DiscoveryScreen({
  onClose,
  onTune,
}: {
  onClose: () => void
  onTune?: (channelId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [resetArmed, setResetArmed] = useState(false)
  const posts = useSyncExternalStore(onNativeFeedPosts, nativeFeedPostsSnapshot, nativeFeedPostsSnapshot)
  const discovery = useSyncExternalStore(
    onFeedDiscoveryChange,
    feedDiscoverySnapshot,
    feedDiscoverySnapshot,
  )

  useEffect(() => { requestNativeFeedPosts() }, [])
  useEffect(() => {
    if (!resetArmed) return
    const timer = window.setTimeout(() => setResetArmed(false), 3_500)
    return () => window.clearTimeout(timer)
  }, [resetArmed])

  const documents = useMemo(() => discoveryDocuments(), [posts])
  const results = useMemo(
    () => searchDiscovery(documents, query, scope, query.trim() ? 40 : 18),
    [documents, query, scope],
  )

  const chooseMode = (mode: typeof discovery.mode) => {
    playPop()
    setFeedDiscoveryMode(mode)
    if (mode === 'local') postNativeEvent({ type: 'requestLocation' })
  }

  const open = (document: DiscoveryDocument) => {
    playPop()
    if (document.kind === 'post' && document.channelId) {
      focusDiscoveryPost(document.postId)
      onTune?.(document.channelId)
      onClose()
      return
    }
    if (document.kind === 'topic' && document.channelId) {
      onTune?.(document.channelId)
      onClose()
      return
    }
    if (document.kind === 'person' && document.handle) {
      requestProfileMode('media')
      window.dispatchEvent(new CustomEvent('poplur-open-profile-mode', {
        detail: { mode: 'media', handle: document.handle },
      }))
      onClose()
      return
    }
    if (document.kind === 'place' && document.coords) {
      window.dispatchEvent(new CustomEvent('poplur-discovery-open-place', {
        detail: { name: document.title, coords: document.coords },
      }))
      onClose()
    }
  }

  const reset = () => {
    playPop()
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    resetFeedDiscovery()
    setResetArmed(false)
  }

  return (
    <main className={styles.screen} data-poplur-screen="feed-discovery">
      <header className={styles.header}>
        <div>
          <p>POPLUR DISCOVERY</p>
          <h1>Find what reaches you</h1>
        </div>
        <ClayCornerButton kind="close" label="Close Discovery" size={42} onPress={onClose} />
      </header>

      <section className={styles.modeSection} aria-labelledby="discovery-mode-title">
        <div className={styles.sectionHeading}>
          <h2 id="discovery-mode-title">YOUR FEED</h2>
          <span>No follower graph</span>
        </div>
        <div className={styles.modes} role="tablist" aria-label="Feed discovery mode">
          {FEED_DISCOVERY_MODES.map(option => (
            <button
              type="button"
              role="tab"
              aria-selected={discovery.mode === option.id}
              className={discovery.mode === option.id ? styles.modeOn : styles.mode}
              key={option.id}
              onClick={() => chooseMode(option.id)}
            >
              <b>{option.label}</b>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.searchSection} aria-labelledby="discovery-search-title">
        <div className={styles.sectionHeading}>
          <h2 id="discovery-search-title">SEARCH POPLUR</h2>
          <span>Posts, people, places, topics</span>
        </div>
        <label className={styles.search}>
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search Poplur"
            aria-label="Search Poplur"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </label>
        <div className={styles.scopes} role="tablist" aria-label="Search category">
          {SCOPES.map(option => (
            <button
              type="button"
              role="tab"
              aria-selected={scope === option.id}
              className={scope === option.id ? styles.scopeOn : styles.scope}
              key={option.id}
              onClick={() => { playPop(); setScope(option.id) }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.results} aria-live="polite">
          {results.length === 0 && <p className={styles.empty}>Nothing found in your current discovery set.</p>}
          {results.map(document => (
            <button type="button" key={document.id} className={styles.result} onClick={() => open(document)}>
              <span className={styles.resultIcon} aria-hidden="true">{iconFor(document.kind)}</span>
              <span>
                <b>{document.title}</b>
                <i>{document.subtitle ?? document.kind}</i>
              </span>
              <em>{document.kind}</em>
            </button>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>{discovery.hiddenPostIds.length} hidden {discovery.hiddenPostIds.length === 1 ? 'post' : 'posts'}</span>
        <button type="button" className={resetArmed ? styles.resetArmed : styles.reset} onClick={reset}>
          {resetArmed ? 'Tap again to reset' : 'Reset feed learning'}
        </button>
      </footer>
    </main>
  )
}
