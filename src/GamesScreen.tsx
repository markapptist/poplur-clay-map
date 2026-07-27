import React, { useEffect, useRef, useState } from 'react'
import styles from './GamesScreen.module.css'
import ClayCornerButton from './ClayCornerButton'
import { playPop } from './pop'

// GAMES — the web twin of GamePickerView.swift, carrying the two games the app
// ships: the FPS raycaster and Poplurgatchi, the clay pet.
//
// Poplurgatchi runs here for real: its needs decay on a clock, feeding and
// playing move them, and neglect shows. The FPS raycaster is a native SceneKit
// build (FPSGameScene.swift) with no web port, so its card says so plainly
// rather than opening an empty screen.

interface Game {
  id: string
  title: string
  subtitle: string
  art: string
  playable: boolean
}

const GAMES: Game[] = [
  {
    id: 'poplurgatchi',
    title: 'Poplurgatchi',
    subtitle: 'Virtual pet — feed, play & grow',
    art: 'clay_cube.png',
    playable: true,
  },
  {
    id: 'fps',
    title: 'FPS Shooter',
    subtitle: 'Raycasting first-person shooter',
    art: 'clay_buildings.png',
    playable: false,
  },
]

const clamp = (v: number) => Math.max(0, Math.min(100, v))

function Poplurgatchi({ onExit }: { onExit: () => void }) {
  // Three needs, all falling. Doing nothing is a choice the pet notices.
  const [food, setFood] = useState(72)
  const [fun, setFun] = useState(64)
  const [rest, setRest] = useState(88)
  const [age, setAge] = useState(0)
  const [mood, setMood] = useState<'happy' | 'meh' | 'sad'>('happy')
  const [bounce, setBounce] = useState(false)
  const bounceTimer = useRef<number | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFood(v => clamp(v - 1.4))
      setFun(v => clamp(v - 1.1))
      setRest(v => clamp(v - 0.7))
      setAge(a => a + 1)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const average = (food + fun + rest) / 3
    setMood(average > 66 ? 'happy' : average > 34 ? 'meh' : 'sad')
  }, [food, fun, rest])

  const nudge = (fn: () => void) => {
    playPop()
    fn()
    setBounce(true)
    if (bounceTimer.current) window.clearTimeout(bounceTimer.current)
    bounceTimer.current = window.setTimeout(() => setBounce(false), 460)
  }

  useEffect(() => () => { if (bounceTimer.current) window.clearTimeout(bounceTimer.current) }, [])

  return (
    <div className={styles.pet}>
      <header className={styles.petHead}>
        <button className={styles.back} type="button" onClick={() => { playPop(); onExit() }}>‹ Games</button>
        <span className={styles.petTitle}>POPLURGATCHI</span>
        <span className={styles.petAge}>{age}m old</span>
      </header>

      <div className={styles.stage}>
        <div
          className={bounce ? `${styles.petBody} ${styles.petBounce}` : styles.petBody}
          data-mood={mood}
          onClick={() => nudge(() => setFun(v => clamp(v + 4)))}
          role="button"
          aria-label="Pet the Poplurgatchi"
        >
          <img src="clay_cube.png" alt="" draggable={false} />
          <span className={styles.face}>{mood === 'happy' ? '^  ^' : mood === 'meh' ? '-  -' : 'x  x'}</span>
        </div>
      </div>

      <div className={styles.needs}>
        {([['FOOD', food], ['FUN', fun], ['REST', rest]] as const).map(([label, value]) => (
          <div key={label} className={styles.need}>
            <span className={styles.needLabel}>{label}</span>
            <span className={styles.needTrack}>
              <span
                className={styles.needFill}
                style={{ width: `${value}%`, background: value < 30 ? '#ef4444' : value < 60 ? '#f59e0b' : '#4dff69' }}
              />
            </span>
          </div>
        ))}
      </div>

      <div className={styles.petActions}>
        <button className={styles.petBtn} type="button" onClick={() => nudge(() => setFood(v => clamp(v + 22)))}>FEED</button>
        <button className={styles.petBtn} type="button" onClick={() => nudge(() => setFun(v => clamp(v + 20)))}>PLAY</button>
        <button className={styles.petBtn} type="button" onClick={() => nudge(() => setRest(v => clamp(v + 26)))}>SLEEP</button>
      </div>
    </div>
  )
}

export default function GamesScreen({ onClose }: { onClose: () => void }) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (playing === 'poplurgatchi') return <Poplurgatchi onExit={() => setPlaying(null)} />

  return (
    <div className={styles.screen} role="dialog" aria-label="Games">
      <header className={styles.head}>
        <div className={styles.brand}>
          <img className={styles.brandIcon} src="logo_icon.png" alt="" draggable={false} />
          <span className={styles.brandName}>poplur games</span>
        </div>
        <ClayCornerButton kind="close" label="Close games" size={44} activateOnClick onPress={onClose} />
      </header>

      <div className={styles.grid}>
        {GAMES.map(game => (
          <button
            key={game.id}
            type="button"
            className={styles.card}
            onClick={() => {
              playPop()
              if (game.playable) { setPlaying(game.id); return }
              setNote(`${game.title} runs natively on the app — it has no web build yet.`)
              window.setTimeout(() => setNote(null), 2600)
            }}
          >
            <span className={styles.art} style={{ backgroundImage: `url("${game.art}")` }} />
            <span className={styles.cardBody}>
              <span className={styles.cardTitle}>{game.title}</span>
              <span className={styles.cardSub}>{game.subtitle}</span>
            </span>
            <span className={game.playable ? styles.play : styles.native}>{game.playable ? 'PLAY' : 'APP ONLY'}</span>
          </button>
        ))}
      </div>

      {/* Part 4 lands here: anything built with Poplur Create that is a game
          joins this list. */}
      <p className={styles.hint}>Games you create with Poplur Create will appear here.</p>

      {note && <div className={styles.note}>{note}</div>}
    </div>
  )
}
