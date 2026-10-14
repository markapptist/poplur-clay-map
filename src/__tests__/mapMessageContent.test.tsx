// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PopupHost, { clearPopups, showPopup } from '../popups'

vi.mock('../pop', () => ({ playPop: vi.fn(), playPopAmbient: vi.fn() }))
vi.mock('../CommerceSuggestionWindow', () => ({ default: () => null }))
vi.mock('../BoundedPopupVideo', () => ({ default: ({ src }: { src: string }) => <video src={src} /> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
afterEach(() => { act(() => { clearPopups(); root?.unmount() }); document.body.innerHTML = '' })

function openMessage(messageCard: boolean, media?: { kind: 'image' | 'video'; src: string; alt: string }) {
  const mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
  const caption = 'Hello 👋\n\nMeet me by the library.\n' + 'Read every word here. '.repeat(20)
  act(() => {
    root.render(<PopupHost />)
    showPopup({ kind: 'mapContent', content: { id: 'message', name: 'Library', user: '@writer', caption, contentType: 'message', messageCard, media, radiusKm: 2 } })
  })
  return caption
}

describe('opening a Pop Message on the map', () => {
  it('shows every word as selectable text instead of stretching the share image', () => {
    const caption = openMessage(true, { kind: 'image', src: 'https://example.com/share-card.jpg', alt: '@writer post' })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('[data-clay-scroll] p')?.textContent).toBe(caption)
    expect(dialog.querySelector('h2')?.textContent).toBe('@writer')
    expect(dialog.querySelector('img')).toBeNull()
    expect(dialog.textContent).not.toContain('@writer post')
  })
  it('keeps a real attachment alongside its full message', () => {
    const caption = openMessage(false, { kind: 'image', src: 'https://example.com/photo.jpg', alt: 'Photo' })
    expect(document.querySelector('[data-clay-scroll] p')?.textContent).toBe(caption)
    expect(document.querySelector('img')?.src).toBe('https://example.com/photo.jpg')
  })
  it('also opens legacy text without an image', () => {
    const caption = openMessage(false)
    expect(document.querySelector('[data-clay-scroll] p')?.textContent).toBe(caption)
  })
})
