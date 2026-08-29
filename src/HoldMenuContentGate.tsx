import React, { type ReactNode } from 'react'

/**
 * Keeps HoldMenuTwin itself mounted so its selected page, wheel position, and
 * navigation handoffs survive a background/foreground round trip, while
 * removing every expensive descendant (including iframes, video, WebGL, and
 * native screen trees) from the document during the background interval.
 */
export default function HoldMenuContentGate({
  active,
  children,
}: {
  active: boolean
  children?: ReactNode
}) {
  if (active) return <>{children}</>
  return <div hidden aria-hidden="true" data-poplur-hold-menu-parked="true" />
}
