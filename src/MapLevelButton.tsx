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
  // The control is made of the same world the map is: isometric slabs while
  // the map is a 3D diorama, flat plates the moment it drops to 2D. A 3D
  // object floating over a flat map reads as a leftover from another screen.
  mode = '3d',
}: {
  level: PopLevel
  onPick: (next: PopLevel) => void
  size?: number
  /** '2d' flattens the slabs to plates, matching the map's own render tier. */
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
  const lit = (which: 'top' | 'mid' | 'near') => {
    if (level === 'all') return true
    if (level === 'mine') return which === 'near'
    return which !== 'near'
  }
  // Isometric slab: half-width 12, half-depth 6 (the 2:1 that reads as iso),
  // 3px of thickness. Spacing 6.5 leaves the stack slightly interleaved, which
  // is what makes it read as a stack rather than three floating tiles.
  const W = 12, H = 6, T = 3
  // 2D mode: the same three sheets seen from straight above. Two things this
  // has to get right that the first cut did not.
  //
  // The plates must not TOUCH. Reusing the isometric 7px pitch for 8px plates
  // left one pixel of clearance, and with no extruded edge to separate them the
  // stack read as a single rounded block with two scratches across it — you
  // counted two sheets, not three. 6px plates on a 10px pitch leave real
  // background between them.
  //
  // And they must not read as a HAMBURGER, which three centred equal bars
  // unavoidably do — a three-bar glyph in the corner of a map is the universal
  // "open the menu" icon, and this control is not that. So each sheet steps
  // down-and-right off the one behind it, the way a stack of paper does. The
  // diagonal is what says "layers" once the depth is gone.
  const PW = 10.5, PH = 6, PITCH = 10, DX = 3
  const plate = (i: number, on: boolean, key: string) => (
    <g key={key} className={on ? styles.slabOn : styles.slabOff}>
      <rect
        className={`${styles.slabTop} ${styles.plate}`}
        x={17 + (i - 1) * DX - PW}
        y={7 + i * PITCH - PH / 2}
        width={PW * 2}
        height={PH}
        rx={2.5}
      />
    </g>
  )
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
      {/* back to front, so each sheet overlaps the one above it */}
      {mode === '2d' ? (
        <>
          {plate(0, lit('top'), 'top')}
          {plate(1, lit('mid'), 'mid')}
          {plate(2, lit('near'), 'near')}
        </>
      ) : (
        <>
          {slab(8, lit('top'), 'top')}
          {slab(15, lit('mid'), 'mid')}
          {slab(22, lit('near'), 'near')}
        </>
      )}
    </svg>
  )
}
