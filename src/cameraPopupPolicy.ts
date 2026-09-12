import { useSyncExternalStore } from 'react'
const EVENT = 'poplur-camera-popup-policy'
type PolicyWindow = Window & { __poplurCameraPopupsSuppressed?: boolean }
function owner(): PolicyWindow | undefined {
  if (typeof window === 'undefined') return undefined
  try { void window.parent.document; return window.parent as PolicyWindow } catch { return window as PolicyWindow }
}
export function cameraPopupsSuppressed(): boolean { return owner()?.__poplurCameraPopupsSuppressed === true }
export function setCameraPopupsSuppressed(value: boolean) {
  const target = owner()
  if (!target || target.__poplurCameraPopupsSuppressed === value) return
  target.__poplurCameraPopupsSuppressed = value
  target.document.documentElement.toggleAttribute('data-camera-no-popups', value)
  target.dispatchEvent(new Event(EVENT))
}
function subscribe(listener: () => void) {
  const target = owner()
  target?.addEventListener(EVENT, listener)
  return () => target?.removeEventListener(EVENT, listener)
}
export function useCameraPopupsSuppressed() { return useSyncExternalStore(subscribe, cameraPopupsSuppressed, () => false) }
