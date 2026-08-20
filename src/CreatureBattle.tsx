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
  TYPE_ART, TYPE_FX, catchOdds, makeMon, movesOf, resolveHit, rollEncounter,
  type GameSpec, type Mon, type MoveSpec,
} from './battleRules'
import {
  sfxBallBreak, sfxBallWobble, sfxCaught, sfxConfirm, sfxCursor,
  sfxCancel, sfxEncounter, sfxFaint, sfxHit, sfxMiss,
} from './retroAudio'
import styles from './CreatureBattle.module.css'

/** Drawn at this size and scaled to the shell, so layout maths stays integer. */
const W = 384
const H = 344

/** FIGHT opens the move list; the rest act immediately. */
const ACTIONS = ['FIGHT', 'BAG', 'CREATURE', 'RUN'] as const
type Action = (typeof ACTIONS)[number]

type Phase = 'action' | 'moves' | 'message' | 'over'

/** A sprite thrown at the target for a few frames when a move lands. */
interface Effect { art: string; at: number }
/** Frames of the ball animation, plus how many wobbles are left to show. */
interface BallThrow { frame: number; wobbles: number; caught: boolean }

interface Props {
  specUrl: string
  /** Where the art pack resolved to; the manifest decides local or bucket. */
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
  /** Called when the encounter ends, so the game can return to the overworld. */
  onFinished?: () => void
}

export default function CreatureBattle({ specUrl, artUrl, onFinished }: Props) {
  // Held in a ref: the resolver is rebuilt on every render of the parent, so
  // depending on it directly would reload every sprite each frame.
  const artUrlRef = useRef(artUrl)
  artUrlRef.current = artUrl
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const artRef = useRef(new Map<string, HTMLImageElement>())

  const [spec, setSpec] = useState<GameSpec | null>(null)
  const [mine, setMine] = useState<Mon | null>(null)
  const [wild, setWild] = useState<Mon | null>(null)
  const [phase, setPhase] = useState<Phase>('action')
  const [cursor, setCursor] = useState(0)
  const [action, setAction] = useState(0)
  const [effect, setEffect] = useState<Effect | null>(null)
  const [ball, setBall] = useState<BallThrow | null>(null)
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
      const extras: Array<[string, string]> = []
      for (const c of loaded.creatures) extras.push([`fx_${TYPE_FX[c.type]}`, `effects/${TYPE_FX[c.type]}.png`])
      for (let i = 1; i <= 6; i++) {
        const names = ['closed', 'opening', 'center', 'opened', 'sparkle', 'closed_alt']
        extras.push([`ball_${i}`, `animations/poplur_ball_open_close/frame_0${i}_${names[i - 1]}.png`])
      }
      await Promise.all(extras.map(([key, path]) => new Promise<void>(resolve => {
        const img = new Image()
        img.onload = () => { artRef.current.set(key, img); resolve() }
        img.onerror = () => resolve()
        img.src = artUrlRef.current(path)
      })))

      await Promise.all([...wanted].flatMap(name => ['front', 'back'].map(side =>
        new Promise<void>(resolve => {
          const img = new Image()
          img.onload = () => { artRef.current.set(`${name}_${side}`, img); resolve() }
          img.onerror = () => resolve()          // a missing sprite must not stall the battle
          img.src = artUrlRef.current(`creatures/${side}/${name}_${side}.png`)
        }),
      )))
      if (cancelled) return

      const starter = loaded.creatures.find(c => c.species === loaded.starters[0])!
      setSpec(loaded)
      setMine(makeMon(starter, 8))
      setWild(rollEncounter(loaded, loaded.zones[0]))
      setMessage(`A wild creature appeared!`)
      setPhase('message')
      sfxEncounter()
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

    // A landed move throws its element at the target for a few frames.
    if (effect) {
      const img = artRef.current.get(`fx_${effect.art}`)
      if (img) {
        const life = 1 - effect.at / 18
        g.save()
        g.globalAlpha = Math.max(0, Math.min(1, life * 1.4))
        const size = 68 + (1 - life) * 30
        g.drawImage(img, 272 - size / 2, 122 - size / 2, size, size)
        g.restore()
      }
    }

    // The ball: arcs from your side to theirs, then rocks where it lands.
    if (ball) {
      const img = artRef.current.get(`ball_${Math.min(6, Math.max(1, ball.frame))}`)
      if (img) {
        const flying = ball.wobbles > 3
        const t = flying ? (6 - ball.wobbles) / 3 : 1
        const x = 108 + (272 - 108) * Math.min(1, t)
        const y = 250 - Math.sin(Math.min(1, t) * Math.PI) * 90 - (flying ? 0 : 90)
        const tilt = flying ? 0 : Math.sin(ball.wobbles * 2.1) * 0.4
        g.save()
        g.translate(x, flying ? y : 150)
        g.rotate(tilt)
        g.drawImage(img, -18, -18, 36, 36)
        g.restore()
      }
    }

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
    if (phase === 'action') {
      // Two columns of two, the arrangement the genre settled on.
      ACTIONS.forEach((label, i) => {
        const col = i % 2, row = Math.floor(i / 2)
        const x = 40 + col * 168, y = boxY + 20 + row * 28
        g.fillStyle = i === action ? '#ffd84d' : '#ffffff'
        g.fillText(`${i === action ? '▸' : ' '} ${label}`, x, y)
      })
    } else if (phase === 'moves') {
      const moves = movesOf(spec, mine)
      moves.forEach((m, i) => {
        const col = i % 2, row = Math.floor(i / 2)
        const x = 26 + col * 176, y = boxY + 14 + row * 24
        g.fillStyle = i === cursor ? '#ffd84d' : '#ffffff'
        g.fillText(`${i === cursor ? '▸' : ' '} ${m.displayName}`, x, y)
      })
      g.fillStyle = '#9fb0d0'
      g.font = '11px ui-monospace, monospace'
      g.fillText('B: back', 26, boxY + 64)
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
  }, [spec, mine, wild, phase, cursor, action, message, balls, flash, effect, ball])

  useEffect(() => { draw() }, [draw])

  // The effect sprite lives for a fixed number of frames, then clears itself.
  useEffect(() => {
    if (!effect) return
    // governor-ok: one-shot frame step, re-armed only while an effect object exists (18 frames max, then null) — finite, gameplay-only, never idles
    const id = requestAnimationFrame(() =>
      setEffect(e => (e && e.at < 18 ? { ...e, at: e.at + 1 } : null)))
    return () => cancelAnimationFrame(id)
  }, [effect])

  // The ball: three flight steps, then three wobbles, then the verdict.
  useEffect(() => {
    if (!ball) return
    const id = window.setTimeout(() => {
      setBall(b => {
        if (!b) return null
        if (b.wobbles <= 1) return null
        return { ...b, frame: b.wobbles > 3 ? 2 : (b.frame % 3) + 3, wobbles: b.wobbles - 1 }
      })
    }, 240)
    return () => window.clearTimeout(id)
  }, [ball])

  // Hit flash: a few frames of blinking so a landed attack is felt, not just read.
  useEffect(() => {
    if (flash <= 0) return
    // governor-ok: one-shot per frame while flash > 0 (a handful of frames after a landed attack), self-clearing — finite, gameplay-only, never idles
    const id = requestAnimationFrame(() => setFlash(f => f - 1))
    return () => cancelAnimationFrame(id)
  }, [flash])

  // ---- input --------------------------------------------------------------
  // advance() is declared before throwBall, so it reaches it through a ref
  // rather than forcing a reorder that would break the hook order.
  const throwBallRef = useRef<(() => void) | null>(null)

  const advance = useCallback(() => {
    if (!spec || !mine || !wild) return
    if (phase === 'message') { setPhase(wild.hp <= 0 || mine.hp <= 0 ? 'over' : 'action'); return }
    if (phase === 'over') { onFinished?.(); return }
    if (phase === 'action') {
      // FIGHT opens the move list; the others resolve straight away.
      const chosen: Action = ACTIONS[action]
      if (chosen === 'FIGHT') { sfxConfirm(); setPhase('moves'); return }
      if (chosen === 'BAG') { throwBallRef.current?.(); return }
      if (chosen === 'CREATURE') {
        sfxCancel()
        setMessage(`${mine.spec.displayName} is your only creature right now.`)
        setPhase('message')
        return
      }
      sfxCancel()
      setMessage('You got away safely!')
      setPhase('over')
      return
    }

    const move = movesOf(spec, mine)[cursor]
    sfxConfirm()
    const hit = resolveHit(mine, wild, move)
    const after = { ...wild, hp: wild.hp - hit.damage }
    setWild(after)
    setFlash(18)

    if (hit.missed) sfxMiss()
    else {
      sfxHit(hit.effectiveness)
      setEffect({ art: TYPE_FX[move.type], at: 0 })
    }

    let text = `${mine.spec.displayName} used ${move.displayName}!`
    if (hit.missed) text += ' It missed!'
    else if (hit.effectiveness === 'super') text += " It's very effective!"
    else if (hit.effectiveness === 'weak') text += " It's not very effective."

    if (after.hp <= 0) {
      setMessage(`${text} ${after.spec.displayName} fainted!`)
      setPhase('message')
      sfxFaint()
      return
    }

    const reply = movesOf(spec, after)[Math.floor(Math.random() * movesOf(spec, after).length)]
    const back = resolveHit(after, mine, reply)
    const mineAfter = { ...mine, hp: mine.hp - back.damage }
    setMine(mineAfter)
    setMessage(`${text} ${after.spec.displayName} used ${reply.displayName}!` +
      (mineAfter.hp <= 0 ? ` ${mine.spec.displayName} fainted!` : ''))
    setPhase('message')
  }, [spec, mine, wild, phase, cursor, action, onFinished])

  const throwBall = useCallback(() => {
    if (!wild || balls <= 0) return
    setBalls(b => b - 1)
    const caught = Math.random() * 100 < catchOdds(wild)
    // Three rocks before the verdict — the pause is most of why a catch lands.
    setBall({ frame: 1, wobbles: 6, caught })          // 3 flight steps, then 3 rocks
    ;[0, 1, 2].forEach(i => window.setTimeout(sfxBallWobble, 780 + i * 240))
    window.setTimeout(caught ? sfxCaught : sfxBallBreak, 1520)
    setMessage(caught
      ? `Gotcha! ${wild.spec.displayName} was caught!`
      : `${wild.spec.displayName} broke free!`)
    setPhase(caught ? 'over' : 'message')
  }, [wild, balls])

  useEffect(() => { throwBallRef.current = throwBall }, [throwBall])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!spec || !mine) return
      const moves = movesOf(spec, mine)
      const step = (d: number) => {
        sfxCursor()
        if (phase === 'action') setAction(a => Math.max(0, Math.min(ACTIONS.length - 1, a + d)))
        else if (phase === 'moves') setCursor(c => Math.max(0, Math.min(moves.length - 1, c + d)))
      }
      if (e.key === 'ArrowDown') step(2)
      else if (e.key === 'ArrowUp') step(-2)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'z' || e.key === 'Enter') advance()
      else if (e.key === 'x' && phase === 'moves') { sfxCancel(); setPhase('action') }
    }
    // The shell's painted buttons dispatch this; the keyboard is for desktop.
    const onShell = (e: Event) => {
      const b = (e as CustomEvent<{ button: string }>).detail?.button
      if (!spec || !mine || !b) return
      const moves = movesOf(spec, mine)
      const step = (d: number) => {
        sfxCursor()
        if (phase === 'action') setAction(a => Math.max(0, Math.min(ACTIONS.length - 1, a + d)))
        else if (phase === 'moves') setCursor(c => Math.max(0, Math.min(moves.length - 1, c + d)))
      }
      if (b === 'down') step(2)          // the menu is two wide, so down is +2
      else if (b === 'up') step(-2)
      else if (b === 'right') step(1)
      else if (b === 'left') step(-1)
      else if (b === 'a') advance()
      else if (b === 'b') { if (phase === 'moves') { sfxCancel(); setPhase('action') } }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('poplur-retro-button', onShell as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('poplur-retro-button', onShell as EventListener)
    }
  }, [spec, mine, phase, advance, throwBall])

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
