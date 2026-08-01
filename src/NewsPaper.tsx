import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './NewsPaper.module.css'
import { playPop } from './pop'
import ClayCornerButton from './ClayCornerButton'

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

// Successive pages sit further out. A message only appears if its radius still
// reaches you — the same interception rule the feed and the map use.
function buildPage(page: number): Entry[] {
  const out: Entry[] = []
  for (let i = 0; i < 8; i += 1) {
    const n = page * 8 + i
    const r = seeded(n)
    const kind: Entry['kind'] = n % 3 === 0 ? 'dispatch' : 'message'
    const distanceKm = +(n * 0.9 + r * 2.4).toFixed(1)
    const radiusKm = +(3 + seeded(n + 101) * 38).toFixed(1)
    if (distanceKm > radiusKm) continue // out of reach: it is not your news
    const writer = WRITERS[n % WRITERS.length]
    out.push({
      id: `e${n}`,
      kind,
      who: kind === 'dispatch' ? 'Poplur AI' : writer.who,
      handle: kind === 'dispatch' ? '@poplur' : writer.handle,
      avatar: kind === 'dispatch' ? 'logo_icon.png' : AVATARS[n % AVATARS.length],
      body: kind === 'dispatch' ? DISPATCHES[n % DISPATCHES.length] : MESSAGES[n % MESSAGES.length],
      radiusKm,
      distanceKm,
      when: n < 3 ? `${2 + n * 5}m` : n < 9 ? `${1 + Math.floor(n / 3)}h` : `${1 + Math.floor(n / 9)}d`,
      replies: Math.floor(r * 40),
      repops: Math.floor(seeded(n + 7) * 90),
      likes: Math.floor(seeded(n + 13) * 400),
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

function snapshotFor(entry: Entry): string | null {
  if (!MAPBOX_TOKEN) return null
  // step the centre out with the story's distance so each snapshot differs
  const bearing = (entry.distanceKm * 37) % 360
  const rad = (bearing * Math.PI) / 180
  const lng = HOME[0] + (entry.distanceKm / 85) * Math.cos(rad)
  const lat = HOME[1] + (entry.distanceKm / 111) * Math.sin(rad)
  const zoom = entry.radiusKm > 24 ? 8.4 : entry.radiusKm > 10 ? 10.2 : 12.4
  const pin = `pin-l+f63b9a(${lng.toFixed(4)},${lat.toFixed(4)})`
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pin}/`
    + `${lng.toFixed(4)},${lat.toFixed(4)},${zoom},0/640x360@2x`
    + `?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
}

function editionStamp(now: Date) {
  return {
    date: now.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
  }
}

export default function NewsPaper({ onClose }: { onClose: () => void }) {
  const [pages, setPages] = useState(1)
  // The edition clock is the real clock, ticking, in AM/PM.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const stamp = editionStamp(now)
  const [exhausted, setExhausted] = useState(false)
  const [liked, setLiked] = useState<Set<string>>(() => new Set())
  const sentinel = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    const all: Entry[] = []
    for (let p = 0; p < pages; p += 1) all.push(...buildPage(p))
    return all
  }, [pages])

  // Keep setting type while the presses have something in reach.
  const loadMore = useCallback(() => {
    setPages(p => {
      const next = buildPage(p)
      if (next.length === 0) { setExhausted(true); return p }
      return p + 1
    })
  }, [])

  useEffect(() => {
    const node = sentinel.current
    if (!node || exhausted) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore() }, { rootMargin: '400px' })
    io.observe(node)
    return () => io.disconnect()
  }, [loadMore, exhausted, entries.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
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

  const lead = entries[0]
  const rest = entries.slice(1)

  return (
    <div className={styles.paper} role="dialog" aria-label="Poplur Times">
      {/* No ✕ — the cube is the back control for every subscreen. */}
      <div className={styles.scroll}>
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
            <div className={styles.kicker}>{lead.kind === 'dispatch' ? 'MAP DISPATCH' : 'FROM THE STREET'}</div>
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
              By {lead.who} · {lead.radiusKm} km radius · {lead.distanceKm} km away · {lead.when} ago
            </div>
          </article>
        )}

        <div className={styles.columnsRule} aria-hidden="true" />

        <div className={styles.timeline}>
          {rest.map(entry => (
            <article
              key={entry.id}
              className={entry.kind === 'dispatch' ? `${styles.entry} ${styles.entryAi}` : styles.entry}
            >
              <img className={styles.avatar} src={entry.avatar} alt="" draggable="false" />
              <div className={styles.entryBody}>
                <div className={styles.entryTop}>
                  <span className={styles.who}>{entry.who}</span>
                  <span className={styles.handle}>{entry.handle}</span>
                  <span className={styles.dot}>·</span>
                  <span className={styles.when}>{entry.when}</span>
                  {entry.kind === 'dispatch' && <span className={styles.aiTag}>MAP DISPATCH</span>}
                </div>
                <p className={styles.body}>{entry.body}</p>
                {entry.kind === 'dispatch' && snapshotFor(entry) && (
                  <figure className={styles.plateSmall}>
                    <img className={styles.plateImg} src={snapshotFor(entry)!} alt="Map of the area this dispatch covers" loading="lazy" />
                    <figcaption className={styles.plateCap}>THE MAP · {entry.distanceKm} KM OUT</figcaption>
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
  )
}
