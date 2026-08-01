import { useEffect, useMemo, useState } from 'react'
import styles from './PoplurgatchiPlayable.module.css'
import { playPop } from './pop'

const ACTIONS = [
  { name: 'Feed', message: 'YUM! That hit the spot!', stats: { hunger: 24, happiness: 4 } },
  { name: 'Happy', message: 'Poplurgatchi feels loved!', stats: { happiness: 22 } },
  { name: 'Medicine', message: 'Feeling better already!', stats: { health: 20 } },
  { name: 'Rest', message: 'Zzz... good night!', stats: { energy: 24 } },
  { name: 'Bath', message: 'Sparkly clean!', stats: { clean: 28 } },
  { name: 'Snack', message: 'A tiny treat!', stats: { hunger: 12, happiness: 8 } },
  { name: 'Play', message: 'Wanna play again?', stats: { happiness: 18, energy: -7 } },
  { name: 'Friend', message: 'Best friends forever!', stats: { happiness: 16 } },
] as const

type Stats = {
  hunger: number
  happiness: number
  energy: number
  clean: number
  health: number
}

const DEFAULT_STATS: Stats = {
  hunger: 72,
  happiness: 84,
  energy: 76,
  clean: 70,
  health: 92,
}

function restoreStats(): Stats {
  try {
    const saved = JSON.parse(window.localStorage.getItem('poplur.poplurgatchi.stats') ?? 'null')
    if (!saved || typeof saved !== 'object') return DEFAULT_STATS
    return { ...DEFAULT_STATS, ...saved }
  } catch {
    return DEFAULT_STATS
  }
}

export default function PoplurgatchiPlayable() {
  const [selected, setSelected] = useState(0)
  const [stats, setStats] = useState<Stats>(restoreStats)
  const [message, setMessage] = useState('POPLUR PET\nWhat shall we do today?')
  const [burst, setBurst] = useState(0)
  const action = ACTIONS[selected]
  const mood = useMemo(() => {
    const average = Object.values(stats).reduce((sum, value) => sum + value, 0) / Object.values(stats).length
    return average > 78 ? 'SUPER HAPPY' : average > 55 ? 'HAPPY' : 'NEEDS YOU'
  }, [stats])

  const move = (delta: number) => {
    playPop()
    setSelected(value => (value + delta + ACTIONS.length) % ACTIONS.length)
  }

  const confirm = () => {
    playPop()
    setStats(current => {
      const next = { ...current }
      for (const [key, amount] of Object.entries(action.stats)) {
        const stat = key as keyof Stats
        next[stat] = Math.max(0, Math.min(100, next[stat] + amount))
      }
      window.localStorage.setItem('poplur.poplurgatchi.stats', JSON.stringify(next))
      return next
    })
    setMessage(action.message)
    setBurst(value => value + 1)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); confirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={styles.game} aria-label="Playable Poplurgatchi game">
      <div className={styles.device}>
        <img
          className={styles.deviceImage}
          src="games/poplurgatchi/assets/device-rainbow.webp"
          alt="Poplurgatchi virtual pet"
          draggable={false}
        />

        <div
          className={styles.selection}
          style={{
            ['--select-x' as string]: `${33 + (selected % 4) * 11.7}%`,
            ['--select-y' as string]: `${36.7 + Math.floor(selected / 4) * 28.2}%`,
          }}
          aria-hidden="true"
        />

        <div className={styles.dialog} aria-live="polite">
          <strong>{action.name.toUpperCase()} · {mood}</strong>
          <span>{message}</span>
        </div>

        <div key={burst} className={burst ? styles.burst : styles.burstIdle} aria-hidden="true">
          <span>♥</span><span>✦</span><span>♥</span>
        </div>

        <button className={`${styles.control} ${styles.previous}`} onClick={() => move(-1)} aria-label="Previous care action" />
        <button className={`${styles.control} ${styles.confirm}`} onClick={confirm} aria-label={`Choose ${action.name}`} />
        <button className={`${styles.control} ${styles.next}`} onClick={() => move(1)} aria-label="Next care action" />

        <div className={styles.stats} aria-label="Poplurgatchi status">
          <span>FOOD {stats.hunger}</span>
          <span>HAPPY {stats.happiness}</span>
          <span>ENERGY {stats.energy}</span>
          <span>CLEAN {stats.clean}</span>
          <span>HEALTH {stats.health}</span>
        </div>
      </div>
    </div>
  )
}
