import { useCameraPopupsSuppressed } from './cameraPopupPolicy'
import { useEffect, useRef, useState } from 'react'
import surfaceStyles from './TransientPopupSurface.module.css'
import styles from './ScreenCoach.module.css'

// The first-open coaching card, the way a camera app teaches its gestures.
//
// Poplur's controls are gestures on a live surface — tap a side, hold a spot,
// turn the cube — so there is nowhere to hang a label. This draws the gesture
// ON the screen the first time you arrive, then gets out of the way: fifteen
// seconds, or the moment you touch anything.
//
// Shown ONCE per screen, remembered per device. It is a teaching aid, not a
// nag: `poplur.coach.seen.v1` is the only thing standing between a returning
// user and their app, and clearing that key replays every lesson.
const SEEN_KEY = 'poplur.coach.seen.v1'
const SHOW_MS = 15_000

function seen(): Record<string, boolean> {
  try { return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}') || {} } catch { return {} }
}

function markSeen(id: string) {
  try {
    const all = seen()
    all[id] = true
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(all))
  } catch { /* private mode — it will teach again next launch */ }
}

/** Replays every lesson. Wired to nothing yet; here so "show me that again"
    is a one-line change rather than a spelunk through localStorage. */
export function resetScreenCoaching() {
  try { window.localStorage.removeItem(SEEN_KEY) } catch { /* nothing to clear */ }
}

export interface CoachProps {
  /** Stable per screen — this is what "already taught" is remembered against. */
  id: string
  /** Headline: what this screen IS, in a few words. */
  title: string
  /** One line per gesture. Keep them imperative: "Tap", "Hold", "Turn". */
  lines: string[]
  /** Draws the map's half-and-half split with its tap targets called out. */
  split?: boolean
  /** Blue arrows flanking the focused pop's pin. */
  pinArrows?: boolean
}

export default function ScreenCoach({ id, title, lines, split, pinArrows }: CoachProps) {
  const suppressed = useCameraPopupsSuppressed()
  const [open, setOpen] = useState(() => !seen()[id])
  const timer = useRef(0)

  useEffect(() => {
    if (!open) return
    markSeen(id)
    timer.current = window.setTimeout(() => setOpen(false), SHOW_MS)
    // ANY touch dismisses it. The card is teaching a gesture, so the moment
    // someone makes one it has done its job and must not sit in the way of the
    // thing it just described.
    const dismiss = () => setOpen(false)
    window.addEventListener('pointerdown', dismiss, { once: true, capture: true })
    // The MAP is an iframe. A tap there never reaches this document — the
    // iframe's own document consumes it — so a pointerdown listener alone left
    // the map's card up forever, which is the one screen whose card most needs
    // to get out of the way. The embed reports its first touch instead.
    const touched = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'poplur-map-touched') dismiss()
    }
    window.addEventListener('message', touched)
    return () => {
      window.clearTimeout(timer.current)
      window.removeEventListener('pointerdown', dismiss, { capture: true } as EventListenerOptions)
      window.removeEventListener('message', touched)
    }
  }, [open, id])

  if (!open || suppressed) return null

  return (
    <div className={styles.coach} data-coach={id} aria-live="polite">
      {/* The map's two edge lanes, drawn as the control they are. */}
      {split && (
        <div className={styles.split} aria-hidden="true">
          <div className={styles.half}>
            <span className={styles.halfArrow}>‹</span>
            <span className={styles.halfLabel}>TAP THIS EDGE<br /><b>PREVIOUS POP</b></span>
          </div>
          <div className={styles.seam} />
          <div className={styles.half}>
            <span className={styles.halfArrow}>›</span>
            <span className={styles.halfLabel}>TAP THIS EDGE<br /><b>NEXT POP</b></span>
          </div>
        </div>
      )}

      {/* Blue arrows around the focused pop's pin, which sits at the centre of
          the map view — the same two directions the halves describe, shown on
          the thing they move. */}
      {pinArrows && (
        <div className={styles.pinArrows} aria-hidden="true">
          <span className={styles.pinArrowLeft}>◀</span>
          <span className={styles.pinRing} />
          <span className={styles.pinArrowRight}>▶</span>
        </div>
      )}

      <div className={`${styles.card} ${surfaceStyles.surface}`}>
        <p className={styles.title}>{title}</p>
        <ul className={styles.lines}>
          {lines.map(line => <li key={line}>{line}</li>)}
        </ul>
        <p className={styles.dismiss}>TAP ANYWHERE TO START</p>
      </div>
    </div>
  )
}
