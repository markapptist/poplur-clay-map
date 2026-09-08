import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The parent document outlives a replaced map iframe. Own its portal node
 * explicitly: removing an iframe does not run that iframe's React cleanup. */
export function mountShellOverlay(owner: Window = window) {
  let target = owner.document
  let frame: Element | null = null
  try {
    target = owner.parent.document
    frame = owner.frameElement ?? Array.from(target.querySelectorAll('iframe'))
      .find(candidate => candidate.contentWindow === owner) ?? null
  } catch { /* standalone/cross-origin */ }
  const host = target.createElement('div')
  host.dataset.poplurShellOverlay = ''
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483002', pointerEvents: 'none' })
  target.body.appendChild(host)
  let observer: MutationObserver | undefined
  const dispose = () => {
    observer?.disconnect()
    owner.removeEventListener('pagehide', dispose)
    host.remove()
  }
  owner.addEventListener('pagehide', dispose)
  if (frame && target.defaultView) {
    // Construct in the parent realm, so it survives the child being removed.
    observer = new target.defaultView.MutationObserver(() => {
      if (!frame?.isConnected) dispose()
    })
    observer.observe(target.body, { childList: true, subtree: true })
  }
  return { host, dispose }
}

/** Escape the map iframe so its dialogs sit above the owning home's controls. */
export default function ShellOverlayPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const overlay = mountShellOverlay()
    setHost(overlay.host)
    return overlay.dispose
  }, [])
  return host ? createPortal(children, host) : null
}
