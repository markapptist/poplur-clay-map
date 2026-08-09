import { useEffect, useRef, useState } from 'react'
import { POP_LEVELS, type PopLevel } from './data'
import { playPop } from './pop'
import styles from './MapLevelButton.module.css'

// ── Whose pops the map is showing ───────────────────────────────────────────
// Three stacked map sheets, because that is literally what the control does:
// it puts one layer of the world on screen, or another, or both at once. The
// lit sheet IS the answer — mine is the near sheet, theirs the far one, ALL
// lights the stack.
//
// Tap cycles, hold picks. The cycle is right for the common move (a glance at
// what everyone else holds, then back), and it is one thumb tap away; the hold
// menu exists because cycling blind through three states to reach a known one
// is the thing that makes cycle-only controls annoying.

const HOLD_MS = 420

export default function MapLevelButton({
  level,
  onPick,
  // Fixed, never scaled off the cube — doing that made it a ~100px slab in the
  // corner of the map. 44 is the settled size: reads as three distinct sheets
  // at arm's length without crowding the channel arrows under it.
  size = 44,
  // Kept because callers pass the map's render tier, but the glyph is isometric
  // in BOTH modes now — see LayerGlyph. The flat variant read as a hamburger.
  mode = '3d',
}: {
  level: PopLevel
  onPick: (next: PopLevel) => void
  size?: number
  /** The map's render tier. No longer changes the glyph; see LayerGlyph. */
  mode?: '2d' | '3d'
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const heldRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const clearHold = () => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }
  useEffect(() => clearHold, [])

  // A tap anywhere else closes the picker — it is a menu, not a mode.
  useEffect(() => {
    if (!menuOpen) return
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    // Capture: the map and the cube both stop propagation on their own
    // pointerdowns, so a bubbling listener never heard the tap that should
    // have dismissed this.
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [menuOpen])

  const cycle = () => {
    const i = POP_LEVELS.findIndex(l => l.id === level)
    onPick(POP_LEVELS[(i + 1) % POP_LEVELS.length].id)
  }

  const current = POP_LEVELS.find(l => l.id === level) ?? POP_LEVELS[0]

  return (
    <div className={styles.root} ref={rootRef}>
      {menuOpen && (
        <div className={styles.menu} role="menu" aria-label="Which pops to show">
          {POP_LEVELS.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === level}
              className={option.id === level ? `${styles.item} ${styles.itemOn}` : styles.item}
              onClick={() => {
                playPop()
                onPick(option.id)
                setMenuOpen(false)
              }}
            >
              <LayerGlyph level={option.id} size={20} mode={mode} />
              <span className={styles.itemText}>
                <span className={styles.itemLabel}>{option.label}</span>
                <span className={styles.itemBlurb}>{option.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className={styles.button}
        aria-label={`Showing ${current.label}. Tap to change, hold to choose.`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onPointerDown={e => {
          if (!e.isPrimary) return
          heldRef.current = false
          clearHold()
          holdTimer.current = window.setTimeout(() => {
            holdTimer.current = null
            heldRef.current = true
            playPop()
            setMenuOpen(true)
          }, HOLD_MS)
        }}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={() => { clearHold(); heldRef.current = false }}
        onClick={() => {
          // The hold already acted; the release that follows it is not a tap.
          if (heldRef.current) { heldRef.current = false; return }
          if (menuOpen) { setMenuOpen(false); return }
          playPop()
          cycle()
        }}
      >
        <LayerGlyph level={level} size={size} mode={mode} />
      </button>
    </div>
  )
}

/**
 * Three map sheets stacked in isometric, each one an actual slab with a top
 * face and a visible edge rather than a flat diamond — the control should read
 * as three layers of world you can switch between, and depth is what says
 * "layers" instead of "diamonds".
 *
 * It sits on the live map with NO plate behind it, so legibility has to come
 * from the drawing: a dark outline carries it over pale terrain, the baked top
 * highlight carries it over dark terrain, and a drop shadow lifts it off both.
 *
 * Which sheets are LIT is the state:
 *   mine   — the near sheet only (the ground under your own feet)
 *   others — the far sheets, yours dark (everyone else's board)
 *   all    — the whole stack
 */
function LayerGlyph({ level, size, mode }: { level: PopLevel; size: number; mode: '2d' | '3d' }) {
  // Each level lights the sheet it MEANS, not a running count: yours is the
  // ground you stand on (near), everyone else's is the ground above it (top
  // and mid), and all is the whole stack. A count-up version read as a signal
  // meter and lost that mapping — restored at the user's request; the cycling
  // and the levels themselves are unchanged.
  const lit = (which: 'top' | 'mid' | 'near') => {
    if (level === 'all') return true
    if (level === 'mine') return which === 'near'
    return which !== 'near'
  }
  // Isometric slab: half-width 12, half-depth 6 (the 2:1 that reads as iso),
  // 3px of thickness. Spacing 6.5 leaves the stack slightly interleaved, which
  // is what makes it read as a stack rather than three floating tiles.
  const W = 12, H = 6, T = 3
  const slab = (cy: number, on: boolean, key: string) => (
    <g key={key} className={on ? styles.slabOn : styles.slabOff}>
      {/* the edge: the front two faces of the slab, drawn as one silhouette */}
      <path
        className={styles.slabEdge}
        d={`M${17 - W} ${cy} L17 ${cy + H} L${17 + W} ${cy} L${17 + W} ${cy + T} L17 ${cy + H + T} L${17 - W} ${cy + T} Z`}
      />
      {/* the top face */}
      <path
        className={styles.slabTop}
        d={`M17 ${cy - H} L${17 + W} ${cy} L17 ${cy + H} L${17 - W} ${cy} Z`}
      />
    </g>
  )
  return (
    <svg
      viewBox="0 0 34 34"
      width={size}
      height={size}
      aria-hidden="true"
      className={styles.glyph}
    >
      {/* back to front, so each sheet overlaps the one above it.

          ALWAYS the isometric slabs, in both map modes. There used to be a
          flat-plate variant for the 2D map, on the reasoning that a 3D object
          over a flat map reads as a leftover from another screen. In practice
          the flat version is three stacked bars, and three stacked bars are a
          hamburger menu no matter how they are spaced or stepped — the control
          stopped saying "layers of world" and started saying "open a menu".
          Restored to slabs at the user's request: the depth IS the meaning
          here, and it is worth more than matching the map's render tier.

          `mode` is kept on the props because callers pass it and it still
          drives nothing else; it simply no longer picks a different glyph. */}
      {slab(8, lit('top'), 'top')}
      {slab(15, lit('mid'), 'mid')}
      {slab(22, lit('near'), 'near')}
    </svg>
  )
}
