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
// Presentation lives in popups.tsx — the shared centred layer that suggestions
// use too. This module is now only the SOURCE of engagement (real wire + demo
// cadence); it no longer owns where a notice appears or how long it lives.
//
// Thermal rules (the 6 Aug device trace is why): the layer animates
// transform/opacity ONLY, one-shot keyframes, a hard cap on how many are
// alive, and the generator here idles whenever the page is hidden or the
// quality ladder has dropped ambient decoration.

import { ambientAllowed } from './frameGovernor'
import { showPopup, clearPopups } from './popups'

export interface EngagementEvent {
  user: string
  kind: 'like' | 'view' | 'comment'
  /** Accepted for wire compatibility; notices are screen-anchored now. */
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

export function startEngagementChips(): () => void {
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
    const icon = event.kind === 'like' ? '♥' : event.kind === 'view' ? '◉' : '✎'
    showPopup({
      kind: 'engagement',
      icon,
      // The host renders this as text, never markup — usernames are data.
      text: `${event.user} ${VERB[event.kind]}`,
    })
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
    clearPopups('engagement')
  }
}
