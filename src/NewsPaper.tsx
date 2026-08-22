import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './NewsPaper.module.css'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import { playPop } from './pop'
import { requestProfileMode } from './profileMode'
import { localDaylight } from './skyCycle'
import ScreenCoach from './ScreenCoach'
import ClayCornerButton from './ClayCornerButton'
import ShaderVideoPlayer from './ShaderVideoPlayer'
import TabControlRail from './TabControlRail'
import { useControlSide } from './controlPlacement'
import {
  distanceKm,
  onNewsMessages,
  readNewsMessages,
  relativeWhen,
  type NewsMessage,
  type NewsMediaAttachment,
} from './newsMessages'

// THE POPLUR TIMES — the News screen.
//
// Reads like a newspaper, works like a timeline. Two kinds of entry are set in
// the same columns:
//
//   · DISPATCH — written by Poplur AI about what is happening on the map right
//     now (claims, radius changes, venues heating up).
//   · MESSAGE — a written post someone dropped on the map. Messages carry a
//     radius exactly like video pops do, so you only read the ones whose radius
//     reaches your location.
//
// The edition keeps setting more type as you scroll, and stops only when the
// next messages no longer intercept where you are standing.
//
// The messages YOU drop from the map composer lead the edition. They are real
// (newsMessages, written by ClayMap's "Post message"), they carry the radius
// you chose, and their map plate is the actual ground you claimed — everything
// below them is the synthetic edition until the live service takes over.

export interface Entry {
  id: string
  kind: 'dispatch' | 'message'
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
  media?: NewsMediaAttachment[]
  verified?: 'verified' | 'confirmed'
}

const AVATARS = [
  'feed/posters/ad-food.jpg', 'feed/posters/ad-comedy.jpg', 'feed/posters/ad-shopping.jpg',
  'feed/posters/ad-music.jpg', 'feed/posters/ad-sports.jpg', 'feed/posters/ad-french.jpg',
  'mark_talk0.png', 'feed/posters/ad-kids.jpg', 'feed/posters/ad-cartoon.jpg',
]

const WRITERS = [
  { who: 'Kensington', handle: '@kensington_eats' },
  { who: 'Harbourfront', handle: '@harbourfront' },
  { who: 'Queen West', handle: '@queenwest' },
  { who: 'The Annex', handle: '@the_annex' },
  { who: 'Night Market', handle: '@nightmarket' },
  { who: 'Local Wire', handle: '@localwire' },
  { who: 'Basement Set', handle: '@basement.set' },
  { who: 'Sauce Boss', handle: '@sauceboss' },
]

const MESSAGES = [
  'Anyone else seeing the queue down Augusta? Two blocks and growing.',
  'Dropped a pop outside Union. Whoever tagged the mural — respect.',
  'Rain held off. Harbourfront is packed for the blue hour.',
  'The 501 is running short turns again. Walk if you are near Bathurst.',
  'Free cold brew at the sample sale until they run out.',
  'Someone left a clay pin on my street. It is beautiful. Leaving it.',
  'Warehouse doors at ten. Bring cash, the card machine is dead.',
  'Best croissant in the radius is still the one on Baldwin. I said it.',
  'Claimed my block this morning. Nobody take it.',
  'Fog rolled in off the lake, whole skyline gone in ten minutes.',
]

const DISPATCHES = [
  'Barrie falls: the northern corridor is fully claimed after a nine-hour push, extending the local map by 14 km.',
  'Downtown holds. Three overlapping pops now cover the core, and the ground has taken their colour.',
  'Queen West is the densest square kilometre on the map tonight, with 41 posts inside a single radius.',
  'Harbourfront reports the sharpest rise of the evening — reach up 1.2 km in under an hour.',
  'A quiet stretch along the Danforth has gone dark as older pops expire, opening ground to the east.',
  'The lake edge remains uncontested. No pop has yet reached the water.',
  'Mississauga edges closer to the western boundary as two mid-sized claims merge.',
  'Trending inside your radius: food, then music, then whatever is happening at the fairground.',
]

// Deterministic pseudo-random so the edition reads the same on every render and
// only grows when you actually scroll (Math.random would reshuffle constantly).
function seeded(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const SAMPLE_POSTERS = [
  'feed/posters/ad-food.jpg', 'feed/posters/ad-comedy.jpg',
  'feed/posters/ad-shopping.jpg', 'feed/posters/ad-music.jpg',
  'feed/posters/ad-sports.jpg', 'feed/posters/ad-french.jpg',
]
const SAMPLE_CLIPS = [
  'feed/ad-food.mp4', 'feed/ad-comedy.mp4',
  'feed/ad-music.mp4', 'feed/ad-sports.mp4',
]

function sampleMedia(seed: number): NewsMediaAttachment[] | undefined {
  const roll = seeded(seed + 200)
  if (roll > 0.7) return undefined          // ~30% text-only
  if (roll > 0.45) {                        // ~25% single photo
    return [{ kind: 'photo', src: SAMPLE_POSTERS[seed % SAMPLE_POSTERS.length] }]
  }
  if (roll > 0.25) {                        // ~20% multi-image (2-4 photos)
    const count = 2 + (seed % 3)
    return Array.from({ length: count }, (_, i) => ({
      kind: 'photo' as const,
      src: SAMPLE_POSTERS[(seed + i * 3) % SAMPLE_POSTERS.length],
    }))
  }
  // ~25% video
  const clip = SAMPLE_CLIPS[seed % SAMPLE_CLIPS.length]
  const poster = SAMPLE_POSTERS[seed % SAMPLE_POSTERS.length]
  return [{ kind: 'video', src: clip, poster }]
}

// Successive pages sit further out. A message only appears if its radius still
// reaches you — the same interception rule the feed and the map use.
function buildPage(page: number, edition = 0): Entry[] {
  const out: Entry[] = []
  for (let i = 0; i < 8; i += 1) {
    const n = page * 8 + i
    const seed = n + edition * 997
    const r = seeded(seed)
    const kind: Entry['kind'] = n % 3 === 0 ? 'dispatch' : 'message'
    const distanceKm = +(n * 0.9 + r * 2.4).toFixed(1)
    const radiusKm = +(3 + seeded(seed + 101) * 38).toFixed(1)
    if (distanceKm > radiusKm) continue
    const writer = WRITERS[seed % WRITERS.length]
    out.push({
      id: `e${edition}-${n}`,
      kind,
      who: kind === 'dispatch' ? 'Poplur AI' : writer.who,
      handle: kind === 'dispatch' ? '@poplur' : writer.handle,
      avatar: kind === 'dispatch' ? 'logo_icon.png' : AVATARS[seed % AVATARS.length],
      body: kind === 'dispatch' ? DISPATCHES[seed % DISPATCHES.length] : MESSAGES[seed % MESSAGES.length],
      radiusKm,
      distanceKm,
      when: n < 3 ? `${2 + n * 5}m` : n < 9 ? `${1 + Math.floor(n / 3)}h` : `${1 + Math.floor(n / 9)}d`,
      replies: Math.floor(r * 40),
      repops: Math.floor(seeded(seed + 7) * 90),
      likes: Math.floor(seeded(seed + 13) * 400),
      media: kind === 'message' ? sampleMedia(seed) : undefined,
      verified: kind === 'dispatch' ? 'verified' : seed % 4 === 0 ? 'verified' : seed % 5 === 0 ? 'confirmed' : undefined,
    })
  }
  return out
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
  if (!MAPBOX_TOKEN) return null
  const [lng, lat] = coordsFor(entry)
  const zoom = entry.radiusKm > 24 ? 8.4 : entry.radiusKm > 10 ? 10.2 : 12.4
  const pin = `pin-l+f63b9a(${lng.toFixed(4)},${lat.toFixed(4)})`
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pin}/`
    + `${lng.toFixed(4)},${lat.toFixed(4)},${zoom},0/640x360@2x`
    + `?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
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

function editionStamp(now: Date) {
  return {
    date: now.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
  }
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

function EntryMedia({ media, large }: { media: NewsMediaAttachment[], large?: boolean }) {
  if (!media.length) return null
  const first = media[0]

  if (first.kind === 'video') {
    return (
      <figure className={large ? styles.mediaCardLarge : styles.mediaCard}>
        <ShaderVideoPlayer src={first.src} poster={first.poster} />
      </figure>
    )
  }

  if (media.length === 1) {
    return (
      <figure className={large ? styles.mediaCardLarge : styles.mediaCard}>
        <img className={styles.mediaSingle} src={first.src} alt="" loading="lazy" draggable={false} />
      </figure>
    )
  }

  return (
    <figure className={large ? styles.mediaGridLarge : styles.mediaGrid}>
      {media.slice(0, 4).map((m, i) => (
        <img key={i} className={styles.mediaGridImg} src={m.src} alt="" loading="lazy" draggable={false} />
      ))}
    </figure>
  )
}

export default function NewsPaper({ onClose, bindBack }: {
  onClose: () => void
  /** The cube's back button, lent down from the hold menu. The paper NESTS —
      a story opens as a full page over the edition, and the drawer lays over
      both — so it hands its one-level-back up rather than printing a "‹ BACK"
      of its own. See HoldMenuTwin's nativeBackRef. */
  bindBack?: (fn: (() => boolean) | null) => void
}) {
  /** One step back through the paper's own nesting, read through a ref so the
      binding below stays stable and the Escape handler above can reach it. */
  const stepBackRef = useRef<() => boolean>(() => false)
  const [pages, setPages] = useState(1)
  // The edition clock is the real clock, ticking, in AM/PM.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date())
      setDaylight(localDaylight())
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])
  const stamp = editionStamp(now)
  // The pops you dropped from the map, live. They arrive in this document
  // either through the shell's forward or through the storage event — the map
  // composer runs in the iframe, which has its own module state.
  const [dropped, setDropped] = useState<NewsMessage[]>(() => readNewsMessages())
  useEffect(() => onNewsMessages(setDropped), [])
  const [exhausted, setExhausted] = useState(false)
  /** Bumped by a refresh: the presses set a genuinely new edition. */
  const [edition, setEdition] = useState(0)
  /** Briefly announces how many stories the last pull brought in. */
  const [freshCount, setFreshCount] = useState(0)
  // Newsprint by day, an evening edition after dark — same daylight model the
  // map's sky uses, so the whole app agrees on what time it is. Re-checked on
  // the edition clock below rather than on a timer of its own.
  const [daylight, setDaylight] = useState(localDaylight)
  const [liked, setLiked] = useState<Set<string>>(() => new Set())
  const sentinel = useRef<HTMLDivElement>(null)
  const scrollHost = useRef<HTMLDivElement>(null)
  const pullInner = useRef<HTMLDivElement>(null)
  const pullPanel = useRef<HTMLDivElement>(null)
  const pullHead = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    // What you dropped leads the edition; the rest of the paper follows.
    const all: Entry[] = myEntries(dropped, now.getTime())
    for (let p = 0; p < pages; p += 1) all.push(...buildPage(p, edition))
    return all
  }, [pages, dropped, now, edition])

  // Keep setting type while the presses have something in reach.
  const loadMore = useCallback(() => {
    setPages(p => {
      const next = buildPage(p, edition)
      if (next.length === 0) { setExhausted(true); return p }
      return p + 1
    })
  }, [edition])

  useEffect(() => {
    const node = sentinel.current
    if (!node || exhausted) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore() }, { rootMargin: '400px' })
    io.observe(node)
    return () => io.disconnect()
  }, [loadMore, exhausted, entries.length])

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
  const [scope, setScope] = useState<'posts' | 'users'>('posts')
  /** Set by picking a user out of the drawer: the paper narrows to their work. */
  const [byHandle, setByHandle] = useState<string | null>(null)
  /** The story opened as a full page, the way a tweet opens. */
  const [detail, setDetail] = useState<Entry | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Innermost first: the drawer lays over the story, the story lays over the
  // edition. Returning false at the edition means "nothing left here" and the
  // cube falls through to whatever it does on the paper itself.
  stepBackRef.current = () => {
    if (menuOpen) { setMenuOpen(false); return true }
    if (detail) { setDetail(null); return true }
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
    playPop()
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
    : e.body.toLowerCase().includes(needle)
  const narrowed = byHandle ? entries.filter(e => e.handle === byHandle) : entries
  const shown = needle ? narrowed.filter(matches) : narrowed
  const filtering = Boolean(needle) || Boolean(byHandle)

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

  const openProfileFor = (handle?: string) => {
    playPop()
    setMenuOpen(false)
    setDetail(null)
    // Their profile, on Messages — the same hand-off the drawer's own Profile
    // row uses. (Whose profile is a live-service question; the shell opens the
    // profile surface and the mode it was asked for.)
    requestProfileMode('messages')
    window.dispatchEvent(new CustomEvent('poplur-open-profile-mode', {
      detail: { mode: 'messages', handle },
    }))
  }

  const lead = filtering ? undefined : shown[0]
  const rest = filtering ? shown : shown.slice(1)

  // Pull down for a new edition. Everything the paper prints is derived from
  // `pages`, `dropped` and `now`, so a refresh is: take whatever the map has
  // dropped since, throw away the pages already set, and re-stamp the edition
  // clock. The masthead date and time change under your finger, which is the
  // proof that it actually reprinted.
  const refresh = useCallback(() => {
    setDropped(readNewsMessages())
    setPages(1)
    setExhausted(false)
    setNow(new Date())
    // A new edition: fresh stories lead the paper, the way a timeline fills in
    // above what you were reading. Simulated until the live wire lands — the
    // banner says "new", not "live", so it never overstates itself.
    setEdition(e => e + 1)
    setFreshCount(8)
    window.setTimeout(() => setFreshCount(0), 4200)
    scrollHost.current?.scrollTo({ top: 0 })
  }, [])

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
          <p className={styles.freshBanner}>{freshCount} new posts</p>
        )}

        <header className={styles.masthead}>
          <div className={styles.mastRule}>
            <span>NO. {1200 + entries.length}</span>
            <span>WITHIN YOUR RADIUS</span>
            <span>FREE</span>
          </div>
          <h1 className={`${styles.title} ${styles.inkShader}`}>The Poplur Times</h1>
          <div className={styles.mastRuleThin}>
            <span>{stamp.date}</span>
            <span>{stamp.time}</span>
          </div>
        </header>

        {lead && (
          <article className={styles.lead}>
            <div className={styles.kicker}>
              {lead.kind === 'dispatch' ? 'MAP DISPATCH' : lead.mine ? 'YOUR POP' : 'FROM THE STREET'}
            </div>
            <h2 className={`${styles.leadHead} ${styles.inkShader}`}>{lead.body.split(/[:.]/)[0]}</h2>
            <p className={styles.leadBody}>
              <span className={styles.dropCap}>{lead.body.trim()[0]}</span>
              {lead.body.trim().slice(1)}
            </p>
            {snapshotFor(lead) && (
              <figure className={styles.plate}>
                <img className={styles.plateImg} src={snapshotFor(lead)!} alt="Map of the area this story covers" loading="lazy" />
                <figcaption className={styles.plateCap}>
                  THE MAP AT {stamp.time} · {lead.radiusKm} KM RADIUS
                </figcaption>
              </figure>
            )}
            <div className={styles.byline}>
              By {lead.who} · {lead.radiusKm} km radius · {lead.distanceKm} km away
              {' · '}{lead.when === 'now' ? 'just now' : `${lead.when} ago`}
            </div>
          </article>
        )}

        <div className={styles.columnsRule} aria-hidden="true" />

        {byHandle && (
          <button className={styles.filterChip} onClick={() => { playPop(); setByHandle(null) }}>
            Showing only {byHandle} · TAP TO CLEAR
          </button>
        )}

        {filtering && shown.length === 0 && (
          <p className={styles.noHits}>
            Nothing in this edition matches {needle ? `“${query.trim()}”` : byHandle}.
          </p>
        )}

        <div className={styles.timeline}>
          {rest.map(entry => (
            <article
              key={entry.id}
              className={entry.kind === 'dispatch' ? `${styles.entry} ${styles.entryAi}` : styles.entry}
              role="button"
              tabIndex={0}
              aria-label={`Open ${entry.who}'s post`}
              onClick={event => {
                // The engagement row and the plate have their own jobs; only a
                // tap on the story itself opens it.
                if ((event.target as HTMLElement).closest('button, a, figure')) return
                playPop()
                setDetail(entry)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); playPop(); setDetail(entry) }
              }}
            >
              <img className={styles.avatar} src={entry.avatar} alt="" draggable="false" />
              <div className={styles.entryBody}>
                <div className={styles.entryTop}>
                  <span className={styles.who}>{entry.who}</span>
                  <span className={styles.handle}>{entry.handle}</span>
                  {entry.verified && <VerifyBadge tier={entry.verified} />}
                  <span className={styles.dot}>·</span>
                  <span className={styles.when}>{entry.when}</span>
                  {entry.kind === 'dispatch' && <span className={styles.aiTag}>MAP DISPATCH</span>}
                  {entry.mine && <span className={styles.mineTag}>YOUR POP</span>}
                </div>
                <p className={styles.body}>{entry.body}</p>
                {entry.media?.length ? <EntryMedia media={entry.media} /> : null}
                {(entry.kind === 'dispatch' || entry.mine) && snapshotFor(entry) && (
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
                )}
                <div className={styles.reach}>
                  <span className={styles.reachPip} aria-hidden="true" />
                  {entry.radiusKm} km radius · {entry.distanceKm} km from you
                </div>
                <div className={styles.actions}>
                  <button className={styles.action} onClick={() => playPop()}>
                    <span aria-hidden="true">✎</span> {entry.replies}
                  </button>
                  <button className={styles.action} onClick={() => playPop()}>
                    <span aria-hidden="true">⇄</span> {entry.repops}
                  </button>
                  <button
                    className={liked.has(entry.id) ? `${styles.action} ${styles.actionOn}` : styles.action}
                    onClick={() => toggleLike(entry.id)}
                  >
                    <span aria-hidden="true">♥</span> {entry.likes + (liked.has(entry.id) ? 1 : 0)}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div ref={sentinel} className={styles.sentinel}>
          {exhausted
            ? <span className={styles.endMark}>— NOTHING FURTHER REACHES YOU —</span>
            : <span className={styles.setting}>setting more type…</span>}
        </div>
        </div>
      </div>

      {detail && (() => {
        const [lng, lat] = coordsFor(detail)
        const plate = snapshotFor(detail)
        return (
          <div className={styles.detail} role="dialog" aria-label={`${detail.who}'s post`}>
            <div className={styles.detailBar}>
              {/* No "‹ BACK". The cube under the page is the back button for
                  the whole app, and a story is exactly the case it was built
                  for: tap it and you are on the edition again. */}
              <span className={styles.detailKicker}>
                {detail.kind === 'dispatch' ? 'MAP DISPATCH' : detail.mine ? 'YOUR POP' : 'POST'}
              </span>
            </div>

            <div className={styles.detailScroll}>
              <button className={styles.detailWho} onClick={() => openProfileFor(detail.handle)}>
                <img src={detail.avatar} alt="" draggable={false} />
                <span>
                  <b>{detail.who}{detail.verified && <VerifyBadge tier={detail.verified} />}</b>
                  <i>{detail.handle} · view profile</i>
                </span>
              </button>

              <p className={styles.detailBody}>{detail.body}</p>
              {detail.media?.length ? <EntryMedia media={detail.media} large /> : null}
              <p className={styles.detailWhen}>{detail.when} ago</p>

              {/* Where it reaches, and where it was actually dropped. */}
              <dl className={styles.detailFacts}>
                <div>
                  <dt>RADIUS</dt>
                  <dd>{detail.radiusKm} km</dd>
                </div>
                <div>
                  <dt>FROM YOU</dt>
                  <dd>{detail.distanceKm} km</dd>
                </div>
                <div>
                  <dt>POSTED AT</dt>
                  <dd className={styles.detailCoords}>{lat.toFixed(4)}, {lng.toFixed(4)}</dd>
                </div>
              </dl>

              {plate ? (
                <figure className={styles.detailPlate}>
                  <img src={plate} alt={`Map of where ${detail.who} posted this`} loading="lazy" />
                  <figcaption>THE GROUND THIS WAS POSTED ON · {detail.radiusKm} KM RADIUS</figcaption>
                </figure>
              ) : (
                <p className={styles.detailNoPlate}>
                  The map plate needs a Mapbox token in this build.
                </p>
              )}

              <div className={styles.detailStats}>
                <span>✎ {detail.replies}</span>
                <span>⇄ {detail.repops}</span>
                <span>♥ {detail.likes + (liked.has(detail.id) ? 1 : 0)}</span>
              </div>

              <button className={styles.detailProfile} onClick={() => openProfileFor(detail.handle)}>
                OPEN {detail.who.toUpperCase()}’S PROFILE
              </button>
            </div>
          </div>
        )
      })()}

      <ScreenCoach
        id="news"
        title="THE POPLUR TIMES"
        lines={[
          'Tap a story to open it, with the ground it was posted on.',
          'Pull down for a new edition.',
          'The menu searches posts and people.',
        ]}
      />

      {/* Side rail, outside the scroll — the same edge-mounted furniture the
          TV screen and the map carry, rather than a hamburger stuck in a
          corner it doesn't share with anything. */}
      <TabControlRail side={controlSide} label="News controls">
        <button className={styles.burger} onClick={openMenu} aria-label="Open news menu">
          <i /><i /><i />
        </button>
        <button
          className={showTop ? styles.toTop : `${styles.toTop} ${styles.toTopHidden}`}
          onClick={backToTop}
          aria-label="Back to the top of the paper"
          aria-hidden={showTop ? undefined : 'true'}
          tabIndex={showTop ? 0 : -1}
        >
          ⌃<span className={styles.toTopText}>TOP</span>
        </button>
      </TabControlRail>

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
              {(['posts', 'users'] as const).map(option => (
                <button
                  key={option}
                  role="tab"
                  aria-selected={scope === option}
                  className={scope === option ? styles.scopeOn : styles.scope}
                  onClick={() => { playPop(); setScope(option) }}
                >
                  {option === 'posts' ? 'POSTS' : 'USERS'}
                </button>
              ))}
            </div>

            <label className={styles.search}>
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
            </label>

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
