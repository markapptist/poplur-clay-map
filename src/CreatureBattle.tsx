/**
 * The battle screen, drawn on a canvas from Poplur's own sprite sheet.
 *
 * This replaces the emulator path for generated games. The spec is JSON, so
 * there is no cross-compiler, no ROM and no build step between "Claude designed
 * a game" and "it is on screen" — and no 240x160 ceiling, so the art renders at
 * the size it was drawn.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  TYPE_ART, catchOdds, makeMon, movesOf, resolveHit, rollEncounter,
  type GameSpec, type Mon, type MoveSpec,
} from './battleRules'
import styles from './CreatureBattle.module.css'

/** Drawn at this size and scaled to the shell, so layout maths stays integer. */
const W = 384
const H = 344

type Phase = 'menu' | 'message' | 'over'

interface Props { specUrl: string }

export default function CreatureBattle({ specUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const artRef = useRef(new Map<string, HTMLImageElement>())

  const [spec, setSpec] = useState<GameSpec | null>(null)
  const [mine, setMine] = useState<Mon | null>(null)
  const [wild, setWild] = useState<Mon | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [cursor, setCursor] = useState(0)
  const [message, setMessage] = useState('')
  const [balls, setBalls] = useState(15)
  const [flash, setFlash] = useState(0)          // frames of hit flash on the target

  // ---- load the game and its art -----------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded: GameSpec = await (await fetch(specUrl)).json()
      if (cancelled) return

      // Only the art this game actually needs.
      const wanted = new Set<string>()
      for (const c of loaded.creatures) wanted.add(TYPE_ART[c.type])
      await Promise.all([...wanted].flatMap(name => ['front', 'back'].map(side =>
        new Promise<void>(resolve => {
          const img = new Image()
          img.onload = () => { artRef.current.set(`${name}_${side}`, img); resolve() }
          img.onerror = () => resolve()          // a missing sprite must not stall the battle
          img.src = `${import.meta.env.BASE_URL}games/arcade/mons/${name}_${side}.png`
        }),
      )))
      if (cancelled) return

      const starter = loaded.creatures.find(c => c.species === loaded.starters[0])!
      setSpec(loaded)
      setMine(makeMon(starter, 8))
      setWild(rollEncounter(loaded, loaded.zones[0]))
      setMessage(`A wild creature appeared!`)
      setPhase('message')
    })()
    return () => { cancelled = true }
  }, [specUrl])

  // ---- drawing ------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !spec || !mine || !wild) return
    const g = canvas.getContext('2d')
    if (!g) return
    g.imageSmoothingEnabled = false            // pixel art must stay crisp

    // Sky and ground: a painted backdrop rather than the flat fill a menu has.
    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#8fd3ff')
    sky.addColorStop(0.55, '#cfeaff')
    sky.addColorStop(0.551, '#7fc26a')
    sky.addColorStop(1, '#4f9a48')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)

    const platform = (cx: number, cy: number, rx: number) => {
      g.fillStyle = 'rgba(0,0,0,0.14)'
      g.beginPath(); g.ellipse(cx, cy + 6, rx, rx * 0.28, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#6bb35c'
      g.beginPath(); g.ellipse(cx, cy, rx, rx * 0.26, 0, 0, Math.PI * 2); g.fill()
    }
    platform(272, 150, 62)     // theirs, upper right
    platform(108, 250, 74)     // yours, lower left

    const sprite = (name: string, side: 'front' | 'back', x: number, y: number, size: number, dim: boolean) => {
      const img = artRef.current.get(`${name}_${side}`)
      if (!img) return
      g.save()
      if (dim) g.globalAlpha = 0.45
      g.drawImage(img, Math.round(x - size / 2), Math.round(y - size), size, size)
      g.restore()
    }
    sprite(TYPE_ART[wild.spec.type], 'front', 272, 158, 104, flash > 0 && flash % 6 < 3)
    sprite(TYPE_ART[mine.spec.type], 'back', 108, 262, 128, false)

    // Status plates, in the corners each combatant is not standing in.
    const plate = (x: number, y: number, w: number, mon: Mon, showNumbers: boolean) => {
      const h = 46
      g.fillStyle = 'rgba(20,28,48,0.92)'
      g.strokeStyle = '#f5f2e8'
      g.lineWidth = 2
      g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill(); g.stroke()

      g.fillStyle = '#ffffff'
      g.font = 'bold 13px ui-monospace, monospace'
      g.textBaseline = 'top'
      g.fillText(mon.spec.displayName, x + 10, y + 7)
      g.textAlign = 'right'
      g.fillText(`Lv${mon.level}`, x + w - 10, y + 7)
      g.textAlign = 'left'

      const bx = x + 10, by = y + 27, bw = w - 20, bh = 8
      g.fillStyle = '#2b3550'
      g.beginPath(); g.roundRect(bx, by, bw, bh, 4); g.fill()
      const frac = Math.max(0, mon.hp) / mon.maxHp
      g.fillStyle = frac > 0.5 ? '#57d16a' : frac > 0.2 ? '#f2c14e' : '#e5533d'
      g.beginPath(); g.roundRect(bx, by, Math.max(2, bw * frac), bh, 4); g.fill()

      if (showNumbers) {
        g.fillStyle = '#cfd8ee'
        g.font = '11px ui-monospace, monospace'
        g.textAlign = 'right'
        g.fillText(`${Math.max(0, mon.hp)}/${mon.maxHp}`, x + w - 10, y + 33)
        g.textAlign = 'left'
      }
    }
    plate(14, 14, 176, wild, false)
    plate(W - 190, 176, 176, mine, true)

    // The box everything is said in.
    const boxY = H - 92
    g.fillStyle = 'rgba(14,20,36,0.95)'
    g.strokeStyle = '#f5f2e8'
    g.lineWidth = 3
    g.beginPath(); g.roundRect(8, boxY, W - 16, 84, 10); g.fill(); g.stroke()

    g.fillStyle = '#ffffff'
    g.font = 'bold 14px ui-monospace, monospace'
    if (phase === 'menu') {
      const moves = movesOf(spec, mine)
      moves.forEach((m, i) => {
        const col = i % 2, row = Math.floor(i / 2)
        const x = 26 + col * 176, y = boxY + 14 + row * 24
        g.fillStyle = i === cursor ? '#ffd84d' : '#ffffff'
        g.fillText(`${i === cursor ? '▸' : ' '} ${m.displayName}`, x, y)
      })
      g.fillStyle = '#9fb0d0'
      g.font = '11px ui-monospace, monospace'
      g.fillText(`B: ball (${balls})    START: run`, 26, boxY + 64)
    } else {
      // Wrap the message rather than letting it run off the box.
      const words = message.split(' ')
      let line = ''
      let y = boxY + 16
      for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (g.measureText(next).width > W - 56) { g.fillText(line, 26, y); line = word; y += 22 }
        else line = next
      }
      if (line) g.fillText(line, 26, y)
      g.fillStyle = '#9fb0d0'
      g.font = '11px ui-monospace, monospace'
      g.fillText('A to continue', 26, boxY + 64)
    }
  }, [spec, mine, wild, phase, cursor, message, balls, flash])

  useEffect(() => { draw() }, [draw])

  // Hit flash: a few frames of blinking so a landed attack is felt, not just read.
  useEffect(() => {
    if (flash <= 0) return
    const id = requestAnimationFrame(() => setFlash(f => f - 1))
    return () => cancelAnimationFrame(id)
  }, [flash])

  // ---- input --------------------------------------------------------------
  const advance = useCallback(() => {
    if (!spec || !mine || !wild) return
    if (phase === 'message') { setPhase(wild.hp <= 0 || mine.hp <= 0 ? 'over' : 'menu'); return }
    if (phase === 'over') return

    const move = movesOf(spec, mine)[cursor]
    const hit = resolveHit(mine, wild, move)
    const after = { ...wild, hp: wild.hp - hit.damage }
    setWild(after)
    setFlash(18)

    let text = `${mine.spec.displayName} used ${move.displayName}!`
    if (hit.missed) text += ' It missed!'
    else if (hit.effectiveness === 'super') text += " It's very effective!"
    else if (hit.effectiveness === 'weak') text += " It's not very effective."

    if (after.hp <= 0) {
      setMessage(`${text} ${after.spec.displayName} fainted!`)
      setPhase('message')
      return
    }

    const reply = movesOf(spec, after)[Math.floor(Math.random() * movesOf(spec, after).length)]
    const back = resolveHit(after, mine, reply)
    const mineAfter = { ...mine, hp: mine.hp - back.damage }
    setMine(mineAfter)
    setMessage(`${text} ${after.spec.displayName} used ${reply.displayName}!` +
      (mineAfter.hp <= 0 ? ` ${mine.spec.displayName} fainted!` : ''))
    setPhase('message')
  }, [spec, mine, wild, phase, cursor])

  const throwBall = useCallback(() => {
    if (!wild || phase !== 'menu' || balls <= 0) return
    setBalls(b => b - 1)
    const caught = Math.random() * 100 < catchOdds(wild)
    setMessage(caught
      ? `Gotcha! ${wild.spec.displayName} was caught!`
      : `${wild.spec.displayName} broke free!`)
    setPhase(caught ? 'over' : 'message')
  }, [wild, phase, balls])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!spec || !mine) return
      const moves = movesOf(spec, mine)
      if (e.key === 'ArrowDown') setCursor(c => Math.min(moves.length - 1, c + 1))
      else if (e.key === 'ArrowUp') setCursor(c => Math.max(0, c - 1))
      else if (e.key === 'ArrowRight') setCursor(c => Math.min(moves.length - 1, c + 1))
      else if (e.key === 'ArrowLeft') setCursor(c => Math.max(0, c - 1))
      else if (e.key === 'z' || e.key === 'Enter') advance()
      else if (e.key === 'x') throwBall()
    }
    // The shell's painted buttons dispatch this; the keyboard is for desktop.
    const onShell = (e: Event) => {
      const b = (e as CustomEvent<{ button: string }>).detail?.button
      if (!spec || !mine || !b) return
      const moves = movesOf(spec, mine)
      if (b === 'down' || b === 'right') setCursor(c => Math.min(moves.length - 1, c + 1))
      else if (b === 'up' || b === 'left') setCursor(c => Math.max(0, c - 1))
      else if (b === 'a') advance()
      else if (b === 'b') throwBall()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('poplur-retro-button', onShell as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('poplur-retro-button', onShell as EventListener)
    }
  }, [spec, mine, advance, throwBall])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className={styles.canvas}
      data-battle="ready"
      aria-label="Creature battle"
    />
  )
}
