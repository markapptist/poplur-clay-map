import { useCallback, useEffect, useRef, type RefObject } from 'react'

type Bounds = { top: number; bottom: number }
type RadiusEntry = { id: string; radiusKm: number }

/** Timeline rows are in vertical order. Prefer the row crossing the middle
 * of the viewport, including a tall post whose own midpoint is offscreen. */
export function centeredTimelineRow<T>(rows: readonly T[], bounds: (row: T) => Bounds, viewport: Bounds): T | null {
  if (viewport.bottom <= viewport.top) return null
  const center = (viewport.top + viewport.bottom) / 2
  let low = 0, high = rows.length - 1
  while (low <= high) {
    const index = (low + high) >>> 1
    const rect = bounds(rows[index])
    if (rect.bottom <= center) low = index + 1
    else if (rect.top > center) high = index - 1
    else return rows[index]
  }
  // The middle can fall in the gap between posts. Use the nearest visible
  // neighbour, never an offscreen post above a masthead or below an empty list.
  let nearest: T | null = null, distance = Infinity
  for (const index of [high, low]) {
    if (index < 0 || index >= rows.length) continue
    const rect = bounds(rows[index])
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom || rect.bottom <= rect.top) continue
    const delta = Math.min(Math.abs(rect.top - center), Math.abs(rect.bottom - center))
    if (delta < distance) { nearest = rows[index]; distance = delta }
  }
  return nearest
}

/** The open story owns the radius until it closes. Otherwise only scroll or
 * layout events measure the timeline; there is no background polling loop. */
export function useNewsRadiusFocus(
  scrollRef: RefObject<HTMLElement>,
  entries: readonly RadiusEntry[],
  opened: RadiusEntry | null,
  covered = false,
) {
  const lastReported = useRef<string | null>(null)
  const report = useCallback((entry: RadiusEntry | null) => {
    const radiusKm = entry && Number.isFinite(entry.radiusKm) && entry.radiusKm >= 0 ? entry.radiusKm : null
    const entryId = radiusKm === null ? null : entry!.id
    const key = JSON.stringify([entryId, radiusKm])
    if (lastReported.current === key) return
    lastReported.current = key
    window.dispatchEvent(new CustomEvent('poplur-news-active-entry', { detail: { entryId, radiusKm } }))
  }, [])

  useEffect(() => {
    if (covered) return
    if (opened) { report(opened); return }
    const host = scrollRef.current
    if (!host) return
    const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-news-entry-id]'))
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    let frame: number | null = null
    const measure = () => {
      frame = null
      if (document.hidden) return
      const rect = host.getBoundingClientRect()
      const visual = window.visualViewport
      const top = visual?.offsetTop ?? 0
      const bottom = top + (visual?.height ?? window.innerHeight)
      const row = centeredTimelineRow(rows, node => node.getBoundingClientRect(), {
        top: Math.max(rect.top, top), bottom: Math.min(rect.bottom, bottom),
      })
      report(row ? byId.get(row.dataset.newsEntryId ?? '') ?? null : null)
    }
    const schedule = () => {
      if (frame !== null || document.hidden) return
      // governor-ok: one coalesced layout read per scroll/resize event; never re-arms itself at idle.
      frame = window.requestAnimationFrame(measure)
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(host)
    rows.forEach(row => resize?.observe(row))
    host.addEventListener('scroll', schedule, { passive: true })
    host.addEventListener('load', schedule, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    document.addEventListener('visibilitychange', schedule)
    schedule()
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      resize?.disconnect()
      host.removeEventListener('scroll', schedule)
      host.removeEventListener('load', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [scrollRef, entries, opened, covered, report])

  useEffect(() => () => {
    lastReported.current = null
    window.dispatchEvent(new CustomEvent('poplur-news-active-entry', { detail: { entryId: null, radiusKm: null } }))
  }, [])
}
