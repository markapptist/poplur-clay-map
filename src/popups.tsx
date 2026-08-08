import React, { useEffect, useState } from 'react'
import styles from './popups.module.css'
import type { SmartCard } from './tourSmarts'
import CommerceSuggestionWindow, { type SuggestionPrimaryAction } from './CommerceSuggestionWindow'
import { playPop, playPopAmbient } from './pop'

// The app's one transient popup layer: engagement and suggestions, centred on
// screen, alive for a few seconds, then gone.
//
// WHY this exists as a shared layer rather than three separate ones:
//
//   ENGAGEMENT used to be a mapboxgl.Marker pinned to lng/lat and scattered
//   ~±400m around the claim. Pinned to the WORLD, a notice lands wherever the
//   camera happens to put it — over the status bar, off-screen, behind the HUD.
//   "@citydesk liked your post" is news about you, not a place you can visit,
//   so it belongs to the screen. It also meant engagement could only ever exist
//   on the map, because the feed has no Mapbox instance to hang a marker on.
//
//   SUGGESTIONS existed twice and disagreed. The feed's card expired after
//   12.5s in the bottom-left; the map's tour card had no timer at all and was
//   only cleared when the next trip started, so it sat on screen indefinitely.
//
// One layer, one lifetime rule, both surfaces. Anything that pops must also
// leave: every item here carries a TTL and removes itself.
//
// Thermal note (this is the same trace that shaped engagement.ts): entries
// animate transform/opacity only, one-shot, capped at MAX_LIVE. Nothing here
// runs a per-frame loop — the whole layer is idle between popups.

export type PopupKind = 'engagement' | 'suggestion'

export interface PopupItem {
  id: number
  kind: PopupKind
  /** engagement: the verb line. suggestion: the card. */
  text?: string
  icon?: string
  card?: SmartCard
  /** Optional app-owned primary action, such as opening a creator profile. */
  action?: SuggestionPrimaryAction
  ttl: number
  /** Tapping the notice DOES something (an engagement opens its post in the
   *  feed). Runs on tap, then the notice leaves; without it a tap only
   *  dismisses, exactly as before. */
  onActivate?: () => void
}

/** A suggestion is something you might act on, so it holds still and waits.
 *  An engagement is a GLANCE — it pops, climbs past you and is gone, the way
 *  the feed's comments roll, only much faster. Its whole life is the climb, so
 *  the TTL and the animation are the same number: 3.4s is long enough to read
 *  one line ("@citydesk liked your post") and short enough that the motion
 *  reads as a pop rather than a drift.
 *
 *  The suggestion used to hold 9.5s and read as a squatter over the video —
 *  "shown for too long" verbatim — so it stays at the shorter window. */
const TTL: Record<PopupKind, number> = {
  engagement: 3_400,
  suggestion: 12_000,
}

// More than a few at once is a pile nobody reads. Oldest goes first.
const MAX_LIVE = 3

let nextId = 1
let items: PopupItem[] = []
const listeners = new Set<(items: PopupItem[]) => void>()
const expiryTimers = new Map<number, number>()
const suppressedKinds = new Set<PopupKind>()

// The feed's fullscreen player owns the whole screen: while it is up, nothing
// pops — not suggestions, not engagement. A flag here rather than a prop chain
// because engagement.ts drives showPopup from plain event listeners that never
// see React state.
let suppressedAll = false
export function setPopupsSuppressed(on: boolean): void {
  if (suppressedAll === on) return
  suppressedAll = on
  if (on && items.length) clearPopups()
}

/** A surface can silence one kind without hiding useful cards of the other. */
export function setPopupKindSuppressed(kind: PopupKind, on: boolean): void {
  if (on) {
    suppressedKinds.add(kind)
    clearPopups(kind)
  } else {
    suppressedKinds.delete(kind)
  }
}

const emit = () => { const snapshot = items; listeners.forEach(fn => fn(snapshot)) }

function subscribe(fn: (items: PopupItem[]) => void): () => void {
  listeners.add(fn)
  fn(items)
  return () => { listeners.delete(fn) }
}

export function dismissPopup(id: number): void {
  const timer = expiryTimers.get(id)
  if (timer != null) window.clearTimeout(timer)
  expiryTimers.delete(id)
  const next = items.filter(i => i.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
}

/** Once somebody uses the window controls, it must not expire underneath them. */
export function keepPopupOpen(id: number): void {
  const timer = expiryTimers.get(id)
  if (timer != null) window.clearTimeout(timer)
  expiryTimers.delete(id)
}

/**
 * Show a popup. Returns its id.
 *
 * Callable from non-React code (engagement.ts drives this from a plain event
 * listener), which is why the store lives outside React and the host merely
 * renders it.
 */
export function showPopup(item: Omit<PopupItem, 'id' | 'ttl'> & { ttl?: number }): number {
  const id = nextId++
  // Silently dropped, not queued: by the time the player closes this notice
  // would be stale news, same rule as the MAX_LIVE overflow below.
  if (suppressedAll || suppressedKinds.has(item.kind)) return id
  const ttl = item.ttl ?? TTL[item.kind]
  items = [...items, { ...item, id, ttl }]
  // Never let the stack grow past MAX_LIVE: drop the oldest rather than queue,
  // because by the time a queued notice surfaced it would be stale news.
  if (items.length > MAX_LIVE) items = items.slice(items.length - MAX_LIVE)
  emit()
  // Everything that pops, pops — the house sound, on both surfaces. The
  // AMBIENT variant: it parks the audio context the moment the sample ends,
  // because these fire on a cadence with nobody touching the screen and the
  // ordinary pop's 8s volley-nap kept the audio thread running at idle (the
  // exact thing the thermal gate fails builds for). Muted app stays silent.
  playPopAmbient()
  expiryTimers.set(id, window.setTimeout(() => dismissPopup(id), ttl))
  return id
}

/** Clear everything — used when a surface tears down or a trip restarts. */
export function clearPopups(kind?: PopupKind): void {
  const removed = kind ? items.filter(i => i.kind === kind) : items
  removed.forEach(item => {
    const timer = expiryTimers.get(item.id)
    if (timer != null) window.clearTimeout(timer)
    expiryTimers.delete(item.id)
  })
  items = kind ? items.filter(i => i.kind !== kind) : []
  emit()
}

/**
 * Mount ONCE, high in the tree. Being screen-fixed and shared is what puts the
 * same notices on the map and the feed without either one owning them.
 */
export default function PopupHost() {
  const [live, setLive] = useState<PopupItem[]>(items)
  useEffect(() => subscribe(setLive), [])
  if (!live.length) return null

  return (
    <div className={styles.host} aria-live="polite">
      {live.map(item => (
        <div
          key={item.id}
          className={item.kind === 'engagement' ? styles.engage : styles.suggestWrap}
          style={item.kind === 'engagement' ? { animationDuration: `${item.ttl}ms` } : undefined}
          onClick={item.kind === 'engagement' ? () => {
            // A tap that ACTS pops (it is a real gesture, the full house
            // sound); a tap that merely dismisses stays silent, as ever.
            if (item.onActivate) {
              playPop()
              item.onActivate()
            }
            dismissPopup(item.id)
          } : undefined}
        >
          {item.kind === 'engagement' ? (
            <>
              <b className={styles.engageIcon}>{item.icon ?? '♥'}</b>
              <span className={styles.engageText}>{item.text}</span>
            </>
          ) : item.card ? (
            <CommerceSuggestionWindow
              card={item.card}
              action={item.action}
              onClose={() => dismissPopup(item.id)}
              onInteract={() => keepPopupOpen(item.id)}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}
