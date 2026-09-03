import React, { useEffect, useState } from 'react'
import surfaceStyles from './TransientPopupSurface.module.css'
import styles from './popups.module.css'
import type { SmartCard } from './tourSmarts'
import CommerceSuggestionWindow, { type SuggestionPrimaryAction } from './CommerceSuggestionWindow'
import NewsPopCard from './NewsPopCard'
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

export type PopupKind = 'engagement' | 'suggestion' | 'mapContent'

export interface MapPopContent {
  id: string
  name: string
  user: string | null
  channel?: string
  caption?: string
  radiusKm: number
  /** Optional only because a pop may be a MESSAGE rather than a picture: every
   *  pop carries media or a caption, never neither (the composer refuses to
   *  publish an empty one and the map drops any row that arrives that way).
   *  A message-only pop opens and shows its words where the media would be. */
  media?: {
    kind: 'image' | 'video'
    src: string
    poster?: string
    alt: string
  }
}

export interface PopupItem {
  id: number
  kind: PopupKind
  /** engagement: the verb line. suggestion: the card. */
  text?: string
  icon?: string
  card?: SmartCard
  /** The actual post standing on a map claim. This is deliberately separate
   *  from a suggestion: a pop shows its own media, while an AI-highlighted
   *  place with no pop shows a commerce card. */
  content?: MapPopContent
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
  // The standing instruction on this number is "shorter". History: 12s → the
  // card read as a squatter over the video → 9.5s → still "shown for too long"
  // → 6.5s, which held until 2026-08-09, when the ask was again that ads
  // "disappear faster". So 4s.
  //
  // The floor is engagement's 3.4s: a suggestion is something you might act on
  // and must outlast a glance, so it cannot become briefer than a notice you
  // only read. 4s is just above that floor, and it is the third time this has
  // come down — if it needs to go lower, the honest move is to stop showing
  // the card on that surface rather than to flash it.
  suggestion: 4_000,
  // A post is the destination rather than a passing ad. Give its single video
  // pass enough time to read, while retaining the shared guarantee that every
  // transient window eventually leaves on its own.
  mapContent: 10_000,
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

/** Reports whether a food suggestion is presently visible in this document.
 *  Home subscribes directly for Feed; the Map iframe forwards the same signal
 *  to Home, so both surfaces obey one popup lifecycle. */
export function onFoodSuggestionVisibilityChange(fn: (visible: boolean) => void): () => void {
  let previous: boolean | undefined
  return subscribe(current => {
    const visible = current.some(item => item.kind === 'suggestion' && item.card?.foodRelated === true)
    if (visible === previous) return
    previous = visible
    fn(visible)
  })
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
export default function PopupHost({ dismissOnBackdrop = false }: { dismissOnBackdrop?: boolean }) {
  const [live, setLive] = useState<PopupItem[]>(items)
  useEffect(() => subscribe(setLive), [])

  // Tap-anywhere dismissal, watched at the document instead of by making the
  // full-screen layer a pointer target. The layer covers the whole map, so
  // `pointer-events: auto` on it consumed every gesture underneath: Mapbox's
  // dragPan stayed enabled but never received a touch, and the map could not
  // be panned until something else cleared the popup (pressing a channel
  // button, which changes the pop, was the accidental cure).
  //
  // A TAP dismisses; a DRAG is left alone so it reaches the map as usual. The
  // tap's click is swallowed once so dismissing an ad does not also act on
  // whatever sits under it.
  const dismissible = dismissOnBackdrop && live.length > 0
  useEffect(() => {
    if (!dismissible) return
    let startX = 0, startY = 0, startT = 0, tracking = false
    const TAP_SLOP_PX = 10
    const TAP_MS = 600
    const onDown = (event: PointerEvent) => {
      // Taps that land on the popup's own card are its business, not ours.
      if ((event.target as Element | null)?.closest?.(`.${styles.host}`)) { tracking = false; return }
      tracking = true
      startX = event.clientX; startY = event.clientY; startT = event.timeStamp
    }
    const onUp = (event: PointerEvent) => {
      if (!tracking) return
      tracking = false
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY)
      if (moved > TAP_SLOP_PX || event.timeStamp - startT > TAP_MS) return
      playPop()
      clearPopups()
      // Swallow only the click this tap is about to produce.
      const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault() }
      document.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => document.removeEventListener('click', swallow, true), 400)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', () => { tracking = false }, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
    }
  }, [dismissible])

  // With the native map experiment, taps outside explicit web HUD regions go
  // straight to MapKit and never enter this document. Native mirrors a settled
  // map tap back as this event so the established tap-anywhere dismissal rule
  // still holds without making the full-screen popup host a hit target.
  useEffect(() => {
    if (!dismissible) return
    const dismissFromNativeMap = () => { playPop(); clearPopups() }
    window.addEventListener('poplur-native-map-tap', dismissFromNativeMap)
    return () => window.removeEventListener('poplur-native-map-tap', dismissFromNativeMap)
  }, [dismissible])

  if (!live.length) return null

  return (
    <div
      className={dismissOnBackdrop ? `${styles.host} ${styles.hostDismissible}` : styles.host}
      aria-live="polite"
    >
      {live.map(item => (
        <div
          key={item.id}
          data-poplur-native-hit-region={item.kind === 'engagement' ? '' : undefined}
          className={item.kind === 'engagement'
            ? `${styles.engage} ${surfaceStyles.surface}`
            : item.kind === 'mapContent'
              ? styles.mapContentWrap
              : styles.suggestWrap}
          style={item.kind === 'engagement' ? { animationDuration: `${item.ttl}ms` } : undefined}
          onClick={item.kind === 'engagement'
            ? () => {
                // A tap that ACTS pops (it is a real gesture, the full house
                // sound); a tap that merely dismisses stays silent, as ever.
                if (item.onActivate) {
                  playPop()
                  item.onActivate()
                }
                dismissPopup(item.id)
              }
            : () => {
                // CommerceSuggestionWindow stops propagation for its real
                // controls. Reaching this full-screen wrapper means the user
                // tapped anywhere around the ad, which is also a dismissal.
                playPop()
                dismissPopup(item.id)
              }}
        >
          {item.kind === 'engagement' ? (
            <>
              <b className={styles.engageIcon}>{item.icon ?? '♥'}</b>
              <span className={styles.engageText}>{item.text}</span>
            </>
          ) : item.kind === 'mapContent' && item.content ? (
            <NewsPopCard
              embedded
              dataId={item.content.id}
              status="POPLUR POP"
              statusKind="pop"
              place={`${item.content.user ?? 'YOUR POP'} · ${item.content.channel?.toUpperCase() ?? 'POP'}`}
              title={item.content.name}
              summary={item.content.caption ?? item.content.media?.alt ?? ''}
              summaryLabel="FROM THE MAP"
              meta={`${item.content.radiusKm.toFixed(1)} km radius`}
              media={item.content.media}
              onClose={() => {
                playPop()
                dismissPopup(item.id)
              }}
              onMediaActivate={item.onActivate ? () => {
                playPop()
                item.onActivate?.()
                dismissPopup(item.id)
              } : undefined}
              primaryAction={item.onActivate ? {
                label: 'SHOW IN FEED',
                onActivate: () => {
                  playPop()
                  item.onActivate?.()
                  dismissPopup(item.id)
                },
              } : undefined}
              secondaryAction={item.action ? {
                label: item.action.label,
                onActivate: () => {
                  playPop()
                  item.action?.onActivate()
                  dismissPopup(item.id)
                },
              } : undefined}
            />
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
