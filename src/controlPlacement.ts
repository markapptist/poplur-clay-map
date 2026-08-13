import { useSyncExternalStore } from 'react'

export type ControlSide = 'left' | 'right'

const STORAGE_KEY = 'poplur.controlSide'
const EVENT_NAME = 'poplur-control-side-change'

export function readControlSide(): ControlSide {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'right' ? 'right' : 'left'
  } catch {
    return 'left'
  }
}

export function setControlSide(side: ControlSide): ControlSide {
  try { window.localStorage.setItem(STORAGE_KEY, side) } catch { /* private storage */ }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: side }))
  return side
}

export function onControlSideChange(listener: () => void): () => void {
  window.addEventListener(EVENT_NAME, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT_NAME, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useControlSide(): ControlSide {
  return useSyncExternalStore(onControlSideChange, readControlSide, () => 'left')
}
