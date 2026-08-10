// Live engagement on the map: who just liked/viewed your post, named, popping
// up AT the post and disappearing again — the map is your takeover, and this
// is the takeover breathing.
//
// Two sources feed one surface:
//   REAL   — native (or any host) dispatches
//              window.dispatchEvent(new CustomEvent('poplur-engagement',
//                { detail: { user, kind, coords?, radiusKm?, place? } }))
//            or posts { type: 'poplur-engagement', user, kind, coords?, … }.
//            This is the wire the Aug-2026 live service plugs into; the shape
//            is the whole contract.
//   DEMO   — until then, a generator emits plausible engagement on a human
//            cadence using the SAME path, so the surface, its pacing and its
//            cost are all real today. Identities come from the feed's own
//            sample cast — no invented population.
//
// Presentation lives in popups.tsx — the shared centred layer that suggestions
// use too. This module is now only the SOURCE of engagement (real wire + demo
// cadence); it no longer owns where a notice appears or how long it lives.
//
// It does not own the CAMERA either. An engagement carries the coordinates of
// the post it landed on, and the map answers by travelling there — the notice
// tells you who, the trip shows you where. Whether taking the camera is
// appropriate at that moment is the map's decision, so this module only hands
// the event to the listener App registers (see traverseToEngagement).
//
// Thermal rules (the 6 Aug device trace is why): the layer animates
// transform/opacity ONLY, one-shot keyframes, a hard cap on how many are
// alive, and the generator here idles whenever the page is hidden or the
// quality ladder has dropped ambient decoration.

import { POIS } from './data'
import { ambientAllowed } from './frameGovernor'
import { showPopup, clearPopups } from './popups'
import { recordEngagement } from './engagementLog'

export interface EngagementEvent {
  user: string
  kind: 'like' | 'view' | 'comment'
  /** Where the engaged post is. The NOTICE is screen-anchored — it is news
   *  about you, not a place — but the post itself holds ground on the map, and
   *  that is where the camera goes. Optional: an engagement without coordinates
   *  still pops a notice, it just has nowhere to travel to. */
  coords?: [number, number]
  /** The post's takeover radius in km, so the arrival can draw the ground it
   *  holds. Optional: the map falls back to the pop it recognises at `coords`. */
  radiusKm?: number
  /** What to call the place on arrival. Same fallback. */
  place?: string
}

export interface EngagementOptions {
  /**
   * Called for every engagement this surface actually SHOWS — real or demo, in
   * emission order. App registers the camera here; anything else that wants to
   * answer engagement can register too. Deliberately a callback rather than
   * another window event: the decision to move the camera belongs to the one
   * document that owns it, not to whoever happens to be listening.
   */
  onEngagement?: (event: EngagementEvent) => void
  /**
   * Emit the demo trickle. Exactly ONE document may: the map embed owns it,
   * because it has the POIs an engagement lands on and the camera that answers.
   * The shell passes false and runs relay-only, or the two generators would
   * double the cadence.
   */
  demo?: boolean
  /**
   * Post engagement up to the parent instead of drawing it here. Set by the map
   * embed — see the note in `show`. Ignored when there is no parent.
   */
  forwardToParent?: boolean
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

/** The verb, so a caller can rebuild the sentence the notice just showed. */
export function engagementVerb(kind: EngagementEvent['kind']): string {
  return VERB[kind]
}

export function startEngagementChips(options: EngagementOptions = {}): () => void {
  let stopped = false

  const show = (event: EngagementEvent) => {
    if (stopped || document.visibilityState === 'hidden') return
    // Screen-anchored, not world-anchored.
    //
    // These were mapboxgl.Markers scattered ~±400m around the claim, which
    // meant a notice landed wherever the camera happened to put it — including
    // under the status bar, or off-screen entirely. "@name liked your post" is
    // news about YOU; it is not a place on the map you could travel to, so it
    // belongs to the screen. Going through the shared layer also means the
    // feed gets engagement for free: there is no Mapbox instance there to hang
    // a marker on, which is the only reason it was map-only.
    // WHERE the notice is drawn depends on which document this is.
    //
    // The map runs in an always-mounted iframe behind Feed and Profile, and each
    // document renders its own PopupHost. If the embed drew its own notices as
    // well as the shell, every engagement would appear twice on the map surface:
    // once inside the iframe and once in the shell's layer above it. So the
    // embed FORWARDS and the shell DRAWS — which is also what finally puts
    // engagement on the feed, where there is no Mapbox instance at all.
    //
    // Standalone (the shell-less map route on :5199) there is no parent, so this
    // falls through and draws locally exactly as before.
    if (options.forwardToParent && window.parent !== window) {
      window.parent.postMessage({ type: 'poplur-engagement', ...event }, '*')
      // The camera still belongs to THIS document, so it is answered here.
      options.onEngagement?.(event)
      return
    }
    // This document is the one being looked at, so the history is written from
    // here too — the notifications screen reads it out of the same log.
    recordEngagement(event)
    const icon = event.kind === 'like' ? '♥' : event.kind === 'view' ? '◉' : '✎'
    showPopup({
      kind: 'engagement',
      icon,
      // The host renders this as text, never markup — usernames are data.
      text: `${event.user} ${VERB[event.kind]}`,
      // Tapping the notice opens the POST it is about, in the feed, with the
      // engagement lit up (the comment highlighted, the like/view pulsed).
      // The feed lives in the SHELL document; this layer runs inside the map
      // iframe, so the tap posts the engagement up rather than navigating
      // anything itself. Standalone (no parent) it falls back to a local
      // event, which the shell-less map route simply has nobody listening to.
      onActivate: () => {
        const payload = {
          type: 'poplur-open-engagement',
          user: event.user,
          kind: event.kind,
          coords: event.coords,
          radiusKm: event.radiusKm,
          place: event.place,
        }
        if (window.parent !== window) window.parent.postMessage(payload, '*')
        else window.dispatchEvent(new CustomEvent('poplur-open-engagement', { detail: payload }))
      },
    })
    // The notice is out; now whoever owns a camera may answer it. Shown-only,
    // so an engagement suppressed by visibility can never move the map behind
    // a screen the user is not looking at.
    options.onEngagement?.(event)
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
  //
  // Each one lands on a POP — a real post standing somewhere on the map, from
  // the same list the channel arrows walk — because an engagement with no post
  // behind it has nowhere for the camera to go, and "somewhere plausible" is
  // the whole point of the demo. No invented coordinates: the live wire will
  // carry the real post's own.
  let demoTimer = 0
  const scheduleDemo = () => {
    if (stopped) return
    demoTimer = window.setTimeout(() => {
      if (document.visibilityState === 'visible' && ambientAllowed()) {
        const roll = Math.random()
        const poi = POIS[Math.floor(Math.random() * POIS.length)]
        show({
          user: CAST[Math.floor(Math.random() * CAST.length)],
          // 45 / 35 / 20. Likes still lead, as they would in life, but comments
          // at the old 10% were rare enough that the surface read as likes-only
          // — which is exactly how it was reported.
          kind: roll < 0.45 ? 'like' : roll < 0.8 ? 'view' : 'comment',
          coords: poi.coords,
          radiusKm: poi.radiusKm,
          place: poi.name,
        })
      }
      scheduleDemo()
    }, 6_000 + Math.random() * 8_000)
  }
  // Only one document generates; the shell passes demo: false and relays.
  if (options.demo !== false) scheduleDemo()

  return () => {
    stopped = true
    window.clearTimeout(demoTimer)
    window.removeEventListener('poplur-engagement', onEvent)
    window.removeEventListener('message', onMessage)
    clearPopups('engagement')
  }
}
