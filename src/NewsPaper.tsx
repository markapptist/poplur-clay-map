import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './NewsPaper.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { playPop } from './pop'
import { playCubeNavigationPop } from './cubeNavigationSound'
import { requestProfileMode } from './profileMode'
import { localDaylight } from './skyCycle'
import ScreenCoach from './ScreenCoach'
import ClayCornerButton from './ClayCornerButton'
import ShaderVideoPlayer from './ShaderVideoPlayer'
import NewsSourceVideo from './NewsSourceVideo'
import TabControlRail from './TabControlRail'
import SideControlIconButton from './SideControlIcon'
import { useControlSide } from './controlPlacement'
import { openInPoplurBrowser } from './inAppBrowser'
import PoplurStatusToast from './PoplurStatusToast'
import {
  handleNewsEntryKey,
  newsEngagementDeliveryFailure,
  type NewsEngagementAction,
  type NewsEngagementDeliveryFailure,
} from './newsEngagement'
import {
  distanceKm,
  onNewsMessages,
  readNewsMessages,
  relativeWhen,
  type NewsMessage,
  type NewsMediaAttachment,
} from './newsMessages'
import {
  liveNewsRadiusKm,
  liveNewsWhen,
  useLiveNews,
  type LiveNewsEvent,
  type LiveNewsMedia,
} from './liveNews'

// THE POPLUR TIMES — the News screen.
//
// Publisher-sourced reporting and the messages you posted on the map.

type EntryMediaAttachment = NewsMediaAttachment & Partial<Pick<LiveNewsMedia,
  'credit' | 'sourceUrl' | 'rights' | 'embedUrl'
>>

export interface Entry {
  id: string
  kind: 'dispatch' | 'message' | 'liveNews'
  who: string
  handle: string
  avatar?: string
  body: string
  /** the post's own radius, km */
  radiusKm: number
  /** how far the post's centre is from you, km */
  distanceKm: number
  when: string
  replies: number
  repops: number
  likes: number
  /** dropped by you, from the map composer */
  mine?: boolean
  /** real drops know where they are: lng, lat */
  coords?: [number, number]
  /** attached images or video */
  media?: EntryMediaAttachment[]
  verified?: 'verified' | 'confirmed'
  headline?: string
  liveEvent?: LiveNewsEvent
}

// Real snapshots of the real map: Mapbox renders the same dark style the app
// uses, centred on where the story happened, with the post's own radius drawn
// as a pink pin. Not an illustration — the actual map at those coordinates.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

// Home is Toronto until the device hands over a fix.
const HOME: [number, number] = [-79.3832, 43.6532]

/** Where a story was posted. A real drop knows its own ground; the synthetic
    edition steps the centre out along a bearing derived from its distance.
    Exported through both the plate and the detail sheet so the coordinate you
    READ is always the coordinate the map is SHOWING — computing them in two
    places would eventually drift. */
export function coordsFor(entry: Entry): [number, number] {
  if (entry.coords) return entry.coords
  const bearing = (entry.distanceKm * 37) % 360
  const rad = (bearing * Math.PI) / 180
  return [
    HOME[0] + (entry.distanceKm / 85) * Math.cos(rad),
    HOME[1] + (entry.distanceKm / 111) * Math.sin(rad),
  ]
}

function snapshotFor(entry: Entry): string | null {
  if (!MAPBOX_TOKEN || (entry.liveEvent && !entry.liveEvent.coords)) return null
  const [lng, lat] = coordsFor(entry)
  const zoom = entry.radiusKm > 24 ? 8.4 : entry.radiusKm > 10 ? 10.2 : 12.4
  const pin = `pin-l+f63b9a(${lng.toFixed(4)},${lat.toFixed(4)})`
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pin}/`
    + `${lng.toFixed(4)},${lat.toFixed(4)},${zoom},0/640x360@2x`
    // Keep Mapbox's default logo and attribution visible on every plate.
    + `?access_token=${MAPBOX_TOKEN}`
}

// Your own drops always run, even when the radius you chose does not reach
// where you are standing: you wrote it, so it is your news by definition. The
// reach line under it still tells the truth about who else it covers.
function myEntries(list: NewsMessage[], nowMs: number): Entry[] {
  return list.map(m => ({
    id: m.id,
    kind: 'message' as const,
    who: 'You',
    handle: '@you',
    avatar: 'mark_talk0.png',
    body: m.body,
    radiusKm: m.radiusKm,
    distanceKm: +distanceKm(HOME, m.lng, m.lat).toFixed(1),
    when: relativeWhen(m.at, nowMs),
    replies: 0,
    repops: 0,
    likes: 0,
    mine: true,
    coords: [m.lng, m.lat] as [number, number],
    media: m.media,
  }))
}

function liveEntries(list: LiveNewsEvent[], nowMs: number): Entry[] {
  return list.map(event => ({
    id: `live-news-${event.id}`,
    kind: 'liveNews' as const,
    who: event.author?.name ?? event.sources[0]?.publisher ?? 'Poplur News',
    handle: event.author ? `@${event.author.handle}` : event.sources[0]?.publisher ?? '',
    avatar: event.author?.avatar,
    headline: event.author ? undefined : event.title,
    body: event.summary,
    radiusKm: liveNewsRadiusKm(event),
    distanceKm: event.coords ? +distanceKm(HOME, event.coords[0], event.coords[1]).toFixed(1) : 0,
    when: liveNewsWhen(event, nowMs),
    replies: 0,
    repops: 0,
    likes: 0,
    coords: event.coords ?? undefined,
    // Keep provider attribution attached to the exact asset. User-created
    // NewsMediaAttachment records deliberately have none of these fields and
    // continue through the same renderer without a credit row.
    media: event.media.map(item => ({ ...item })),
    verified: undefined,
    liveEvent: event,
  }))
}

function VerifyBadge({ tier }: { tier: 'verified' | 'confirmed' }) {
  const fill = tier === 'verified' ? '#3b82f6' : '#9ca3af'
  return (
    <svg viewBox="0 0 22 22" width="13" height="13" className={styles.verifyBadge} aria-label={tier === 'verified' ? 'Verified' : 'Confirmed'}>
      <circle cx="11" cy="11" r="10" fill={fill} />
      <path d="M7 11.5l2.5 2.5 5.5-5.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MediaCredits({ media }: { media: EntryMediaAttachment[] }) {
  const credited = media
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Boolean(item.credit))
  if (!credited.length) return null

  return (
    <figcaption className={styles.mediaCredits}>
      {credited.map(({ item, index }) => (
        <span className={styles.mediaCreditLine} key={`${item.src}-${index}`}>
          <span className={styles.mediaCreditText}>
            {media.length > 1 ? `${index + 1}. ` : ''}{item.credit}

          </span>
          {item.sourceUrl && (
            <button
              type="button"
              className={styles.mediaCreditButton}
              aria-label={`Open source for ${item.credit}`}
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                openInPoplurBrowser(item.sourceUrl)
              }}
            >
              SOURCE ›
            </button>
          )}
        </span>
      ))}
    </figcaption>
  )
}

function EntryMedia({
  media,
  large,
  active = true,
}: {
  media: EntryMediaAttachment[]
  large?: boolean
  /** Only the exposed edition or its opaque detail owner may decode video. */
  active?: boolean
}) {
  if (!media.length) return null
  const first = media[0]

  if (first.kind === 'video' && first.embedUrl && first.sourceUrl) return <NewsSourceVideo embedUrl={first.embedUrl} poster={first.poster} sourceUrl={first.sourceUrl} active={active} />

  if (first.kind === 'video') {
    return (
      <figure className={large ? styles.mediaCardLarge : styles.mediaCard}>
        <ShaderVideoPlayer src={first.src} poster={first.poster} active={active} />
        <MediaCredits media={[first]} />
      </figure>
    )
  }

  if (media.length === 1) {
    return (
      <figure className={large ? styles.mediaCardLarge : styles.mediaCard}>
        <img className={styles.mediaSingle} src={first.src} alt={first.credit ?? ''} loading="lazy" draggable={false} />
        <MediaCredits media={media} />
      </figure>
    )
  }

  return (
    <figure className={large ? styles.mediaGridLarge : styles.mediaGrid}>
      {media.slice(0, 4).map((m, i) => (
        <img key={i} className={styles.mediaGridImg} src={m.src} alt={m.credit ?? ''} loading="lazy" draggable={false} />
      ))}
      <MediaCredits media={media.slice(0, 4)} />
    </figure>
  )
}

export default function NewsPaper({ onClose, bindBack, initialEventId }: {
  onClose: () => void
  /** The cube's back button, lent down from the hold menu. The paper NESTS —
      a story opens as a full page over the edition, and the drawer lays over
      both — so it hands its one-level-back up rather than printing a "‹ BACK"
      of its own. See HoldMenuTwin's nativeBackRef. */
  bindBack?: (fn: (() => boolean) | null) => void
  /** A map popup can open this exact canonical event, not just the edition. */
  initialEventId?: string | null
}) {
  /** One step back through the paper's own nesting, read through a ref so the
      binding below stays stable and the Escape handler above can reach it. */
  const stepBackRef = useRef<() => boolean>(() => false)
  // The edition clock is the real clock, ticking, in AM/PM.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date())
      setDaylight(localDaylight())
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  // The pops you dropped from the map, live. They arrive in this document
  // either through the shell's forward or through the storage event — the map
  // composer runs in the iframe, which has its own module state.
  const [dropped, setDropped] = useState<NewsMessage[]>(() => readNewsMessages())
  useEffect(() => onNewsMessages(setDropped), [])
  const liveNews = useLiveNews()
  /** Briefly announces how many stories the last pull brought in. */
  const [freshCount, setFreshCount] = useState(0)
  // Newsprint by day, an evening edition after dark — same daylight model the
  // map's sky uses, so the whole app agrees on what time it is. Re-checked on
  // the edition clock below rather than on a timer of its own.
  const [daylight, setDaylight] = useState(localDaylight)
  const [liked, setLiked] = useState<Set<string>>(() => new Set())
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [engagementFailure, setEngagementFailure] = useState<
    (NewsEngagementDeliveryFailure & { noticeId: number }) | null
  >(null)
  const engagementFailureTimer = useRef<number | null>(null)
  const engagementFailureSequence = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)
  const scrollHost = useRef<HTMLDivElement>(null)
  const pullInner = useRef<HTMLDivElement>(null)
  const pullPanel = useRef<HTMLDivElement>(null)
  const pullHead = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    return [...liveEntries(liveNews.events, now.getTime()), ...myEntries(dropped, now.getTime())]
  }, [dropped, now, liveNews.events])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // Escape is the desktop twin of the cube: it unwinds the drawer or the
      // story first and only closes the paper from the edition itself.
      if (stepBackRef.current()) { playPop(); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleLike = (id: string) => {
    playPop()
    setLiked(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const beginReply = (entry: Entry) => {
    playPop()
    setReplyDraft('')
    setReplyingTo(current => current === entry.id ? null : entry.id)
  }

  const showEngagementFailure = (action: NewsEngagementAction, entryId: string) => {
    const failure = newsEngagementDeliveryFailure(action, entryId)
    engagementFailureSequence.current += 1
    setEngagementFailure({ ...failure, noticeId: engagementFailureSequence.current })
    if (engagementFailureTimer.current !== null) {
      window.clearTimeout(engagementFailureTimer.current)
    }
    engagementFailureTimer.current = window.setTimeout(() => {
      setEngagementFailure(null)
      engagementFailureTimer.current = null
    }, 3_200)
  }

  useEffect(() => () => {
    if (engagementFailureTimer.current !== null) {
      window.clearTimeout(engagementFailureTimer.current)
    }
  }, [])

  const submitReply = (entry: Entry) => {
    const body = replyDraft.trim()
    if (!body) return
    playPop()
    // Keep the draft open. No existing News contract can deliver this body to
    // another device, so clearing it or incrementing the count would imply a
    // successful post that never happened.
    showEngagementFailure('reply', entry.id)
  }

  const repop = (entry: Entry) => {
    playPop()
    showEngagementFailure('repop', entry.id)
  }

  const focusLiveEventOnMap = (entry: Entry) => {
    if (!entry.liveEvent?.coords) return
    playCubeNavigationPop()
    window.dispatchEvent(new CustomEvent('poplur-news-focus-map', {
      detail: { id: entry.liveEvent.id, title: entry.liveEvent.title, coords: entry.liveEvent.coords },
    }))
  }

  // ── The hamburger: search, and the way to your profile ───────────────────
  // The paper is Poplur's timeline, so it carries the two controls a timeline
  // needs and nothing else (the queue names exactly these): a search that
  // really filters what is set, and a door to your profile that lands on
  // Messages — the drawer is where you go to READ, so it opens your inbox.
  const controlSide = useControlSide()
  const [menuOpen, setMenuOpen] = useState(false)
  // The drawer only ever played an ENTER animation — closing it just
  // unmounted the JSX, so it vanished instantly while .scroll (which now
  // pushes aside in step with it) eased back over 240ms with nothing left to
  // be revealing. Keeping it mounted through its own exit animation, and only
  // dropping it once that finishes, is what makes open and close feel like
  // the same gesture in reverse.
  const [menuMounted, setMenuMounted] = useState(false)
  const [query, setQuery] = useState('')
  /** POSTS searches what was written; USERS searches who wrote it. */
  const [scope, setScope] = useState<'posts' | 'users' | 'explore'>('posts')
  /** Set by picking a user out of the drawer: the paper narrows to their work. */
  const [byHandle, setByHandle] = useState<string | null>(null)
  const [feedTab, setFeedTab] = useState<'world' | 'video'>('world')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  /** The story opened as a full page, the way a tweet opens. */
  const [detail, setDetail] = useState<Entry | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const requestedEventFromUrl = useMemo(() => typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('newsEvent'), [])
  const requestedEventId = initialEventId ?? requestedEventFromUrl
  const didConsumeRequestedEvent = useRef(false)
  useEffect(() => {
    if (!requestedEventId || didConsumeRequestedEvent.current) return
    const match = entries.find(entry => entry.liveEvent?.id === requestedEventId)
    if (!match) return
    // The live wire is asynchronous, so wait until the requested canonical
    // event appears — then consume the request exactly once. Re-stamping the
    // edition every 30 seconds must not reopen it after cube-back or replace a
    // different story the reader deliberately chose.
    didConsumeRequestedEvent.current = true
    setDetail(match)
  }, [entries, requestedEventId])

  // The persistent RADIUS card follows a story only after the reader opens
  // that story. The edition itself stays visually and computationally quiet:
  // no scroll observer, focus-band highlighting, or radius churn while a
  // reader is simply moving through the headlines.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-news-active-entry', {
      detail: { radiusKm: detail?.radiusKm ?? null },
    }))
  }, [detail])
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('poplur-news-active-entry', { detail: { radiusKm: null } }))
  }, [])

  // Innermost first: the drawer lays over the story, the story lays over the
  // edition. Returning false at the edition means "nothing left here" and the
  // cube falls through to whatever it does on the paper itself.
  stepBackRef.current = () => {
    if (menuOpen) { setMenuOpen(false); return true }
    if (detail) { setDetail(null); return true }
    if (replyingTo) { setReplyingTo(null); setReplyDraft(''); return true }
    if (byHandle) { setByHandle(null); return true }
    if (selectedTag) { setSelectedTag(null); return true }
    return false
  }
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => stepBackRef.current())
    return () => bindBack(null)
  }, [bindBack])

  const openMenu = () => { playPop(); setMenuMounted(true); setMenuOpen(true) }
  const closeMenu = () => { playPop(); setMenuOpen(false) }
  const goToProfileMessages = () => {
    playCubeNavigationPop()
    setMenuOpen(false)
    // Park the requested page BEFORE the event: Profile is unmounted right now
    // and only mounts once the shell switches tabs, so a listener cannot catch
    // this — it reads the parked value on mount instead. The event still fires
    // for the shell (tab switch) and for an already-mounted Profile.
    requestProfileMode('messages')
    window.dispatchEvent(new CustomEvent('poplur-open-profile-mode', { detail: { mode: 'messages' } }))
  }

  // Search filters the EDITION, not just the visible rows: an empty result says
  // so instead of leaving a masthead over nothing.
  const needle = query.trim().toLowerCase()
  const matches = (e: Entry) => scope === 'users'
    ? e.who.toLowerCase().includes(needle) || e.handle.toLowerCase().includes(needle)
    : `${e.headline ?? ''} ${e.body}`.toLowerCase().includes(needle)
  const tagged = entries.filter(e => (!selectedTag || e.liveEvent?.hashtags?.some(tag => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase()) || (e.body.match(/#[\p{L}\p{N}_]+/gu) ?? []).some(tag => tag.slice(1).toLocaleLowerCase() === selectedTag.toLocaleLowerCase())) && (feedTab !== 'video' || e.media?.some(m => m.kind === 'video')))
  const narrowed = byHandle ? tagged.filter(e => e.handle === byHandle) : tagged
  const shown = needle ? narrowed.filter(matches) : narrowed
  const filtering = Boolean(needle) || Boolean(byHandle) || Boolean(selectedTag) || feedTab === 'video'
  const sourceProfile = entries.find(e => e.handle === byHandle)?.liveEvent?.author

  /** Distinct authors for the USERS list — the paper's people, deduped. */
  const people = (() => {
    if (scope !== 'users') return []
    const seen = new Map<string, Entry>()
    for (const e of entries) {
      if (needle && !matches(e)) continue
      if (!seen.has(e.handle)) seen.set(e.handle, e)
    }
    return [...seen.values()].slice(0, 12)
  })()

  /** EXPLORE: what this edition keeps coming back to. A topic is a hashtag
   *  or a capitalised name in a story's words, ranked by how many stories
   *  carry it and how warmly those stories were received — X's Explore page,
   *  cut to what is in reach. Written as exec loops rather than matchAll so
   *  the paper keeps compiling against the older string library. */
  const trending = (() => {
    if (scope !== 'explore') return [] as Array<{ topic: string; stories: number; heat: number; live: number }>
    const stop = new Set(['The', 'A', 'An', 'And', 'But', 'For', 'With', 'From', 'This', 'That', 'Live',
      'Poplur', 'Map', 'Radius', 'Your', 'You', 'Just', 'Now', 'New', 'Today', 'Here', 'There', 'What', 'When'])
    const score = new Map<string, { topic: string; stories: number; heat: number; live: number }>()
    for (const e of entries) {
      const text = `${e.headline ?? ''} ${e.body}`
      const found = new Set<string>()
      const tag = /#([\p{L}\p{N}_]{2,32})/gu
      for (let m = tag.exec(text); m; m = tag.exec(text)) found.add(`#${m[1].toLowerCase()}`)
      const name = /(?:^|[^\p{L}\p{N}#@])(\p{Lu}[\p{L}\p{N}'’-]{2,}(?:\s\p{Lu}[\p{L}\p{N}'’-]{2,}){0,2})/gu
      for (let m = name.exec(text); m; m = name.exec(text)) {
        const candidate = m[1].trim()
        if (stop.has(candidate.split(' ')[0])) continue
        found.add(candidate)
      }
      for (const topic of found) {
        const row = score.get(topic.toLowerCase()) ?? { topic, stories: 0, heat: 0, live: 0 }
        row.stories += 1
        row.heat += e.likes + e.repops * 2 + e.replies * 3
        if (e.kind === 'liveNews') row.live += 1
        score.set(topic.toLowerCase(), row)
      }
    }
    return [...score.values()]
      .filter(row => row.stories >= 2 || row.topic.startsWith('#'))
      .sort((a, b) => (b.stories * 10 + b.heat) - (a.stories * 10 + a.heat))
      .slice(0, 12)
  })()

  const openProfileFor = (handle?: string) => {
    playCubeNavigationPop()
    setMenuOpen(false)
    setDetail(null)
    if (entries.some(e => e.handle === handle && e.liveEvent)) { setByHandle(handle ?? null); setSelectedTag(null); setFeedTab('world'); scrollHost.current?.scrollTo({ top: 0 }); return }
    // Their profile, on Messages — the same hand-off the drawer's own Profile
    // row uses. (Whose profile is a live-service question; the shell opens the
    // profile surface and the mode it was asked for.)
    requestProfileMode('messages')
    window.dispatchEvent(new CustomEvent('poplur-open-profile-mode', {
      detail: { mode: 'messages', handle },
    }))
  }

  const rest = shown

  // Refresh the source wire and locally posted messages together.
  const refresh = useCallback(() => {
    setDropped(readNewsMessages())
    setNow(new Date())
    void liveNews.refresh().then(next => {
      setFreshCount(next.events.length)
      window.setTimeout(() => setFreshCount(0), 4200)
    })
    scrollHost.current?.scrollTo({ top: 0 })
  }, [liveNews.refresh])

  // The paper is an endless timeline, so give the reader a way back up that
  // is not a hundred flicks: a side control that appears once the masthead is
  // well out of sight. Event-driven — the listener costs nothing at idle.
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const host = scrollHost.current
    if (!host) return
    const onScroll = () => setShowTop(host.scrollTop > 600)
    host.addEventListener('scroll', onScroll, { passive: true })
    return () => host.removeEventListener('scroll', onScroll)
  }, [])
  const backToTop = () => {
    playPop()
    scrollHost.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  usePullToRefresh({
    scrollRef: scrollHost,
    innerRef: pullInner,
    panelRef: pullPanel,
    headRef: pullHead,
    busyClass: pullStyles.busy,
    onRefresh: refresh,
  })

  return (
    <div
      className={daylight ? styles.paper : `${styles.paper} ${styles.paperNight}`}
      data-daylight={daylight ? 'day' : 'night'}
      role="dialog"
      aria-label="Poplur Times"
    >
      {/* No ✕ — the cube is the back control for every subscreen. */}
      <div className={menuOpen ? `${styles.scroll} ${styles.scrollPushed}` : styles.scroll} ref={scrollHost}>
        <div className={pullStyles.panel} ref={pullPanel} data-pull-panel aria-hidden="true">
          <div className={pullStyles.head} ref={pullHead}>
            {/* The supplied mark head, prebaked flat by prerender-sprites —
                the same object the Profile navigator holds, never new art. */}
            <img src="sprites/poplur_mark_head_navigator_y0_p0_s640.png" alt="" draggable="false" />
          </div>
        </div>
        <div ref={pullInner}>
        {freshCount > 0 && (
          <p className={styles.freshBanner}>{freshCount} stories available</p>
        )}

        <header className={styles.masthead}>
          <h1 className={styles.socialTitle}>Poplur News</h1>
          <p className={styles.socialSubtitle}>Real voices. Stories from around the world.</p>
          <div className={styles.feedTabs} role="tablist" aria-label="News feeds">
            <button role="tab" aria-selected={feedTab === 'world'} onClick={() => setFeedTab('world')}>World</button>
            <button role="tab" aria-selected={feedTab === 'video'} onClick={() => setFeedTab('video')}>Video</button>
          </div>
        </header>

        {(liveNews.loading || liveNews.source !== 'empty' || liveNews.error) && (
          <div className={styles.wireStatus} data-source={liveNews.source} role="status">
            <span>{liveNews.loading ? 'UPDATING WIRE' : liveNews.source === 'preview' ? 'LIVE WIRE PREVIEW' : liveNews.stale ? 'SAVED EDITION' : 'LIVE WORLD WIRE'}</span>
            <b>{liveNews.loading
              ? 'Checking trusted sources…'
              : liveNews.error ?? `${liveNews.events.length} ${liveNews.events.length === 1 ? 'story' : 'stories'} from original reporting`}</b>
            {/* `liveNews.error` is now always a sentence written for a reader.
                It used to carry error.message straight from the failed fetch,
                so the paper printed the browser's own words — "Failed to
                fetch" — under a LIVE WORLD WIRE masthead. See liveNews.ts. */}
          </div>
        )}

        <div className={styles.columnsRule} aria-hidden="true" />

        {sourceProfile && <section className={styles.sourceProfile} aria-label="Source profile">
          {sourceProfile.avatar && <img src={sourceProfile.avatar} alt="" />}
          <h2>{sourceProfile.name}</h2><p>@{sourceProfile.handle}</p>
          <p>{sourceProfile.bio}</p>
          <small>{sourceProfile.platform} source · {sourceProfile.region}</small>
          <button onClick={() => openInPoplurBrowser(sourceProfile.profileUrl)}>View original profile ↗</button>
          <small>Recent posts in this edition</small>
        </section>}
        {selectedTag && <button className={styles.filterChip} onClick={() => setSelectedTag(null)}>#{selectedTag} · Clear filter</button>}
        {byHandle && (
          <button className={styles.filterChip} onClick={() => { playPop(); setByHandle(null) }}>
            Showing only {byHandle} · TAP TO CLEAR
          </button>
        )}

        {filtering && shown.length === 0 && (
          <p className={styles.noHits}>
            {feedTab === 'video' && !needle && !byHandle && !selectedTag ? 'No videos in this edition yet.' : `No posts match ${needle ? `“${query.trim()}”` : byHandle ?? (selectedTag ? `#${selectedTag}` : 'this filter')}.`}
          </p>
        )}

        <div className={styles.timeline}>
          {rest.map(entry => (
            <article
              key={entry.id}
              className={entry.kind === 'dispatch' || entry.kind === 'liveNews' ? `${styles.entry} ${styles.entryAi}` : styles.entry}
              role="button"
              tabIndex={0}
              aria-label={`Open ${entry.who}'s post`}
              onClick={event => {
                // The engagement row and the plate have their own jobs; only a
                // tap on the story itself opens it.
                if ((event.target as HTMLElement).closest('button, a, figure, form, input')) return
                playPop()
                setDetail(entry)
              }}
              onKeyDown={event => {
                handleNewsEntryKey(event, () => {
                  playPop()
                  setDetail(entry)
                })
              }}
            >
              <button className={styles.authorAvatar} aria-label={`View ${entry.who}'s source profile`} onClick={() => openProfileFor(entry.handle)}>
                {entry.avatar ? <img className={styles.avatar} src={entry.avatar} alt="" draggable="false" loading="lazy" /> : <span className={styles.avatarInitial}>{entry.who.slice(0,2).toUpperCase()}</span>}
              </button>
              <div className={styles.entryBody}>
                <div className={styles.entryTop}>
                  <button className={styles.authorName} onClick={() => openProfileFor(entry.handle)}>{entry.who}</button>
                  <span className={styles.handle}>{entry.handle}</span>
                  {entry.verified && <VerifyBadge tier={entry.verified} />}
                  <span className={styles.dot}>·</span>
                  <span className={styles.when}>{entry.when}</span>
                  {entry.kind === 'dispatch' && <span className={styles.aiTag}>MAP DISPATCH</span>}
                  {entry.liveEvent && (
                    <span className={`${styles.aiTag} ${styles.liveTag}`}>
                      {entry.liveEvent.preview ? 'PREVIEW' : entry.liveEvent.author ? 'BLUESKY' : 'NEWS'}
                    </span>
                  )}
                  {entry.mine && <span className={styles.mineTag}>YOUR POP</span>}
                </div>
                {entry.headline && <h3 className={styles.entryHeadline}>{entry.headline}</h3>}
                <p className={styles.body}>{entry.body.split(/(#[\p{L}\p{N}_]+)/u).map((part,index) => part.startsWith('#') ? <button key={index} className={styles.inlineTag} onClick={() => { setSelectedTag(part.slice(1)); setByHandle(null); scrollHost.current?.scrollTo({ top: 0 }) }}>{part}</button> : part)}</p>
                {!!entry.liveEvent?.hashtags?.length && <div className={styles.hashtags}>{entry.liveEvent.hashtags.map(tag => <button key={tag} onClick={() => { setSelectedTag(tag); setByHandle(null); scrollHost.current?.scrollTo({ top: 0 }) }}>#{tag}</button>)}</div>}
                {entry.media?.length ? <EntryMedia media={entry.media} active={!detail} /> : null}
                {(entry.kind === 'dispatch' || entry.kind === 'liveNews' || entry.mine) && snapshotFor(entry) && (
                  entry.liveEvent ? (
                    <button
                      type="button"
                      className={`${styles.plateSmall} ${styles.plateButton}`}
                      onClick={() => focusLiveEventOnMap(entry)}
                      aria-label={`View ${entry.liveEvent.title} on the news tour`}
                    >
                      <img
                        className={styles.plateImg}
                        src={snapshotFor(entry)!}
                        alt={`Map of ${entry.liveEvent.place}`}
                        loading="lazy"
                      />
                      <span className={styles.plateCap}>
                        {entry.liveEvent.place.toUpperCase()} · VIEW ON THE NEWS TOUR
                      </span>
                    </button>
                  ) : (
                    <figure className={styles.plateSmall}>
                      <img
                        className={styles.plateImg}
                        src={snapshotFor(entry)!}
                        alt={entry.mine ? 'Map of the ground this pop claims' : 'Map of the area this dispatch covers'}
                        loading="lazy"
                      />
                      <figcaption className={styles.plateCap}>
                        {entry.mine
                          ? `YOUR GROUND · ${entry.radiusKm} KM RADIUS`
                          : `THE MAP · ${entry.distanceKm} KM OUT`}
                      </figcaption>
                    </figure>
                  )
                )}
                <div className={styles.reach}>
                  <span className={styles.reachPip} aria-hidden="true" />
                  {entry.liveEvent && !entry.liveEvent.coords ? 'World news · Read the original reporting' : `${entry.radiusKm} km radius · ${entry.distanceKm} km from you`}
                </div>
                {entry.liveEvent ? <div className={styles.sourceActions}>
                  <button onClick={() => openInPoplurBrowser(entry.liveEvent!.sources[0].url)}>Read original ↗</button>
                  <button onClick={() => openProfileFor(entry.handle)}>Source profile</button>
                </div> : <div className={styles.actions}>
                  <button
                    className={replyingTo === entry.id ? `${styles.action} ${styles.actionOn}` : styles.action}
                    onClick={() => beginReply(entry)}
                    aria-expanded={replyingTo === entry.id}
                  >
                    <span aria-hidden="true">✎</span> {entry.replies}
                  </button>
                  <button
                    className={styles.action}
                    onClick={() => repop(entry)}
                    aria-pressed={false}
                  >
                    <span aria-hidden="true">⇄</span> {entry.repops}
                  </button>
                  <button
                    className={liked.has(entry.id) ? `${styles.action} ${styles.actionOn}` : styles.action}
                    onClick={() => toggleLike(entry.id)}
                  >
                    <span aria-hidden="true">♥</span> {entry.likes + (liked.has(entry.id) ? 1 : 0)}
                  </button>
                </div>}
                {replyingTo === entry.id && (
                  <form
                    className={styles.replyComposer}
                    aria-label={`Reply to ${entry.who}`}
                    onClick={event => event.stopPropagation()}
                    onSubmit={event => { event.preventDefault(); submitReply(entry) }}
                  >
                    <input
                      autoFocus
                      value={replyDraft}
                      onChange={event => setReplyDraft(event.target.value)}
                      placeholder={`Reply to ${entry.handle}`}
                      maxLength={500}
                      aria-label={`Write a reply to ${entry.who}`}
                    />
                    <button type="submit" disabled={!replyDraft.trim()}>POST</button>
                    <button
                      type="button"
                      onClick={() => { playPop(); setReplyingTo(null); setReplyDraft('') }}
                    >CANCEL</button>
                  </form>
                )}
              </div>
            </article>
          ))}
        </div>

        <div ref={sentinel} className={styles.sentinel}>
          <span className={styles.endMark}>{liveNews.loading ? 'UPDATING NEWS…' : '— YOU’RE CAUGHT UP · PULL DOWN TO REFRESH —'}</span>
        </div>
        </div>
      </div>

      {detail && (() => {
        const plate = snapshotFor(detail)
        return (
          <div className={styles.detail} role="dialog" aria-label={`${detail.who}'s post`}>
            <div className={styles.detailBar}>
              {/* No "‹ BACK". The cube under the page is the back button for
                  the whole app, and a story is exactly the case it was built
                  for: tap it and you are on the edition again. */}
              <span className={styles.detailKicker}>
                {detail.liveEvent
                  ? `${detail.liveEvent.preview ? 'PREVIEW' : detail.liveEvent.status.toUpperCase()} · POPLUR NEWS`
                  : detail.kind === 'dispatch' ? 'MAP DISPATCH' : detail.mine ? 'YOUR POP' : 'POST'}
              </span>
            </div>

            <div className={styles.detailScroll}>
              {detail.liveEvent ? (
                <div className={`${styles.detailWho} ${styles.detailWhoStatic}`}>
                  <img src={detail.avatar} alt="" draggable={false} />
                  <span>
                    <b>{detail.who}{detail.verified && <VerifyBadge tier={detail.verified} />}</b>
                    <i>{detail.liveEvent.sources.length} source{detail.liveEvent.sources.length === 1 ? '' : 's'} · {detail.liveEvent.place}</i>
                  </span>
                </div>
              ) : (
                <button className={styles.detailWho} onClick={() => openProfileFor(detail.handle)}>
                  <img src={detail.avatar} alt="" draggable={false} />
                  <span>
                    <b>{detail.who}{detail.verified && <VerifyBadge tier={detail.verified} />}</b>
                    <i>{detail.handle} · view profile</i>
                  </span>
                </button>
              )}

              <h2>{detail.headline}</h2>
              <p className={styles.detailBody}>{detail.body}</p>
              {detail.media?.length ? <EntryMedia media={detail.media} large active /> : null}
              <p className={styles.detailWhen}>{detail.when === 'now' ? 'just now' : `${detail.when} ago`}</p>

              {detail.liveEvent && (
                <div className={styles.detailSources}>
                  <p>{detail.liveEvent.preview ? 'PREVIEW SUMMARY' : 'SOURCE SUMMARY'} · CHECK THE ORIGINAL REPORTING</p>
                  {detail.liveEvent.sources.map(source => (
                    <button key={source.url} type="button" onClick={() => openInPoplurBrowser(source.url)}>
                      <span>{source.publisher}</span><i>READ SOURCE ›</i>
                    </button>
                  ))}
                </div>
              )}

              {/* Reach stays useful without printing a coordinate pair that can
                  be copied into another map. Public posts show only an area;
                  private/ghost posts arrive without a public origin at all. */}
              <dl className={styles.detailFacts}>
                <div>
                  <dt>{detail.liveEvent ? 'EVENT AREA' : 'RADIUS'}</dt>
                  <dd>{detail.liveEvent ? detail.liveEvent.scope : `${detail.radiusKm} km`}</dd>
                </div>
                <div>
                  <dt>FROM YOU</dt>
                  <dd>{detail.liveEvent && !detail.liveEvent.coords ? 'Location unavailable' : `${detail.distanceKm} km`}</dd>
                </div>
                <div>
                  <dt>{detail.liveEvent ? 'REPORTING' : 'POSTED AT'}</dt>
                  <dd className={styles.detailCoords}>{detail.liveEvent ? `${detail.liveEvent.sources.length} linked source(s)` : 'Approximate map area'}</dd>
                </div>
              </dl>

              {plate ? (
                <figure className={styles.detailPlate}>
                  <img src={plate} alt={`Map of where ${detail.who} posted this`} loading="lazy" />
                  <figcaption>{detail.liveEvent ? `${detail.liveEvent.place.toUpperCase()} · PROVIDER-SUPPLIED AREA` : `THE GROUND THIS WAS POSTED ON · ${detail.radiusKm} KM RADIUS`}</figcaption>
                </figure>
              ) : (
                <p className={styles.detailNoPlate}>
                  No map location is available for this story.
                </p>
              )}

              {!detail.liveEvent && <div className={styles.detailStats}>
                <span>✎ {detail.replies}</span>
                <span>⇄ {detail.repops}</span>
                <span>♥ {detail.likes + (liked.has(detail.id) ? 1 : 0)}</span>
              </div>}

              {detail.liveEvent?.coords && (
                <button
                  className={styles.detailMap}
                  onClick={() => focusLiveEventOnMap(detail)}
                >
                  VIEW THIS STORY ON THE MAP
                </button>
              )}

              {(
                <button className={styles.detailProfile} onClick={() => openProfileFor(detail.handle)}>
                  OPEN {detail.who.toUpperCase()}’S PROFILE
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {engagementFailure && (
        <PoplurStatusToast
          key={engagementFailure.noticeId}
          title={engagementFailure.title}
          detail={engagementFailure.detail}
          tone="error"
        />
      )}

      <ScreenCoach
        id="news"
        title="POPLUR NEWS"
        lines={[
          'Switch between World stories and Video.',
          'Pull down to update the world wire.',
          'Tap a source or hashtag to explore its posts.',
        ]}
      />

      {/* Side rail, outside the scroll — the same edge-mounted furniture the
          TV screen and the map carry, rather than a hamburger stuck in a
          corner it doesn't share with anything. */}
      {!menuOpen && <TabControlRail side={controlSide} label="News controls">
        <SideControlIconButton
          icon="news.menu"
          aria-label="Open news menu"
          aria-expanded={menuOpen}
          onActivate={openMenu}
        />
        <button
          type="button"
          className={showTop ? styles.toTop : `${styles.toTop} ${styles.toTopHidden}`}
          onClick={backToTop}
          aria-label="Back to the top of the paper"
          aria-hidden={showTop ? undefined : 'true'}
          tabIndex={showTop ? 0 : -1}
        >
          <img
            className={styles.toTopArt}
            src={`${import.meta.env.BASE_URL}news-scroll-top.png`}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </button>
      </TabControlRail>}

      {menuMounted && (
        <>
          <div
            className={menuOpen ? styles.scrim : `${styles.scrim} ${styles.scrimOut}`}
            onClick={closeMenu}
            onAnimationEnd={() => { if (!menuOpen) setMenuMounted(false) }}
            aria-hidden="true"
          />
          <aside
            className={menuOpen ? styles.drawer : `${styles.drawer} ${styles.drawerOut}`}
            role="dialog"
            aria-label="News menu"
            aria-hidden={menuOpen ? undefined : 'true'}
          >
            <p className={styles.drawerTitle}>THE POPLUR TIMES</p>

            {/* Two things you can look for in a timeline: something written,
                or someone who writes. */}
            <div className={styles.scopes} role="tablist" aria-label="Search for">
              {(['posts', 'users', 'explore'] as const).map(option => (
                <button
                  key={option}
                  role="tab"
                  aria-selected={scope === option}
                  className={scope === option ? styles.scopeOn : styles.scope}
                  onClick={() => { playPop(); setScope(option) }}
                >
                  {option === 'posts' ? 'POSTS' : option === 'users' ? 'USERS' : 'EXPLORE'}
                </button>
              ))}
            </div>

            {scope !== 'explore' && <label className={styles.search}>
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={query}
                placeholder={scope === 'users' ? 'Search for a user' : 'Search for a post'}
                onChange={event => setQuery(event.target.value)}
                aria-label={scope === 'users' ? 'Search for a user' : 'Search for a post'}
              />
              {query && (
                <button className={styles.searchClear} onClick={() => { playPop(); setQuery('') }} aria-label="Clear search">✕</button>
              )}
            </label>}

            {scope === 'posts' && needle && (
              <p className={styles.searchCount}>
                {shown.length} {shown.length === 1 ? 'story' : 'stories'} in reach
              </p>
            )}

            {/* USERS: the people writing in this edition. Picking one narrows
                the paper to their work; their name opens their profile. */}
            {scope === 'users' && (
              <div className={styles.people}>
                {people.length === 0 && (
                  <p className={styles.searchCount}>Nobody here by that name.</p>
                )}
                {people.map(person => (
                  <div key={person.handle} className={styles.person}>
                    <button
                      className={styles.personPick}
                      onClick={() => { playPop(); setByHandle(person.handle); setMenuOpen(false) }}
                    >
                      <img src={person.avatar} alt="" draggable={false} />
                      <span>
                        <b>{person.who}</b>
                        <i>{person.handle}</i>
                      </span>
                    </button>
                    <button
                      className={styles.personProfile}
                      onClick={() => openProfileFor(person.handle)}
                      aria-label={`Open ${person.who}'s profile`}
                    >›</button>
                  </div>
                ))}
              </div>
            )}

            {/* EXPLORE: the edition's trending topics. Picking one searches
                the paper for it, the same narrowing a typed query does. */}
            {scope === 'explore' && (
              <div className={styles.trends} role="list" aria-label="Trending in your radius">
                <p className={styles.searchCount}>
                  {trending.length === 0 ? 'Nothing is trending in reach yet.' : 'Trending in your radius'}
                </p>
                {trending.map((row, index) => (
                  <button
                    key={row.topic}
                    role="listitem"
                    className={styles.trend}
                    onClick={() => {
                      playPop()
                      setScope('posts')
                      setQuery(row.topic.replace(/^#/, ''))
                      setMenuOpen(false)
                    }}
                  >
                    <i>{index + 1}</i>
                    <span>
                      <b>{row.topic}</b>
                      <em>
                        {row.stories} {row.stories === 1 ? 'story' : 'stories'}
                        {row.live ? ' · Live news' : ''}
                      </em>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button className={styles.drawerRow} onClick={goToProfileMessages}>
              <img src="mark_talk0.png" alt="" draggable={false} />
              <span>
                <b>Profile</b>
                <i>Your messages</i>
              </span>
            </button>

            <button className={styles.drawerClose} onClick={closeMenu}>CLOSE</button>
          </aside>
        </>
      )}
    </div>
  )
}
