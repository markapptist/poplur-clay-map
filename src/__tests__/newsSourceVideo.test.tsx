// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import NewsSourceVideo from '../NewsSourceVideo'
import { poplurResourcePool } from '../resourcePool'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('loads a single official player only on tap and releases it when covered, offscreen or backgrounded', () => {
  ;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true
  let intersect: (entries: unknown[]) => void = () => {}
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe() {} disconnect() {}
  })
  const host = document.createElement('div'), root = createRoot(host)
  document.body.append(host)
  const render = (active = true) => act(() => root.render(<NewsSourceVideo embedUrl="https://embed.bsky.app/embed/did:plc:abc/app.bsky.feed.post/xyz" sourceUrl="https://bsky.app/profile/did:plc:abc/post/xyz" active={active} />))
  const play = () => act(() => (host.querySelector('[aria-label="Play source video"]') as HTMLButtonElement).click())
  const parkOther = vi.fn()
  const previous = poplurResourcePool.acquire('media-decoder','local-video',{priority:110,onRevoke:parkOther})
  render()
  expect(host.querySelector('iframe')).toBeNull()
  play()
  expect(parkOther).toHaveBeenCalledOnce()
  expect(poplurResourcePool.acquire('media-decoder','other',{priority:110})).toBeNull()
  expect(host.querySelector('iframe')).not.toBeNull()
  act(() => intersect([{ isIntersecting:false }]))
  expect(host.querySelector('iframe')).toBeNull()
  play()
  act(() => window.dispatchEvent(new CustomEvent('poplur-news-video-play',{detail:'other'})))
  expect(host.querySelector('iframe')).toBeNull()
  play()
  render(false)
  expect(host.querySelector('iframe')).toBeNull()
  render()
  play()
  act(() => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle',{detail:{active:false}})))
  expect(host.querySelector('iframe')).toBeNull()
  act(() => root.unmount())
  host.remove()
  previous?.release()
  poplurResourcePool.releaseAll()
  vi.unstubAllGlobals()
})
