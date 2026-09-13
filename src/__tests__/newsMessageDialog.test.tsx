// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import NewsMessageComposer from '../NewsMessageComposer'
import { setPendingMapPost } from '../cameraStore'

vi.mock('../cameraStore', () => ({ setPendingMapPost: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, mount: HTMLDivElement, opener: HTMLButtonElement
let close: ReturnType<typeof vi.fn>
beforeEach(() => {
  opener = document.createElement('button'); document.body.append(opener); opener.focus()
  mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
  close = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillText() {}, fillRect() {} } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,message')
})
afterEach(() => {
  act(() => root.unmount())
  mount.remove(); opener.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks()
})
const render = () => act(() => root.render(<NewsMessageComposer channelId="food" onClose={close} />))
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!

it('keeps keyboard focus in the dialog, preserves typing focus, and restores its opener', () => {
  render()
  expect(document.activeElement).toBe(dialog())
  const message = dialog().querySelector('textarea')!
  message.focus()
  act(() => Simulate.change(message, { target: { value: 'Hello #Toronto' } } as any))
  expect(message.value).toBe('Hello #Toronto')
  expect(document.activeElement).toBe(message)
  const controls = [...dialog().querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  controls[controls.length - 1].focus()
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(controls[0])
  act(() => controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledOnce()
  act(() => root.render(null))
  expect(document.activeElement).toBe(opener)
})

it('hands the message to map review and does not publish from the dialog', () => {
  const pickSpot = vi.fn()
  window.addEventListener('poplur-pick-spot', pickSpot)
  render()
  const next = [...dialog().querySelectorAll('button')].find(button => button.textContent?.includes('Choose spot'))!
  expect(next.disabled).toBe(true)
  act(() => Simulate.change(dialog().querySelector('textarea')!, { target: { value: 'Hello #Toronto' } } as any))
  act(() => next.click())
  expect(setPendingMapPost).toHaveBeenCalledWith(expect.objectContaining({ caption: 'Hello #Toronto', channelId: 'food', newsMessage: true, rightsAttested: false }))
  expect(pickSpot).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  window.removeEventListener('poplur-pick-spot', pickSpot)
})

it('fits the visual viewport as the software keyboard opens', () => {
  const viewport = Object.assign(new EventTarget(), { height: 852, offsetTop: 0 })
  vi.stubGlobal('visualViewport', viewport)
  render()
  const overlay = dialog().parentElement!
  expect(overlay.style.getPropertyValue('--news-compose-height')).toBe('852px')
  viewport.height = 380; viewport.offsetTop = 24
  act(() => viewport.dispatchEvent(new Event('resize')))
  expect(overlay.style.getPropertyValue('--news-compose-height')).toBe('380px')
  expect(overlay.style.getPropertyValue('--news-compose-top')).toBe('24px')
})
