// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FeedAuthor from '../FeedAuthor'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('keeps username and caption visible together, and opens the current author', () => {
  const onOpen = vi.fn()
  act(() => root.render(createElement(FeedAuthor, { username: '@mark', caption: 'Food post', verified: 'personal', onOpen })))
  const button = host.querySelector('button')!
  expect(button.textContent).toContain('@mark')
  expect(button.textContent).toContain('Food post')
  expect(button.querySelector('[alt="Verified"]')).not.toBeNull()
  act(() => button.click())
  expect(onOpen).toHaveBeenCalledTimes(1)
  act(() => root.render(createElement(FeedAuthor, { username: '@next', caption: 'Next post', verified: null, onOpen })))
  expect(button.textContent).not.toContain('@mark')
  expect(button.querySelector('[alt="Verified"]')).toBeNull()
  expect(button.getAttribute('aria-label')).toContain("Open @next's profile")
})

it('uses initials when an avatar cannot load and recovers for the next author', () => {
  act(() => root.render(createElement(FeedAuthor, { username: '@mark', caption: '', avatarURL: 'https://example.com/broken.jpg', verified: null })))
  act(() => host.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(host.querySelector('img')).toBeNull()
  expect(host.textContent).toContain('MA')
  act(() => root.render(createElement(FeedAuthor, { username: '@next', caption: '', avatarURL: 'https://example.com/next.jpg', verified: null })))
  expect(host.querySelector('img')?.getAttribute('src')).toContain('next.jpg')
  expect(host.querySelector('button')).toBeNull()
})
