import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Escape the map iframe so its dialogs sit above the owning home's controls. */
export default function ShellOverlayPortal({ children }: { children: ReactNode }) {
  let target = document.body
  try { target = window.parent.document.body ?? target } catch { /* standalone/cross-origin */ }
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 2147483002, pointerEvents: 'none' }}>{children}</div>, target)
}
