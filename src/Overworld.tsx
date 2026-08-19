/**
 * The walkable zone: what a player does between battles.
 *
 * The ground is drawn rather than tiled from the sheet. Slicing a presentation
 * sheet into a tile atlas is guesswork about cell bounds, and getting it wrong
 * shows as seams on every tile; the decorations — trees, shrubs, rocks,
 * flowers, buildings — are already cut as whole sprites and are what actually
 * carry the look, so they are placed on a painted ground instead.
 *
 * Encounters come from the spec's zone tables, so the creatures you meet here
 * are the ones the generated game says live here.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { GameSpec, ZoneSpec } from './battleRules'
import { sfxCursor, sfxEncounter } from './retroAudio'
import styles from './CreatureBattle.module.css'

const W = 384
const H = 344
const TILE = 32
/** Map is a little wider than the view, so the camera has somewhere to go. */
const COLS = 16
const ROWS = 14

type Dir = 'down' | 'up' | 'left' | 'right'

/** Which of the 15 protagonist frames belong to each facing. */
const WALK_FRAMES: Record<Dir, number[]> = {
  down:  [1, 2, 3],
  up:    [4, 5, 6],
  left:  [10, 11, 12],
  right: [10, 11, 12],     // mirrored when drawn
}

interface Decoration { art: string; col: number; row: number; w: number; h: number; solid: boolean }

/** A small hand-laid zone: a clearing ringed by trees, with grass to search. */
const DECOR: Decoration[] = [
  { art: 'trees_large', col: 0,  row: 0,  w: 3, h: 2, solid: true },
  { art: 'trees_large', col: 6,  row: 0,  w: 3, h: 2, solid: true },
  { art: 'trees_large', col: 12, row: 0,  w: 3, h: 2, solid: true },
  { art: 'trees_large', col: 0,  row: 11, w: 3, h: 2, solid: true },
  { art: 'trees_large', col: 13, row: 11, w: 3, h: 2, solid: true },
  { art: 'house_blue',  col: 2,  row: 2,  w: 3, h: 3, solid: true },
  { art: 'small_rocks', col: 11, row: 4,  w: 1, h: 1, solid: true },
  { art: 'flower_bed',  col: 8,  row: 8,  w: 1, h: 2, solid: false },
  { art: 'shrub_tiles', col: 5,  row: 6,  w: 2, h: 2, solid: false },
  { art: 'shrub_tiles', col: 9,  row: 6,  w: 2, h: 2, solid: false },
  { art: 'shrub_tiles', col: 7,  row: 9,  w: 2, h: 2, solid: false },
]

/** Standing here is what can start an encounter. */
const isTallGrass = (col: number, row: number) =>
  DECOR.some(d => !d.solid && col >= d.col && col < d.col + d.w && row >= d.row && row < d.row + d.h)

const isSolid = (col: number, row: number) => {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true
  return DECOR.some(d => d.solid && col >= d.col && col < d.col + d.w && row >= d.row && row < d.row + d.h)
}

interface Props {
  spec: GameSpec
  /** Where the art pack resolved to. */
  /** Resolve one file inside the art pack to a URL.
   *
   *  A RESOLVER, not a base string, and that distinction is the bug this fixes.
   *  Packs used to be local relative paths, so callers could build a URL by
   *  concatenation. They now live in a remote bucket and packUrl appends a
   *  `?v=<digest>` cache-buster, so `${base}/${file}` puts the query in the
   *  MIDDLE of the path and prefixing BASE_URL puts "./" in front of an
   *  absolute URL. Every request 404'd, img.onerror swallowed it, and the
   *  battle drew no creatures at all. */
  artUrl: (file: string) => string
  zone: ZoneSpec
  /** Called when the grass produces something. */
  onEncounter: () => void
}

export default function Overworld({ spec, zone, artUrl, onEncounter }: Props) {
  const artUrlRef = useRef(artUrl)
  artUrlRef.current = artUrl
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const art = useRef(new Map<string, HTMLImageElement>())
  const [pos, setPos] = useState({ col: 7, row: 5 })
  const [dir, setDir] = useState<Dir>('down')
  const [step, setStep] = useState(0)
  const [ready, setReady] = useState(false)
  /** Steps taken in grass since the last encounter, so they are not instant. */
  const grassSteps = useRef(0)

  useEffect(() => {
    let cancelled = false
    const want: Array<[string, string]> = [
      ...new Set(DECOR.map(d => d.art)).values(),
    ].map(a => [a, `tileset/${a}.png`])
    for (const frames of Object.values(WALK_FRAMES)) {
      for (const f of frames) want.push([`hero${f}`, `characters/protagonist_gold_cap/frame_${String(f).padStart(2, '0')}.png`])
    }
    void Promise.all(want.map(([key, path]) => new Promise<void>(resolve => {
      const img = new Image()
      img.onload = () => { art.current.set(key, img); resolve() }
      img.onerror = () => resolve()
      img.src = artUrlRef.current(path)
    }))).then(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    g.imageSmoothingEnabled = false

    // Camera follows the player but stops at the map edges, so the world never
    // shows past its own border.
    const camX = Math.max(0, Math.min(COLS * TILE - W, pos.col * TILE + TILE / 2 - W / 2))
    const camY = Math.max(0, Math.min(ROWS * TILE - H + 60, pos.row * TILE + TILE / 2 - H / 2))

    // Ground: grass, with a lighter clearing so the space reads as a place.
    g.fillStyle = '#5ea653'
    g.fillRect(0, 0, W, H)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // A little variation per tile, deterministic so it does not shimmer.
        const n = (c * 7 + r * 13) % 5
        g.fillStyle = n === 0 ? '#67ad5a' : n === 1 ? '#589e4d' : '#5ea653'
        g.fillRect(c * TILE - camX, r * TILE - camY, TILE, TILE)
      }
    }

    // Decorations, painter-ordered so nearer things overlap farther ones.
    for (const d of [...DECOR].sort((a, b) => a.row - b.row)) {
      const img = art.current.get(d.art)
      if (!img) continue
      g.drawImage(img, d.col * TILE - camX, d.row * TILE - camY, d.w * TILE, d.h * TILE)
    }

    // The player, drawn last so nothing hides them.
    const frames = WALK_FRAMES[dir]
    const hero = art.current.get(`hero${frames[step % frames.length]}`)
    if (hero) {
      const x = pos.col * TILE - camX
      const y = pos.row * TILE - camY
      g.save()
      if (dir === 'right') { g.translate(x + TILE, y); g.scale(-1, 1); g.drawImage(hero, 0, -10, TILE, TILE + 10) }
      else g.drawImage(hero, x, y - 10, TILE, TILE + 10)
      g.restore()
    }

    // Zone name, so the player knows where the generated game has put them.
    g.fillStyle = 'rgba(14,20,36,0.9)'
    g.strokeStyle = '#f5f2e8'
    g.lineWidth = 2
    g.beginPath(); g.roundRect(8, 8, 150, 32, 8); g.fill(); g.stroke()
    g.fillStyle = '#ffffff'
    g.font = 'bold 13px ui-monospace, monospace'
    g.textBaseline = 'middle'
    g.fillText(zone.displayName, 20, 25)

    if (isTallGrass(pos.col, pos.row)) {
      g.fillStyle = 'rgba(14,20,36,0.9)'
      g.beginPath(); g.roundRect(8, H - 40, 220, 30, 8); g.fill(); g.stroke()
      g.fillStyle = '#ffd84d'
      g.font = '12px ui-monospace, monospace'
      g.fillText('Something rustles in the grass...', 20, H - 25)
    }
  }, [pos, dir, zone, ready])

  useEffect(() => { draw() }, [draw])

  const move = useCallback((d: Dir) => {
    setDir(d)
    setStep(s => s + 1)
    setPos(p => {
      const next = {
        col: p.col + (d === 'left' ? -1 : d === 'right' ? 1 : 0),
        row: p.row + (d === 'up' ? -1 : d === 'down' ? 1 : 0),
      }
      if (isSolid(next.col, next.row)) return p
      sfxCursor()
      if (isTallGrass(next.col, next.row)) {
        grassSteps.current += 1
        // Not every step: an encounter on the first one reads as a trap.
        if (grassSteps.current >= 2 && Math.random() < 0.34) {
          grassSteps.current = 0
          sfxEncounter()
          window.setTimeout(onEncounter, 260)
        }
      }
      return next
    })
  }, [onEncounter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') move('up')
      else if (e.key === 'ArrowDown') move('down')
      else if (e.key === 'ArrowLeft') move('left')
      else if (e.key === 'ArrowRight') move('right')
    }
    const onShell = (e: Event) => {
      const b = (e as CustomEvent<{ button: string }>).detail?.button
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') move(b)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('poplur-retro-button', onShell as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('poplur-retro-button', onShell as EventListener)
    }
  }, [move])

  void spec
  return <canvas ref={canvasRef} width={W} height={H} className={styles.canvas} data-overworld="ready" aria-label="Overworld" />
}
