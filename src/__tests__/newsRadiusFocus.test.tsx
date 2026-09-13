// @vitest-environment happy-dom
import React, { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { centeredTimelineRow, useNewsRadiusFocus } from '../useNewsRadiusFocus'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
type Row = { id: string; radiusKm: number; top: number; bottom: number }
const viewport = { top: 0, bottom: 1000 }

describe('the Pop at the middle of the timeline', () => {
  it('chooses a tall post crossing the center rather than a shorter neighbouring post', () => {
    const rows = [{ top: -700, bottom: 650 }, { top: 670, bottom: 1000 }]
    expect(centeredTimelineRow(rows, row => row, viewport)).toBe(rows[0])
  })

  it('uses the closest visible post in a gap and never selects an offscreen row', () => {
    const rows = [{ top: 0, bottom: 400 }, { top: 650, bottom: 950 }]
    expect(centeredTimelineRow(rows, row => row, viewport)).toBe(rows[0])
    expect(centeredTimelineRow([{ top: -200, bottom: -10 }, { top: 1010, bottom: 1200 }], row => row, viewport)).toBeNull()
    expect(centeredTimelineRow([], row => row, viewport)).toBeNull()
    expect(centeredTimelineRow(rows, row => row, { top: 500, bottom: 500 })).toBeNull()
  })

  it('only measures a small number of rows in a long timeline', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({ top: index * 400 - 200_000, bottom: (index + 1) * 400 - 200_000 }))
    const measure = vi.fn(row => row)
    expect(centeredTimelineRow(rows, measure, viewport)).toBe(rows[501])
    expect(measure.mock.calls.length).toBeLessThan(15)
  })
})

describe('News radius reporting', () => {
  let mount: HTMLDivElement, root: Root, scroll: HTMLElement
  let rows: Row[], offset: number, nextFrame: number
  let frames: Map<number, FrameRequestCallback>
  let resizes: Set<() => void>
  let reports: Array<{ entryId: string | null; radiusKm: number | null }>
  const receive = (event: Event) => reports.push((event as CustomEvent).detail)

  function Harness({ entries, opened = null, covered = false }: { entries: Row[]; opened?: Row | null; covered?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useNewsRadiusFocus(ref, entries, opened, covered)
    return <div ref={ref} data-timeline-host>{entries.map(entry => <article key={entry.id} data-news-entry-id={entry.id} />)}</div>
  }
  function render(opened: Row | null = null, covered = false) {
    act(() => root.render(<Harness entries={rows} opened={opened} covered={covered} />))
    scroll = mount.querySelector('[data-timeline-host]')!
  }
  function flushFrame() {
    act(() => {
      const work = [...frames.values()]
      frames.clear()
      work.forEach(callback => callback(100))
    })
  }
  function scrollTo(value: number) {
    offset = value
    act(() => scroll.dispatchEvent(new Event('scroll')))
  }

  beforeEach(() => {
    rows = [
      { id: 'a', radiusKm: 5, top: 0, bottom: 300 },
      { id: 'b', radiusKm: 20, top: 300, bottom: 800 },
      { id: 'c', radiusKm: 70, top: 800, bottom: 1300 },
    ]
    offset = 0; nextFrame = 0; frames = new Map(); resizes = new Set(); reports = []
    vi.stubGlobal('innerHeight', 1000)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) { resizes.add(callback) }
      observe() {}
      disconnect() { resizes.delete(this.callback) }
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const row = rows.find(row => row.id === this.dataset.newsEntryId)
      const top = row ? row.top - offset : 0
      const bottom = row ? row.bottom - offset : 1000
      return { top, bottom, height: bottom - top, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} }
    })
    mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
    window.addEventListener('poplur-news-active-entry', receive)
  })
  afterEach(() => {
    act(() => root.unmount())
    mount.remove()
    window.removeEventListener('poplur-news-active-entry', receive)
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  })

  it('follows scrolling, batches scroll events, and does no work while idle', () => {
    render(); flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: 'b', radiusKm: 20 })
    scrollTo(400); scrollTo(420); scrollTo(430)
    expect(frames.size).toBe(1)
    flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: 'c', radiusKm: 70 })
    expect(frames.size).toBe(0)
    scrollTo(450); flushFrame()
    expect(reports).toHaveLength(2)
  })

  it('lets a directly opened Pop own the radius until returning to the current scroll position', () => {
    render(); flushFrame()
    render(rows[0])
    expect(reports[reports.length - 1]).toEqual({ entryId: 'a', radiusKm: 5 })
    scrollTo(500); flushFrame()
    expect(reports).toHaveLength(2)
    render(); flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: 'c', radiusKm: 70 })
  })

  it('re-evaluates after media resizing, filtering, and a live radius update', () => {
    render(); flushFrame()
    rows[0].bottom = 900; rows[1].top = 900; rows[1].bottom = 1100; rows[2].top = 1100
    act(() => resizes.forEach(callback => callback()))
    flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: 'a', radiusKm: 5 })
    rows = rows.map(row => row.id === 'a' ? { ...row, radiusKm: 12 } : row)
    render(); flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: 'a', radiusKm: 12 })
    rows = []; render(); flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: null, radiusKm: null })
  })

  it('reports zero radius and updates the open Pop when its reach changes', () => {
    render({ ...rows[0], radiusKm: 0 })
    expect(reports[reports.length - 1]).toEqual({ entryId: 'a', radiusKm: 0 })
    render({ ...rows[0], radiusKm: 35 })
    expect(reports[reports.length - 1]).toEqual({ entryId: 'a', radiusKm: 35 })
    expect(frames.size).toBe(0)
  })

  it('parks tracking under the drawer/composer and cancels pending work on unmount', () => {
    render(); flushFrame()
    render(null, true); scrollTo(500); flushFrame()
    expect(reports).toHaveLength(1)
    render(); flushFrame()
    expect(reports[reports.length - 1]).toEqual({ entryId: 'c', radiusKm: 70 })
    scrollTo(0)
    act(() => root.render(null))
    expect(frames.size).toBe(0)
    expect(resizes.size).toBe(0)
    expect(reports[reports.length - 1]).toEqual({ entryId: null, radiusKm: null })
    act(() => scroll.dispatchEvent(new Event('scroll')))
    expect(frames.size).toBe(0)
  })
})
