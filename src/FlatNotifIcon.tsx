import { useState } from 'react'

// Flat 2D notification icons, one supplied PNG per kind, from public/notif-icons.
//
// These replaced the extruded three.js clay icons (ClayNotifIcon). A row's
// icon is a supplied asset, not a rendered shape: the same rule the hold menu
// follows for its tiles (public/holdmenu/<Name>.png). When the file for a kind
// is not on disk the slot stays EMPTY — the icon is the user's art, and a drawn
// stand-in that looks about right is exactly the thing this project does not
// ship (see the note on invented art in no_generated_assets).
//
// Drop the files in and they take over with no code change:
//   public/notif-icons/like.png         liked your post
//   public/notif-icons/view.png         viewed your post
//   public/notif-icons/comment.png      commented / mentioned you
//   public/notif-icons/message.png      a DM
//   public/notif-icons/radius-up.png    radius grew
//   public/notif-icons/radius-down.png  radius shrank
//   public/notif-icons/pop.png          a pop took ground / entered your radius
//   public/notif-icons/trend.png        trending / daily insight
// 256px square, alpha outside the shape, same family as settings_ic_bell.

export type NotifKind =
  | 'growth' | 'decrease' | 'pop' | 'trend' | 'message'
  | 'like' | 'view' | 'comment'

export const NOTIF_ICON_FILE: Record<NotifKind, string> = {
  growth: 'radius-up',
  decrease: 'radius-down',
  pop: 'pop',
  trend: 'trend',
  message: 'message',
  like: 'like',
  view: 'view',
  comment: 'comment',
}

/** Any string a native row or banner may carry, narrowed to a kind we have a
 *  slot for. Unknown kinds share the trend icon, as the row model does. */
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

export function notifIconSrc(kind: NotifKind): string {
  return `notif-icons/${NOTIF_ICON_FILE[kind]}.png`
}

export default function FlatNotifIcon({ kind, size = 30 }: { kind: string; size?: number }) {
  const resolved = notifIconKind(kind)
  const [missing, setMissing] = useState(false)
  // The file is absent: keep the slot's footprint (rows stay aligned) and
  // draw nothing in it.
  if (missing) return <span style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />
  return (
    <img
      src={notifIconSrc(resolved)}
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
