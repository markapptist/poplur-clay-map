// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CameraRollScreen from '../CameraRollScreen'
import { addCapture, isSelected, listCaptures, removeCaptures, selectedCount, takePendingRollPost } from '../cameraStore'

vi.mock('../pop', () => ({ playPop: vi.fn(), primePopAudio: vi.fn() }))

let root: ReturnType<typeof createRoot>, host: HTMLDivElement
const render = () => act(() => root.render(<CameraRollScreen />))
const btn = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const tiles = () => Array.from(host.querySelectorAll<HTMLElement>('figure'))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  removeCaptures(listCaptures().map(c => c.id))
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('starts out of manage mode, so a tap still composes', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  render()
  expect(btn('Select captures')).not.toBeNull()
  expect(btn('Select all')).toBeNull()
  expect(btn('Delete 0 selected')).toBeNull()
})

it('selects a capture by tapping it in manage mode', () => {
  const a = addCapture({ kind: 'photo', src: 'data:,a' })
  render()
  act(() => { btn('Select captures')!.click() })
  const tile = tiles().find(t => t.getAttribute('aria-pressed') !== null)
  expect(tile).toBeDefined()
  act(() => { tile!.click() })
  expect(isSelected(a.id)).toBe(true)
  expect(host.textContent).toContain('1 selected')
})

it('selects all and then clears', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  addCapture({ kind: 'photo', src: 'data:,b' })
  addCapture({ kind: 'video', src: 'data:,c', length: '0:03' })
  render()
  act(() => { btn('Select captures')!.click() })
  act(() => { btn('Select all')!.click() })
  expect(selectedCount()).toBe(3)
  act(() => { btn('Deselect all')!.click() })
  expect(selectedCount()).toBe(0)
})

it('deletes only the selected captures, behind a confirmation', () => {
  const a = addCapture({ kind: 'photo', src: 'data:,a' })
  const b = addCapture({ kind: 'photo', src: 'data:,b' })
  render()
  act(() => { btn('Select captures')!.click() })
  const tile = tiles().find(t => t.getAttribute('aria-pressed') !== null)
  act(() => { tile!.click() })          // newest-first, so this is `b`
  act(() => { btn('Delete 1 selected')!.click() })
  // A prompt, not an immediate delete — the captures are saved nowhere else.
  expect(listCaptures()).toHaveLength(2)
  // The dialog appends an arrow to the primary label, so match the stem.
  const confirm = Array.from(document.querySelectorAll('button')).find(x => x.textContent?.startsWith('Delete'))
  expect(confirm).toBeDefined()
  act(() => { confirm!.click() })
  expect(listCaptures().map(c => c.id)).toEqual([a.id])
  expect(isSelected(b.id)).toBe(false)
})

it('keeps everything when the prompt is declined', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  render()
  act(() => { btn('Select captures')!.click() })
  act(() => { btn('Select all')!.click() })
  act(() => { btn('Delete 1 selected')!.click() })
  const keep = Array.from(document.querySelectorAll('button')).find(x => x.textContent?.startsWith('Keep'))
  act(() => { keep!.click() })
  expect(listCaptures()).toHaveLength(1)
})

// The device library is refilled one-way by the shell and has no delete
// message in the bridge, so a local removal would be undone by the next
// requestCameraRoll. Those tiles must not look selectable.
it('says why the device library is not part of the selection', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  render()
  act(() => { btn('Select captures')!.click() })
  expect(host.textContent).toContain('Your Poplur captures only')
})

// ── Preview (ask C): opening a capture, mirroring the profile post viewer ──

it('opens a capture into a preview when tapped', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  render()
  const tile = tiles()[0]
  act(() => { tile.click() })
  expect(host.querySelector('[aria-label="Capture preview"]')).not.toBeNull()
})

it('parks the capture for the camera when POST is pressed, and leaves', () => {
  addCapture({ kind: 'photo', src: 'data:,post-me' })
  const closed = vi.fn()
  act(() => root.render(<CameraRollScreen onClosePage={closed} />))
  act(() => { tiles()[0].click() })
  const post = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Post this')
  expect(post).toBeDefined()
  act(() => { post!.click() })
  expect(closed).toHaveBeenCalled()
  // The page cannot reach Camera's composer state, so it parks the media.
  expect(takePendingRollPost()).toEqual({ kind: 'photo', src: 'data:,post-me', length: undefined })
})

it('deletes just the previewed capture, behind the prompt', () => {
  const a = addCapture({ kind: 'photo', src: 'data:,keep' })
  addCapture({ kind: 'photo', src: 'data:,drop' })
  render()
  act(() => { tiles()[0].click() })     // newest-first, so 'drop'
  const del = host.querySelector<HTMLButtonElement>('button[aria-label="Delete this capture"]')
  act(() => { del!.click() })
  const confirm = Array.from(document.querySelectorAll('button')).find(x => x.textContent?.startsWith('Delete'))
  act(() => { confirm!.click() })
  expect(listCaptures().map(c => c.id)).toEqual([a.id])
  // Deleting what you were looking at has to close the preview too.
  expect(host.querySelector('[aria-label="Capture preview"]')).toBeNull()
})

// "im not able to get to the camera roll screen from the arrows in camera tab".
// The page's own claim on the arrows has to be inert until a capture is open,
// or it would swallow the presses that walk the camera's ring onto and off the
// roll — which is the navigation that was missing in the first place.
it('leaves the channel arrows alone until a capture is open', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  let arrows: ((dir: 1 | -1) => boolean) | null = null
  act(() => root.render(<CameraRollScreen bindArrows={fn => { arrows = fn }} />))
  expect(arrows).toBeTypeOf('function')
  expect(arrows!(1)).toBe(false)
  expect(arrows!(-1)).toBe(false)
})

// Opening a capture is opening a post in the profile, so the arrows browse the
// library the same way: one per press, and wrapping rather than stopping dead
// at the ends (the preview holds the seeded roll as well as this session's
// captures, so the walk is over everything the page is showing).
it('walks the open preview with the arrows, wrapping at both ends', () => {
  addCapture({ kind: 'photo', src: 'data:,a' })
  addCapture({ kind: 'photo', src: 'data:,b' })
  let arrows: ((dir: 1 | -1) => boolean) | null = null
  act(() => root.render(<CameraRollScreen bindArrows={fn => { arrows = fn }} />))
  act(() => { tiles()[0]!.click() })
  const preview = () => host.querySelector('[aria-label="Capture preview"]')
  const shown = () => preview()?.querySelector('img, video')?.getAttribute('src') ?? null
  const first = shown()
  expect(first).toBeTruthy()
  act(() => { expect(arrows!(1)).toBe(true) })
  const second = shown()
  expect(second).not.toBe(first)
  act(() => { expect(arrows!(-1)).toBe(true) })
  expect(shown()).toBe(first)
  // Off the front of the list: the walk wraps to the end, it does not close.
  act(() => { expect(arrows!(-1)).toBe(true) })
  expect(preview()).not.toBeNull()
  expect(shown()).not.toBe(first)
})

// Unmounting has to release the claim, or Home keeps calling into a page that
// is no longer on screen and the camera's ring stops answering its arrows.
it('releases the arrows when the page goes away', () => {
  let arrows: ((dir: 1 | -1) => boolean) | null | undefined
  act(() => root.render(<CameraRollScreen bindArrows={fn => { arrows = fn }} />))
  expect(arrows).toBeTypeOf('function')
  act(() => root.render(<></>))
  expect(arrows).toBeNull()
})
