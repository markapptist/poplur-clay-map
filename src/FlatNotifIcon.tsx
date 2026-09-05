import { useState } from 'react'
import { runtimeSideIconSources, type SideControlIconId } from './sideControlIcons'

// The flat 2D icon on a notification row, from the SUPPLIED Poplur UI art pack
// (src/side-control-icons/manifest.json → public/poplur-side-buttons, 256/512).
//
// These rows used to draw extruded three.js clay meshes (ClayNotifIcon), and
// briefly drew nothing at all while pointing at a notif-icons folder that was
// never supplied. Nothing here is drawn or invented: every kind resolves to an
// icon the art pack already ships, which is also why the map below is short —
// the pack has a heart, a bubble, a mailbox, chevrons, a shield and a
// newspaper, so those are what the rows wear.
//
// The one kind with no dedicated mark in the pack is `view`. It takes the
// pack's SELECT check, the same "seen" mark the app uses for a read
// conversation — a view is a post that has been seen. Swap this one line the
// day an eye is supplied; nothing else changes.

export type NotifKind =
  | 'growth' | 'decrease' | 'pop' | 'trend' | 'message'
  | 'like' | 'view' | 'comment'

export const NOTIF_ICON_ID: Record<NotifKind, SideControlIconId> = {
  like: 'feed.like',
  comment: 'feed.comment',
  message: 'feed.dm',
  view: 'profile.select',
  growth: 'global.channel_up',
  decrease: 'global.channel_down',
  pop: 'map.conquer',
  trend: 'map.news',
}

/** Any string a native row or banner may carry, narrowed to a kind we have an
 *  icon for. Unknown kinds share the daily-report mark, as the row model does. */
export function notifIconKind(value: string): NotifKind {
  switch (value) {
    case 'like': case 'view': case 'comment': case 'growth': case 'decrease':
    case 'pop': case 'trend': case 'message':
      return value
    case 'dm': return 'message'
    case 'radiusGrowth': return 'growth'
    case 'radiusDip': return 'decrease'
    case 'areaTakeover': case 'radiusEntry': return 'pop'
    case 'mention': return 'comment'
    default: return 'trend'
  }
}

export function notifIconSources(kind: NotifKind) {
  return runtimeSideIconSources(NOTIF_ICON_ID[kind])
}

export default function FlatNotifIcon({ kind, size = 30 }: { kind: string; size?: number }) {
  const resolved = notifIconKind(kind)
  const [missing, setMissing] = useState(false)
  const sources = notifIconSources(resolved)
  // A pack file that cannot load keeps the slot's footprint so rows stay
  // aligned, and draws nothing in it. Never a stand-in shape.
  if (missing) return <span style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />
  return (
    <img
      src={sources.src}
      srcSet={sources.srcSet}
      sizes={`${size}px`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', pointerEvents: 'none' }}
      onError={() => setMissing(true)}
      aria-hidden="true"
    />
  )
}
