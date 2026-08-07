import React, { useEffect, useState } from 'react'
import styles from './popups.module.css'
import type { SmartCard } from './tourSmarts'
import { postNativeEvent } from './nativeBridge'

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
  ttl: number
}

/** Engagement is a glance; a suggestion is something you might act on. */
const TTL: Record<PopupKind, number> = {
  engagement: 3_400,
  suggestion: 11_000,
}

// More than a few at once is a pile nobody reads. Oldest goes first.
const MAX_LIVE = 3

let nextId = 1
let items: PopupItem[] = []
const listeners = new Set<(items: PopupItem[]) => void>()

const emit = () => { const snapshot = items; listeners.forEach(fn => fn(snapshot)) }

function subscribe(fn: (items: PopupItem[]) => void): () => void {
  listeners.add(fn)
  fn(items)
  return () => { listeners.delete(fn) }
}

export function dismissPopup(id: number): void {
  const next = items.filter(i => i.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
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
  const ttl = item.ttl ?? TTL[item.kind]
  items = [...items, { ...item, id, ttl }]
  // Never let the stack grow past MAX_LIVE: drop the oldest rather than queue,
  // because by the time a queued notice surfaced it would be stale news.
  if (items.length > MAX_LIVE) items = items.slice(items.length - MAX_LIVE)
  emit()
  window.setTimeout(() => dismissPopup(id), ttl)
  return id
}

/** Clear everything — used when a surface tears down or a trip restarts. */
export function clearPopups(kind?: PopupKind): void {
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
          className={item.kind === 'engagement' ? styles.engage : styles.suggest}
          style={{ animationDuration: `${item.ttl}ms` }}
          onClick={() => dismissPopup(item.id)}
        >
          {item.kind === 'engagement' ? (
            <>
              <b className={styles.engageIcon}>{item.icon ?? '♥'}</b>
              <span className={styles.engageText}>{item.text}</span>
            </>
          ) : item.card ? (
            <>
              <span className={styles.suggestKicker}>POPLUR AI · {item.card.title}</span>
              <span className={styles.suggestHeadline}>{item.card.headline}</span>
              {item.card.rows && item.card.rows.length > 0 && (
                <span className={styles.suggestRows}>
                  {item.card.rows.slice(0, 2).map(row => (
                    <span className={styles.suggestRow} key={row.label + row.value}>
                      <span>{row.label}</span><b>{row.value}</b>
                    </span>
                  ))}
                </span>
              )}
              {item.card.link && (
                <button
                  type="button"
                  className={styles.suggestLink}
                  onClick={e => {
                    e.stopPropagation()
                    const url = item.card!.link!.url
                    // Let the shell route it natively where it can; window.open
                    // covers the browser and any shell honouring target=_blank.
                    // Same pair both previous call sites used.
                    postNativeEvent({ type: 'openExternal', url })
                    try { window.open(url, '_blank', 'noopener') } catch { /* shell routes it */ }
                    dismissPopup(item.id)
                  }}
                >
                  {item.card.link.label}
                </button>
              )}
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}
