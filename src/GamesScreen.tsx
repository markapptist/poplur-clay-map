import { useEffect, useRef, useState } from 'react'
import styles from './GamesScreen.module.css'
import PoplurgatchiPlayable from './PoplurgatchiPlayable'
import { playPop } from './pop'

interface Game {
  id: 'fps' | 'poplurgatchi'
  title: string
  subtitle: string
  color: string
  preview: string
  web?: string
}

const GAMES: Game[] = [
  {
    id: 'poplurgatchi',
    title: 'Poplurgatchi',
    subtitle: 'Virtual pet — feed, play & grow',
    color: '#ff389e',
    preview: 'games/poplurgatchi/assets/device-rainbow.webp',
  },
  {
    id: 'fps',
    title: 'FPS Shooter',
    subtitle: 'Raycasting first-person shooter',
    color: '#33ccff',
    preview: 'games/fps/reference/approved-gameplay.webp',
    web: 'games/fps/index.html',
  },
]

function Cover({ game, size }: { game: Game; size: 'hero' | 'tile' }) {
  return (
    <div className={size === 'hero' ? styles.heroArt : styles.tileArt}>
      <img
        className={`${styles.coverImage} ${game.id === 'fps' ? styles.pixelCover : styles.deviceCover}`}
        src={game.preview}
        alt=""
        draggable={false}
      />
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
      <div className={`${styles.stage} ${running.id === 'fps' ? styles.fpsStage : ''}`} style={{ ['--accent' as string]: running.color }}>
        {running.id === 'poplurgatchi' ? (
          <PoplurgatchiPlayable />
        ) : running.web ? (
          <iframe
            className={`${styles.gameFrame} ${running.id === 'fps' ? styles.fpsFrame : ''}`}
            src={running.web}
            title={running.title}
            allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
            allowFullScreen
          />
        ) : null}
        {/* The app cube remains above this stage and is the one back control. */}
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
        {/* No ✕ — the cube closes every subscreen, this one included. */}
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
            {/* One mark, flat, the way a PS5 boot is: the clay P badge. The old
                boot layered this same badge over clay_cube.png — whose front
                face is the PROFILE cube, a person icon — so the screen showed a
                P pasted crooked over a person with the cube's frame poking out
                underneath. It read as a rendering glitch, not an assembling
                logo. */}
            <img className={styles.bootCube} src="logo_icon.png" alt="" draggable={false} />
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
