/**
 * A complete canvas battle. Campaign state stays in PoplurGame; this screen
 * owns only the transient HP, animation and menu state for one encounter.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  TYPE_ART, TYPE_FX, catchOdds, makeMon, movesOf, resolveHit,
  type BattleOpponent, type GameSpec, type Mon,
} from './battleRules'
import type { ArcadeBattleOutcome, ArcadePartyMember } from './arcadeProgress'
import type { GameDirectorSession } from './gameDirector'
import {
  sfxBallBreak, sfxBallWobble, sfxCaught, sfxConfirm, sfxCursor,
  sfxCancel, sfxEncounter, sfxFaint, sfxHit, sfxMiss,
} from './retroAudio'
import styles from './CreatureBattle.module.css'

const W = 384
const H = 344
const ACTIONS = ['FIGHT', 'BAG', 'CREATURE', 'RUN'] as const
type Action = (typeof ACTIONS)[number]
type Phase = 'action' | 'moves' | 'party' | 'bag' | 'message' | 'catching' | 'over'
type MessageNext = 'action' | 'party'
const BAG_ITEMS = ['POPLUR BALL', 'GLOW TONIC', 'REVIVE SEED'] as const

interface Effect { art: string; at: number }
interface BallThrow { step: number; caught: boolean }

interface Props {
  spec: GameSpec
  opponent: BattleOpponent
  party: ArcadePartyMember[]
  initialPartyIndex: number
  balls: number
  tonics: number
  revives: number
  director: GameDirectorSession
  artUrl: (file: string) => string
  onFinished: (outcome: ArcadeBattleOutcome) => void
}

export default function CreatureBattle({
  spec,
  opponent,
  party,
  initialPartyIndex,
  balls: startingBalls,
  tonics: startingTonics,
  revives: startingRevives,
  director,
  artUrl,
  onFinished,
}: Props) {
  const artUrlRef = useRef(artUrl)
  artUrlRef.current = artUrl
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const artRef = useRef(new Map<string, HTMLImageElement>())
  const [ready, setReady] = useState(false)
  const [team, setTeam] = useState<Mon[]>(() => party.flatMap(member => {
    const creature = spec.creatures.find(candidate => candidate.species === member.species)
    return creature ? [makeMon(creature, member.level)] : []
  }))
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, Math.min(initialPartyIndex, Math.max(0, party.length - 1))))
  const [wild, setWild] = useState<Mon>(() => ({ ...opponent.team[0] }))
  const [enemyQueue, setEnemyQueue] = useState<Mon[]>(() => opponent.team.slice(1).map(member => ({ ...member })))
  const [phase, setPhase] = useState<Phase>('message')
  const [messageNext, setMessageNext] = useState<MessageNext>('action')
  const [cursor, setCursor] = useState(0)
  const [partyCursor, setPartyCursor] = useState(0)
  const [bagCursor, setBagCursor] = useState(0)
  const [action, setAction] = useState(0)
  const [effect, setEffect] = useState<Effect | null>(null)
  const [ball, setBall] = useState<BallThrow | null>(null)
  const [message, setMessage] = useState(opponent.kind === 'wild'
    ? `A wild ${opponent.team[0].spec.displayName} appeared!`
    : `${opponent.title} ${opponent.displayName} challenges you!`)
  const [balls, setBalls] = useState(Math.max(0, startingBalls))
  const [tonics, setTonics] = useState(Math.max(0, startingTonics))
  const [revives, setRevives] = useState(Math.max(0, startingRevives))
  const [flash, setFlash] = useState(0)
  const [pendingOutcome, setPendingOutcome] = useState<ArcadeBattleOutcome | null>(null)

  const mine = team[activeIndex] ?? null

  useEffect(() => {
    let cancelled = false
    const wanted = new Set<string>()
    for (const creature of spec.creatures) wanted.add(TYPE_ART[creature.type])
    const extras: Array<[string, string]> = []
    for (const creature of spec.creatures) {
      extras.push(['fx_' + TYPE_FX[creature.type], 'effects/' + TYPE_FX[creature.type] + '.png'])
    }
    const names = ['closed', 'opening', 'center', 'opened', 'sparkle', 'closed_alt']
    for (let index = 1; index <= 6; index += 1) {
      extras.push([
        'ball_' + index,
        'animations/poplur_ball_open_close/frame_0' + index + '_' + names[index - 1] + '.png',
      ])
    }

    void Promise.all([
      ...extras.map(([key, path]) => new Promise<void>(resolve => {
        const image = new Image()
        image.onload = () => { artRef.current.set(key, image); resolve() }
        image.onerror = () => resolve()
        image.src = artUrlRef.current(path)
      })),
      ...[...wanted].flatMap(name => (['front', 'back'] as const).map(side =>
        new Promise<void>(resolve => {
          const image = new Image()
          image.onload = () => { artRef.current.set(name + '_' + side, image); resolve() }
          image.onerror = () => resolve()
          image.src = artUrlRef.current('creatures/' + side + '/' + name + '_' + side + '.png')
        }))),
    ]).then(() => {
      if (!cancelled) setReady(true)
    })
    sfxEncounter()
    return () => { cancelled = true }
  }, [spec])

  const terminal = useCallback((kind: ArcadeBattleOutcome['kind']) => {
    setPendingOutcome({
      kind,
      battleKind: opponent.kind,
      opponentId: opponent.id,
      wildSpecies: wild.spec.species,
      wildLevel: Math.max(...opponent.team.map(member => member.level)),
      activePartyIndex: activeIndex,
      ballsRemaining: balls,
      tonicsRemaining: tonics,
      revivesRemaining: revives,
    })
    setPhase('over')
  }, [activeIndex, balls, opponent, revives, tonics, wild.spec.species])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    g.imageSmoothingEnabled = false

    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#8fd3ff')
    sky.addColorStop(0.55, '#cfeaff')
    sky.addColorStop(0.551, '#7fc26a')
    sky.addColorStop(1, '#4f9a48')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)

    if (!mine) {
      g.fillStyle = '#ffffff'
      g.font = 'bold 14px ui-monospace, monospace'
      g.textAlign = 'center'
      g.fillText('No creature is ready to battle.', W / 2, H / 2)
      return
    }

    const platform = (cx: number, cy: number, radius: number) => {
      g.fillStyle = 'rgba(0,0,0,0.14)'
      g.beginPath(); g.ellipse(cx, cy + 6, radius, radius * 0.28, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#6bb35c'
      g.beginPath(); g.ellipse(cx, cy, radius, radius * 0.26, 0, 0, Math.PI * 2); g.fill()
    }
    platform(272, 150, 62)
    platform(108, 250, 74)

    const sprite = (
      name: string,
      side: 'front' | 'back',
      x: number,
      y: number,
      size: number,
      dim: boolean,
    ) => {
      const image = artRef.current.get(name + '_' + side)
      if (!image) return
      const sourceWidth = image.naturalWidth || image.width
      const sourceHeight = image.naturalHeight || image.height
      if (sourceWidth <= 0 || sourceHeight <= 0) return
      const scale = size / Math.max(sourceWidth, sourceHeight)
      const width = Math.round(sourceWidth * scale)
      const height = Math.round(sourceHeight * scale)
      g.save()
      if (dim) g.globalAlpha = 0.4
      // Fit without distortion and keep every pose planted on the same y
      // baseline. Narrow/tall sprites no longer get stretched into squares.
      g.drawImage(image, Math.round(x - width / 2), Math.round(y - height), width, height)
      g.restore()
    }
    sprite(TYPE_ART[wild.spec.type], 'front', 272, 158, 104, flash > 0 && flash % 6 < 3)
    sprite(TYPE_ART[mine.spec.type], 'back', 108, 262, 128, false)

    if (effect) {
      const image = artRef.current.get('fx_' + effect.art)
      if (image) {
        const life = 1 - effect.at / 18
        const size = 68 + (1 - life) * 30
        g.save()
        g.globalAlpha = Math.max(0, Math.min(1, life * 1.4))
        g.drawImage(image, 272 - size / 2, 122 - size / 2, size, size)
        g.restore()
      }
    }

    if (ball) {
      const flying = ball.step < 3
      const frame = flying ? ball.step + 1 : 3 + ((ball.step - 3) % 3)
      const image = artRef.current.get('ball_' + Math.max(1, Math.min(6, frame)))
      if (image) {
        const t = flying ? (ball.step + 1) / 3 : 1
        const x = 108 + (272 - 108) * t
        const y = flying ? 250 - Math.sin(t * Math.PI) * 90 : 150
        const tilt = flying ? 0 : Math.sin(ball.step * 2.1) * 0.4
        g.save()
        g.translate(x, y)
        g.rotate(tilt)
        g.drawImage(image, -18, -18, 36, 36)
        g.restore()
      }
    }

    const plate = (x: number, y: number, width: number, mon: Mon, numbers: boolean) => {
      g.fillStyle = 'rgba(20,28,48,0.92)'
      g.strokeStyle = '#f5f2e8'
      g.lineWidth = 2
      g.beginPath(); g.roundRect(x, y, width, 46, 8); g.fill(); g.stroke()
      g.fillStyle = '#ffffff'
      g.font = 'bold 13px ui-monospace, monospace'
      g.textBaseline = 'top'
      g.textAlign = 'left'
      g.fillText(mon.spec.displayName, x + 10, y + 7)
      g.textAlign = 'right'
      g.fillText('Lv' + mon.level, x + width - 10, y + 7)
      const bx = x + 10
      const by = y + 27
      const bw = width - 20
      const fraction = Math.max(0, mon.hp) / Math.max(1, mon.maxHp)
      g.fillStyle = '#2b3550'
      g.beginPath(); g.roundRect(bx, by, bw, 8, 4); g.fill()
      g.fillStyle = fraction > 0.5 ? '#57d16a' : fraction > 0.2 ? '#f2c14e' : '#e5533d'
      if (fraction > 0) { g.beginPath(); g.roundRect(bx, by, Math.max(2, bw * fraction), 8, 4); g.fill() }
      if (numbers) {
        g.fillStyle = '#cfd8ee'
        g.font = '11px ui-monospace, monospace'
        g.fillText(Math.max(0, mon.hp) + '/' + mon.maxHp, x + width - 10, y + 33)
      }
      g.textAlign = 'left'
    }
    plate(14, 14, 176, wild, false)
    plate(W - 190, 176, 176, mine, true)

    g.fillStyle = 'rgba(14,20,36,0.86)'
    g.beginPath(); g.roundRect(84, 66, 216, 22, 7); g.fill()
    g.fillStyle = director.accentColor
    g.font = 'bold 9px ui-monospace, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const directorLine = opponent.kind === 'wild'
      ? director.title + ' • WILD ENCOUNTER'
      : `${opponent.title} ${opponent.displayName} • ${enemyQueue.length + 1} LEFT`
    g.fillText(directorLine.slice(0, 38), W / 2, 77)
    g.textAlign = 'left'

    const boxY = H - 92
    g.fillStyle = 'rgba(14,20,36,0.95)'
    g.strokeStyle = '#f5f2e8'
    g.lineWidth = 3
    g.beginPath(); g.roundRect(8, boxY, W - 16, 84, 10); g.fill(); g.stroke()
    g.fillStyle = '#ffffff'
    g.font = 'bold 14px ui-monospace, monospace'
    g.textBaseline = 'alphabetic'

    if (phase === 'action') {
      ACTIONS.forEach((label, index) => {
        const col = index % 2
        const row = Math.floor(index / 2)
        const x = 34 + col * 176
        const y = boxY + 20 + row * 28
        const shown = label === 'BAG' ? 'BAG' : label
        g.fillStyle = index === action ? '#ffd84d' : '#ffffff'
        g.fillText((index === action ? '▸ ' : '  ') + shown, x, y)
      })
    } else if (phase === 'moves') {
      const moves = movesOf(spec, mine)
      moves.forEach((move, index) => {
        const col = index % 2
        const row = Math.floor(index / 2)
        const x = 26 + col * 176
        const y = boxY + 17 + row * 23
        g.fillStyle = index === cursor ? '#ffd84d' : '#ffffff'
        g.fillText((index === cursor ? '▸ ' : '  ') + move.displayName, x, y)
      })
      g.fillStyle = '#9fb0d0'
      g.font = '11px ui-monospace, monospace'
      g.fillText('B: back', 26, boxY + 67)
    } else if (phase === 'party') {
      team.forEach((member, index) => {
        const col = index % 2
        const row = Math.floor(index / 2)
        const x = 20 + col * 180
        const y = boxY + 17 + row * 19
        g.fillStyle = index === partyCursor ? '#ffd84d' : member.hp > 0 ? '#ffffff' : '#79839a'
        const marker = index === activeIndex ? '*' : ' '
        g.font = 'bold 10px ui-monospace, monospace'
        g.fillText((index === partyCursor ? '▸' : ' ') + marker + member.spec.displayName + ' L' + member.level, x, y)
      })
      g.fillStyle = '#9fb0d0'
      g.font = '9px ui-monospace, monospace'
      g.fillText('A: switch   B: back', 20, boxY + 77)
    } else if (phase === 'bag') {
      const counts = [balls, tonics, revives]
      BAG_ITEMS.forEach((item, index) => {
        const y = boxY + 17 + index * 19
        g.fillStyle = index === bagCursor ? '#ffd84d' : '#ffffff'
        g.font = 'bold 10px ui-monospace, monospace'
        g.fillText(`${index === bagCursor ? '▸' : ' '} ${item} x${counts[index]}`, 24, y)
      })
      g.fillStyle = '#9fb0d0'
      g.font = '9px ui-monospace, monospace'
      g.fillText('A: use   B: back', 24, boxY + 77)
    } else {
      const words = message.split(' ')
      let current = ''
      let y = boxY + 17
      for (const word of words) {
        const next = current ? current + ' ' + word : word
        if (g.measureText(next).width > W - 56) {
          if (current) g.fillText(current, 26, y)
          current = word
          y += 21
        } else current = next
      }
      if (current) g.fillText(current, 26, y)
      g.fillStyle = '#9fb0d0'
      g.font = '11px ui-monospace, monospace'
      g.fillText(phase === 'catching' ? 'Hold on...' : 'A to continue', 26, boxY + 67)
    }
  }, [ready, mine, wild, team, activeIndex, phase, cursor, partyCursor, bagCursor, action, message, balls, tonics, revives, flash, effect, ball, spec, director, opponent, enemyQueue.length])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    if (!effect) return
    // governor-ok: one-shot frame step, capped at 18 frames and gameplay-only
    const id = requestAnimationFrame(() =>
      setEffect(current => current && current.at < 18 ? { ...current, at: current.at + 1 } : null))
    return () => cancelAnimationFrame(id)
  }, [effect])

  useEffect(() => {
    if (flash <= 0) return
    // governor-ok: one-shot frame step, capped at 18 frames and gameplay-only
    const id = requestAnimationFrame(() => setFlash(value => value - 1))
    return () => cancelAnimationFrame(id)
  }, [flash])

  // One owned timeout advances the entire throw. Cleanup prevents a verdict or
  // sound from leaking into the overworld after the battle unmounts.
  useEffect(() => {
    if (!ball) return
    const id = window.setTimeout(() => {
      if (ball.step < 5) {
        const nextStep = ball.step + 1
        if (nextStep >= 3) sfxBallWobble()
        setBall({ ...ball, step: nextStep })
        return
      }

      setBall(null)
      if (ball.caught) {
        sfxCaught()
        setMessage('Gotcha! ' + wild.spec.displayName + ' was caught!')
        terminal('caught')
      } else {
        sfxBallBreak()
        setMessage(wild.spec.displayName + ' broke free!')
        setMessageNext('action')
        setPhase('message')
      }
    }, ball.step < 3 ? 210 : 260)
    return () => window.clearTimeout(id)
  }, [ball, terminal, wild.spec.displayName])

  const showMessage = useCallback((text: string, next: MessageNext = 'action') => {
    setMessage(text)
    setMessageNext(next)
    setPhase('message')
  }, [])

  const advance = useCallback(() => {
    if (!mine || phase === 'catching') return
    if (phase === 'message') { setPhase(messageNext); return }
    if (phase === 'over') {
      if (pendingOutcome) onFinished(pendingOutcome)
      return
    }
    if (phase === 'party') {
      const selected = team[partyCursor]
      if (!selected || selected.hp <= 0) {
        sfxCancel()
        showMessage('That creature needs to recover first.', 'party')
        return
      }
      if (partyCursor === activeIndex) {
        sfxCancel()
        showMessage(selected.spec.displayName + ' is already battling.', 'party')
        return
      }
      sfxConfirm()
      setActiveIndex(partyCursor)
      setCursor(0)
      showMessage('Go, ' + selected.spec.displayName + '!', 'action')
      return
    }
    if (phase === 'bag') {
      if (bagCursor === 0) {
        if (opponent.kind !== 'wild') {
          sfxCancel()
          showMessage('Poplur Balls only work during wild encounters.')
          return
        }
        if (balls <= 0) {
          sfxCancel()
          showMessage('No Poplur Balls left. Arena badges award more.')
          return
        }
        const caught = Math.random() * 100 < catchOdds(wild)
        setBalls(value => Math.max(0, value - 1))
        setMessage('You threw a Poplur Ball!')
        setBall({ step: 0, caught })
        setPhase('catching')
        return
      }
      if (bagCursor === 1) {
        if (tonics <= 0) {
          sfxCancel()
          showMessage('No Glow Tonics left. Route trainers award more.')
          return
        }
        if (mine.hp >= mine.maxHp) {
          sfxCancel()
          showMessage(`${mine.spec.displayName} is already at full health.`)
          return
        }
        const healed = Math.max(30, Math.ceil(mine.maxHp * 0.45))
        setTonics(value => Math.max(0, value - 1))
        setTeam(current => current.map((member, index) => index === activeIndex
          ? { ...member, hp: Math.min(member.maxHp, member.hp + healed) }
          : member))
        sfxConfirm()
        showMessage(`Glow Tonic restored ${mine.spec.displayName}'s health.`)
        return
      }

      const faintedIndex = team.findIndex(member => member.hp <= 0)
      if (revives <= 0) {
        sfxCancel()
        showMessage('No Revive Seeds left. Arena badges award more.')
        return
      }
      if (faintedIndex < 0) {
        sfxCancel()
        showMessage('No creature needs a Revive Seed.')
        return
      }
      const revived = team[faintedIndex]
      setRevives(value => Math.max(0, value - 1))
      setTeam(current => current.map((member, index) => index === faintedIndex
        ? { ...member, hp: Math.max(1, Math.ceil(member.maxHp / 2)) }
        : member))
      sfxConfirm()
      showMessage(`Revive Seed brought ${revived.spec.displayName} back!`)
      return
    }
    if (phase === 'action') {
      const chosen: Action = ACTIONS[action]
      if (chosen === 'FIGHT') { sfxConfirm(); setCursor(0); setPhase('moves'); return }
      if (chosen === 'BAG') {
        sfxConfirm()
        setBagCursor(0)
        setPhase('bag')
        return
      }
      if (chosen === 'CREATURE') {
        if (team.length <= 1) {
          sfxCancel()
          showMessage(mine.spec.displayName + ' is your only party creature.')
          return
        }
        sfxConfirm()
        setPartyCursor(activeIndex)
        setPhase('party')
        return
      }
      if (opponent.kind !== 'wild') {
        sfxCancel()
        showMessage(`You cannot leave a ${opponent.kind} battle.`)
      } else {
        sfxCancel()
        setMessage('You got away safely!')
        terminal('ran')
      }
      return
    }

    const moveList = movesOf(spec, mine)
    const move = moveList[Math.max(0, Math.min(cursor, moveList.length - 1))]
    sfxConfirm()
    const hit = resolveHit(mine, wild, move)
    const wildAfter = { ...wild, hp: wild.hp - hit.damage }
    setWild(wildAfter)
    if (hit.missed) {
      setFlash(0)
      sfxMiss()
    } else {
      setFlash(18)
      sfxHit(hit.effectiveness)
      setEffect({ art: TYPE_FX[move.type], at: 0 })
    }

    let text = mine.spec.displayName + ' used ' + move.displayName + '!'
    if (hit.missed) text += ' It missed!'
    else if (hit.effectiveness === 'super') text += ' It is very effective!'
    else if (hit.effectiveness === 'weak') text += ' It is not very effective.'

    if (wildAfter.hp <= 0) {
      sfxFaint()
      const nextEnemy = enemyQueue[0]
      if (nextEnemy) {
        setEnemyQueue(current => current.slice(1))
        setWild({ ...nextEnemy })
        setCursor(0)
        showMessage(`${text} ${wildAfter.spec.displayName} fainted! ${opponent.displayName} sends ${nextEnemy.spec.displayName}!`)
        return
      }
      setMessage(text + ' ' + wildAfter.spec.displayName + ' fainted!')
      terminal('won')
      return
    }

    const replies = movesOf(spec, wildAfter)
    const reply = replies[Math.floor(Math.random() * replies.length)]
    const back = resolveHit(wildAfter, mine, reply)
    const mineAfter = { ...mine, hp: mine.hp - back.damage }
    setTeam(current => current.map((member, index) => index === activeIndex ? mineAfter : member))
    if (back.missed) sfxMiss()
    else sfxHit(back.effectiveness)
    text += ' ' + wildAfter.spec.displayName + ' used ' + reply.displayName + '!'
    if (back.missed) text += ' It missed!'

    if (mineAfter.hp <= 0) {
      sfxFaint()
      const reserve = team.some((member, index) => index !== activeIndex && member.hp > 0)
      if (reserve) {
        showMessage(text + ' ' + mine.spec.displayName + ' fainted! Choose another creature.', 'party')
      } else {
        setMessage(text + ' Your party needs to recover.')
        terminal('lost')
      }
      return
    }
    showMessage(text)
  }, [
    mine, phase, messageNext, pendingOutcome, onFinished, team, partyCursor,
    activeIndex, showMessage, action, balls, tonics, revives, bagCursor, wild,
    terminal, spec, cursor, opponent, enemyQueue,
  ])

  useEffect(() => {
    const moveSelection = (delta: number) => {
      sfxCursor()
      if (phase === 'action') setAction(value => Math.max(0, Math.min(ACTIONS.length - 1, value + delta)))
      else if (phase === 'moves' && mine) {
        const count = movesOf(spec, mine).length
        setCursor(value => Math.max(0, Math.min(count - 1, value + delta)))
      } else if (phase === 'party') {
        setPartyCursor(value => Math.max(0, Math.min(team.length - 1, value + delta)))
      } else if (phase === 'bag') {
        setBagCursor(value => Math.max(0, Math.min(BAG_ITEMS.length - 1, value + (delta > 0 ? 1 : -1))))
      }
    }
    const press = (button: string) => {
      if (button === 'down') moveSelection(2)
      else if (button === 'up') moveSelection(-2)
      else if (button === 'right') moveSelection(1)
      else if (button === 'left') moveSelection(-1)
      else if (button === 'a') advance()
      else if (button === 'b') {
        if (phase === 'moves') { sfxCancel(); setPhase('action') }
        else if (phase === 'party' && mine && mine.hp > 0) { sfxCancel(); setPhase('action') }
        else if (phase === 'bag') { sfxCancel(); setPhase('action') }
      }
    }
    const onKey = (event: KeyboardEvent) => {
      const key = event.key
      if (key.startsWith('Arrow')) event.preventDefault()
      if (key === 'ArrowDown') press('down')
      else if (key === 'ArrowUp') press('up')
      else if (key === 'ArrowRight') press('right')
      else if (key === 'ArrowLeft') press('left')
      else if (key === 'z' || key === 'Enter') press('a')
      else if (key === 'x') press('b')
    }
    const onShell = (event: Event) => {
      const button = (event as CustomEvent<{ button: string }>).detail?.button
      if (button) press(button)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('poplur-retro-button', onShell as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('poplur-retro-button', onShell as EventListener)
    }
  }, [advance, mine, phase, spec, team.length])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className={styles.canvas}
      data-battle="ready"
      aria-label={`${opponent.kind} battle against ${opponent.displayName}`}
    />
  )
}
