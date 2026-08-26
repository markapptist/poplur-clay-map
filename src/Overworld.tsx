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
import type { GameDirectorSession } from './gameDirector'
import { sfxCursor, sfxEncounter } from './retroAudio'
import styles from './CreatureBattle.module.css'

const W = 384
const H = 344
const TILE = 32
/** Map is a little wider than the view, so the camera has somewhere to go. */
const COLS = 16
const ROWS = 14

type Dir = 'down' | 'up' | 'left' | 'right'

/** Three clean, normalized poses for every facing direction. */
const WALK_FRAMES: Record<Dir, string[]> = {
  down:  ['down_01', 'down_02', 'down_03'],
  up:    ['up_01', 'up_02', 'up_03'],
  left:  ['left_01', 'left_02', 'left_03'],
  right: ['right_01', 'right_02', 'right_03'],
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
  director: GameDirectorSession
  balls: number
  tonics: number
  revives: number
  wins: number
  badges: string[]
  partyCount: number
  captures: number
  objective: string
  notice: string
  challengeLabel: string
  /** A/start on the physical shell launches the next gated campaign battle. */
  onChallenge: () => void
  /** Called when the grass produces something. */
  onEncounter: () => void
}

export default function Overworld({
  spec, zone, artUrl, director, balls, tonics, revives, wins, badges, partyCount,
  captures, objective, notice, challengeLabel, onChallenge, onEncounter,
}: Props) {
  const artUrlRef = useRef(artUrl)
  artUrlRef.current = artUrl
  const onEncounterRef = useRef(onEncounter)
  onEncounterRef.current = onEncounter
  const onChallengeRef = useRef(onChallenge)
  onChallengeRef.current = onChallenge
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const art = useRef(new Map<string, HTMLImageElement>())
  const [pos, setPos] = useState({ col: 7, row: 5 })
  const [dir, setDir] = useState<Dir>('down')
  const [step, setStep] = useState(0)
  const [ready, setReady] = useState(false)
  /** Steps taken in grass since the last encounter, so they are not instant. */
  const grassSteps = useRef(0)
  const encounterTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (encounterTimer.current !== null) window.clearTimeout(encounterTimer.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    const want: Array<[string, string]> = [
      ...new Set(DECOR.map(d => d.art)).values(),
    ].map(a => [a, `tileset/${a}.png`])
    for (const frames of Object.values(WALK_FRAMES)) {
      for (const frame of frames) {
        want.push([`hero:${frame}`, `characters/protagonist_gold_cap_v2/${frame}.png`])
      }
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

    // Each authored zone gets a stable palette, so unlocking a route changes
    // the place rather than merely replacing the name on the same map.
    const zoneIndex = Math.max(0, spec.zones.findIndex(candidate => candidate.id === zone.id))
    const palettes = [
      ['#5ea653', '#67ad5a', '#589e4d'],
      ['#486c73', '#527b80', '#3f626c'],
      ['#8a6848', '#9b7952', '#78583f'],
    ] as const
    const palette = palettes[zoneIndex % palettes.length]
    g.fillStyle = palette[0]
    g.fillRect(0, 0, W, H)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // A little variation per tile, deterministic so it does not shimmer.
        const n = (c * 7 + r * 13) % 5
        g.fillStyle = n === 0 ? palette[1] : n === 1 ? palette[2] : palette[0]
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
    const hero = art.current.get(`hero:${frames[step % frames.length]}`)
    if (hero) {
      const x = pos.col * TILE - camX
      const y = pos.row * TILE - camY
      const heroSize = 46
      g.drawImage(hero, x + (TILE - heroSize) / 2, y + TILE - heroSize, heroSize, heroSize)
    }

    // Zone name, so the player knows where the generated game has put them.
    g.fillStyle = 'rgba(14,20,36,0.9)'
    g.strokeStyle = '#f5f2e8'
    g.lineWidth = 2
    g.beginPath(); g.roundRect(8, 8, 176, 32, 8); g.fill(); g.stroke()
    g.fillStyle = '#ffffff'
    g.font = 'bold 13px ui-monospace, monospace'
    g.textBaseline = 'middle'
    g.fillText(zone.displayName, 20, 25)

    g.fillStyle = 'rgba(14,20,36,0.9)'
    g.beginPath(); g.roundRect(W - 184, 8, 176, 32, 8); g.fill(); g.stroke()
    g.fillStyle = '#ffffff'
    g.font = 'bold 11px ui-monospace, monospace'
    g.fillText(`B${balls} T${tonics} R${revives} W${wins}`, W - 172, 25)

    // The badge case stays visible on every route. Eight authored slots make
    // the campaign scope legible from the first minute, and earned badges use
    // the live director accent without changing their progression identity.
    g.fillStyle = 'rgba(14,20,36,0.84)'
    g.beginPath(); g.roundRect(8, 46, 176, 24, 7); g.fill(); g.stroke()
    g.font = 'bold 8px ui-monospace, monospace'
    g.fillStyle = '#cfd8ee'
    g.fillText('BADGES', 16, 59)
    for (let index = 0; index < 8; index += 1) {
      const x = 67 + index * 13
      g.fillStyle = index < badges.length ? director.accentColor : '#2b3550'
      g.strokeStyle = index < badges.length ? '#ffffff' : '#69758f'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(x, 52); g.lineTo(x + 4, 56); g.lineTo(x, 64); g.lineTo(x - 4, 56); g.closePath()
      g.fill(); g.stroke()
    }

    const cardY = H - 108
    g.fillStyle = 'rgba(14,20,36,0.94)'
    g.beginPath(); g.roundRect(8, cardY, W - 16, 100, 9); g.fill(); g.stroke()
    g.fillStyle = director.accentColor
    g.fillRect(10, cardY + 2, 4, 96)
    g.textBaseline = 'top'
    const fit = (value: string, width = W - 54) => {
      if (g.measureText(value).width <= width) return value
      let clipped = value
      while (clipped.length > 1 && g.measureText(`${clipped}…`).width > width) clipped = clipped.slice(0, -1)
      return `${clipped}…`
    }
    const line = (value: string, y: number, color: string, font: string) => {
      g.fillStyle = color
      g.font = font
      g.fillText(fit(value), 22, y)
    }
    const source = director.source === 'ai' ? 'AI LIVE' : 'OFFLINE'
    line(`${director.title}  [${source}]`, cardY + 7, '#ffffff', 'bold 11px ui-monospace, monospace')
    const latestBadge = badges[badges.length - 1] ?? 'NO BADGES YET'
    line(`BADGES ${badges.length}/8  •  ${latestBadge}  •  PARTY ${partyCount}  •  CAUGHT ${captures}`, cardY + 23, '#a9bbdc', 'bold 9px ui-monospace, monospace')
    line(`GOAL ${objective}`, cardY + 38, '#ffd84d', 'bold 9px ui-monospace, monospace')
    line(`A/START ${challengeLabel}`, cardY + 53, director.accentColor, 'bold 9px ui-monospace, monospace')
    line(`MISSION ${director.specialMechanic}`, cardY + 68, '#ffffff', '9px ui-monospace, monospace')
    line(isTallGrass(pos.col, pos.row) ? 'Grass rustles — keep moving!' : notice, cardY + 83, '#a9bbdc', '9px ui-monospace, monospace')
  }, [pos, dir, zone, ready, spec, director, balls, tonics, revives, wins, badges, partyCount, captures, objective, notice, challengeLabel])

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
        if (grassSteps.current >= 2 && Math.random() < 0.34 && encounterTimer.current === null) {
          grassSteps.current = 0
          sfxEncounter()
          encounterTimer.current = window.setTimeout(() => {
            encounterTimer.current = null
            onEncounterRef.current()
          }, 260)
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); move('up') }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move('down') }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move('left') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move('right') }
      else if (e.key === 'z' || e.key === 'Enter') { e.preventDefault(); onChallengeRef.current() }
    }
    const onShell = (e: Event) => {
      const b = (e as CustomEvent<{ button: string }>).detail?.button
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') move(b)
      else if (b === 'a' || b === 'start') onChallengeRef.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('poplur-retro-button', onShell as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('poplur-retro-button', onShell as EventListener)
    }
  }, [move])

  return <canvas ref={canvasRef} width={W} height={H} className={styles.canvas} data-overworld="ready" aria-label="Overworld" />
}
