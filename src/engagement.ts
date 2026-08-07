// Live engagement on the map: who just liked/viewed your post, named, popping
// up AT the post and disappearing again — the map is your takeover, and this
// is the takeover breathing.
//
// Two sources feed one surface:
//   REAL   — native (or any host) dispatches
//              window.dispatchEvent(new CustomEvent('poplur-engagement',
//                { detail: { user, kind, coords? } }))
//            or posts { type: 'poplur-engagement', user, kind, coords? }.
//            This is the wire the Aug-2026 live service plugs into; the shape
//            is the whole contract.
//   DEMO   — until then, a generator emits plausible engagement on a human
//            cadence using the SAME path, so the surface, its pacing and its
//            cost are all real today. Identities come from the feed's own
//            sample cast — no invented population.
//
// Thermal rules (the 6 Aug device trace is why): chips are DOM markers
// animated with transform/opacity ONLY, one-shot keyframes, box-shadow not
// filter, at most three alive, and the generator idles whenever the page is
// hidden or the quality ladder has dropped ambient decoration.

import mapboxgl from 'mapbox-gl'
import { ambientAllowed } from './frameGovernor'

export interface EngagementEvent {
  user: string
  kind: 'like' | 'view' | 'comment'
  /** where the engaged post sits; defaults to the host-supplied anchor */
  coords?: [number, number]
}

// The feed's sample cast (FeedTwin comments + profile) — reused, not invented.
const CAST = [
  'SAUCEBOSS', '@nightmarket', '@poutine.patrol', '@alpastor', '@baristabit',
  '@basement.set', '@citydesk', '@boulangerie', '@bpm', '@blanketfort',
  '@benchmark', '@atelier', '@backstage', '@bitmerchant',
] as const

const VERB: Record<EngagementEvent['kind'], string> = {
  like: 'liked your post',
  view: 'viewed your post',
  comment: 'commented',
}

const MAX_CHIPS = 3
const CHIP_LIFE_MS = 3_000

export function startEngagementChips(
  map: mapboxgl.Map,
  anchor: () => [number, number],
): () => void {
  const live = new Set<mapboxgl.Marker>()
  let stopped = false

  const show = (event: EngagementEvent) => {
    if (stopped || document.visibilityState === 'hidden') return
    if (live.size >= MAX_CHIPS) return // drop, never queue — stale news is noise
    const [lng, lat] = event.coords ?? anchor()
    // Scatter chips around the claim so simultaneous fans do not stack into
    // one unreadable pile. ~±400m.
    const jlng = lng + (Math.random() - 0.5) * 0.008
    const jlat = lat + (Math.random() - 0.5) * 0.006

    const el = document.createElement('div')
    el.className = 'poplur-engage-chip'
    el.setAttribute('role', 'status')
    const heart = event.kind === 'like' ? '♥' : event.kind === 'view' ? '◉' : '✎'
    el.innerHTML = `<b>${heart}</b><span><strong></strong> ${VERB[event.kind]}</span>`
    // textContent for the name: usernames are data, never markup.
    const nameEl = el.querySelector('strong')
    if (nameEl) nameEl.textContent = event.user

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
      .setLngLat([jlng, jlat])
      .addTo(map)
    live.add(marker)

    window.setTimeout(() => {
      el.classList.add('poplur-engage-chip-out')
      window.setTimeout(() => { marker.remove(); live.delete(marker) }, 480)
    }, CHIP_LIFE_MS)
  }

  // ── the real wire ─────────────────────────────────────────────────────────
  const onEvent = (e: Event) => {
    const d = (e as CustomEvent).detail as EngagementEvent | undefined
    if (d && typeof d.user === 'string' && d.kind in VERB) show(d)
  }
  const onMessage = (e: MessageEvent) => {
    const d = e.data as (EngagementEvent & { type?: string }) | null
    if (d && d.type === 'poplur-engagement' && typeof d.user === 'string' && d.kind in VERB) show(d)
  }
  window.addEventListener('poplur-engagement', onEvent)
  window.addEventListener('message', onMessage)

  // ── the demo cadence ──────────────────────────────────────────────────────
  // A believable trickle: one engagement every 6–14s, likes twice as common as
  // views, comments rare. Skips entirely while hidden or thermally throttled.
  let demoTimer = 0
  const scheduleDemo = () => {
    if (stopped) return
    demoTimer = window.setTimeout(() => {
      if (document.visibilityState === 'visible' && ambientAllowed()) {
        const roll = Math.random()
        show({
          user: CAST[Math.floor(Math.random() * CAST.length)],
          kind: roll < 0.55 ? 'like' : roll < 0.9 ? 'view' : 'comment',
        })
      }
      scheduleDemo()
    }, 6_000 + Math.random() * 8_000)
  }
  scheduleDemo()

  return () => {
    stopped = true
    window.clearTimeout(demoTimer)
    window.removeEventListener('poplur-engagement', onEvent)
    window.removeEventListener('message', onMessage)
    live.forEach(m => m.remove())
    live.clear()
  }
}
