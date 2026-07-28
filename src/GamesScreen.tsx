import React, { useEffect, useRef, useState } from 'react'
import styles from './GamesScreen.module.css'
import PoplurgatchiGame, { PoplurgatchiPreview } from './PoplurgatchiGame'
import { playPop } from './pop'
import { isNativeShell, postNativeEvent } from './nativeBridge'

// PS5-style library for the Games channel (CH 102), listing the REAL Poplur
// games — the same two the native GamePickerView ships (Poplurgatchi and FPS
// Shooter). Both are playable here; iOS still hands Poplurgatchi to the native
// SpriteKit game when its bridge handles that route.

interface Game {
  id: 'fps' | 'poplurgatchi'
  title: string
  subtitle: string
  emoji: string
  color: string
  color2: string
  /** playable right here in the web twin (real embedded build) */
  web?: string
}

const GAMES: Game[] = [
  {
    id: 'poplurgatchi',
    title: 'Poplurgatchi',
    subtitle: 'Virtual pet — feed, play & grow',
    emoji: '🥚',
    color: '#ff389e',
    color2: '#a3095b',
  },
  {
    id: 'fps',
    title: 'FPS Shooter',
    subtitle: 'Raycasting first-person shooter',
    emoji: '🔫',
    color: '#33ccff',
    color2: '#0b5f96',
    web: 'games/fps/index.html',

  },
]

/** Cover face built from the game's own accent + icon (no invented box art). */
function Cover({ game, size }: { game: Game; size: 'hero' | 'tile' }) {
  if (game.id === 'poplurgatchi') {
    return (
      <div
        className={`${size === 'hero' ? styles.heroArt : styles.tileArt} ${styles.gatchArt}`}
      >
        <PoplurgatchiPreview compact={size === 'tile'} />
        <span className={styles.coverSheen} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div
      className={size === 'hero' ? styles.heroArt : styles.tileArt}
      style={{ background: `linear-gradient(150deg, ${game.color} 0%, ${game.color2} 78%)` }}
    >
      <span className={styles.coverGlyph} aria-hidden="true">{game.emoji}</span>
      <span className={styles.coverTitle}>{game.title}</span>
      <span className={styles.coverSheen} aria-hidden="true" />
    </div>
  )
}

export default function GamesScreen({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState(0)
  const [booting, setBooting] = useState<Game | null>(null)
  const [running, setRunning] = useState<Game | null>(null)
  const bootTimer = useRef<number | null>(null)
  const game = GAMES[selected]

  const focus = (index: number) => {
    setSelected((index + GAMES.length) % GAMES.length)
    playPop()
  }

  const launch = (g: Game) => {
    playPop()
    // In the app shell the GAMES tile already routes to the native GamePickerView
    // (HoldMenuNavigate "games"), so this screen is the browser path. If it does
    // get mounted inside the shell, hand back to that same native route rather
    // than pretending to run a native game in a web frame.
    if (isNativeShell() && g.id === 'poplurgatchi') {
      postNativeEvent({ type: 'holdMenuNavigate', action: 'games' })
    }
    setBooting(g)
    if (bootTimer.current) window.clearTimeout(bootTimer.current)
    bootTimer.current = window.setTimeout(() => {
      setBooting(null)
      setRunning(g)
      bootTimer.current = null
    }, 2200)
  }

  const quit = () => { playPop(); setRunning(null) }

  useEffect(() => () => { if (bootTimer.current) window.clearTimeout(bootTimer.current) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (running) { if (e.key === 'Escape') { e.preventDefault(); quit() } return }
      if (booting) return
      if (e.key === 'ArrowRight') { e.preventDefault(); focus(selected + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(selected - 1) }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(game) }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── running a game ────────────────────────────────────────────────────────
  if (running) {
    return (
      <div className={styles.stage} style={{ ['--accent' as string]: running.color }}>
        {running.id === 'poplurgatchi' ? (
          <PoplurgatchiGame />
        ) : running.web ? (
          // The real game build, playing in the frame.
          <iframe
            className={styles.gameFrame}
            src={running.web}
            title={running.title}
            allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
          />
        ) : null}
        <button className={styles.quitFloating} onClick={quit} aria-label={`Quit ${running.title}`}>
          ◼ QUIT
        </button>
      </div>
    )
  }

  return (
    <div className={styles.stage} style={{ ['--accent' as string]: game.color }}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.topbar}>
        <div className={styles.chWrap}>
          <span className={styles.chPill}>CH 102</span>
          <span className={styles.chName}>GAMES</span>
        </div>
        <button className={styles.close} aria-label="Close games" onClick={() => { playPop(); onClose() }}>✕</button>
      </header>

      <section className={styles.hero} aria-live="polite">
        <button className={styles.heroCover} onClick={() => launch(game)} aria-label={`Play ${game.title}`}>
          <Cover game={game} size="hero" />
        </button>
        <div className={styles.heroInfo}>
          <span className={styles.heroKicker}>POPLUR GAMES</span>
          <h1 className={styles.heroTitle}>{game.title}</h1>
          <p className={styles.heroMeta}>{game.subtitle}</p>
          <button className={styles.playBtn} onClick={() => launch(game)}>
            <span className={styles.playTri}>▶</span> PLAY
          </button>
        </div>
      </section>

      <div className={styles.shelfWrap}>
        <span className={styles.shelfLabel}>YOUR GAMES</span>
        <div className={styles.shelf} role="listbox" aria-label="Games">
          {GAMES.map((g, i) => (
            <button
              key={g.id}
              data-idx={i}
              role="option"
              aria-selected={i === selected}
              className={`${styles.card} ${i === selected ? styles.cardOn : ''}`}
              onClick={() => (i === selected ? launch(g) : focus(i))}
            >
              <Cover game={g} size="tile" />
              <span className={styles.cardTitle}>{g.title}</span>
            </button>
          ))}
        </div>
      </div>

      {booting && (
        <div className={styles.boot} style={{ ['--accent' as string]: booting.color }}>
          <div className={styles.bootLogo} aria-label="PoplurStation">
            <img className={styles.bootCube} src="clay_cube.png" alt="" draggable={false} />
            <img className={styles.bootP} src="logo_icon.png" alt="" draggable={false} />
            <span className={styles.bootSweep} aria-hidden="true" />
          </div>
          <span className={styles.bootWord}>POPLUR<b>STATION</b></span>
          <div className={styles.bootTrack}><div className={styles.bootFill} /></div>
          <span className={styles.bootGame}>{booting.title}</span>
        </div>
      )}
    </div>
  )
}
