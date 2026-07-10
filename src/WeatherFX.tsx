import React, { useMemo } from 'react'
import styles from './WeatherFX.module.css'

export type WeatherMode = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog'

export function modeForCode(code: number): WeatherMode {
  if (code <= 1) return 'clear'
  if (code === 45 || code === 48) return 'fog'
  if (code <= 3) return 'cloudy'
  if (code >= 95) return 'storm'
  if (code >= 71 && code <= 86) return 'snow'
  return 'rain'
}

const CLOUD = `<svg viewBox="0 0 96 56" xmlns="http://www.w3.org/2000/svg"><ellipse cx="30" cy="38" rx="22" ry="14" fill="#FFF2F8"/><ellipse cx="56" cy="32" rx="26" ry="17" fill="#FFF2F8"/><ellipse cx="74" cy="40" rx="16" ry="11" fill="#f4e4ee"/><ellipse cx="42" cy="24" rx="18" ry="13" fill="#fff"/></svg>`

interface Particle { left: number; delay: number; duration: number; scale: number }

function makeParticles(count: number, seed: number): Particle[] {
  // Deterministic pseudo-random so React renders stay stable
  let s = seed
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  return Array.from({ length: count }, () => ({
    left: rand() * 100,
    delay: rand() * 4,
    duration: 0.6 + rand() * 0.9,
    scale: 0.6 + rand() * 0.8,
  }))
}

export default function WeatherFX({ mode }: { mode: WeatherMode }) {
  const drops = useMemo(() => makeParticles(46, 7), [])
  const flakes = useMemo(() => makeParticles(36, 13), [])

  if (mode === 'clear') return null

  return (
    <div className={styles.layer} aria-hidden="true">
      {(mode === 'rain' || mode === 'storm') && (
        <div className={mode === 'storm' ? styles.stormDim : undefined}>
          {drops.map((d, i) => (
            <span
              key={i}
              className={styles.drop}
              style={{
                left: `${d.left}%`,
                animationDelay: `${d.delay}s`,
                animationDuration: `${d.duration}s`,
                transform: `scale(${d.scale})`,
              }}
            />
          ))}
        </div>
      )}

      {mode === 'storm' && <div className={styles.lightning} />}

      {mode === 'snow' && flakes.map((f, i) => (
        <span
          key={i}
          className={styles.flake}
          style={{
            left: `${f.left}%`,
            animationDelay: `${f.delay * 1.8}s`,
            animationDuration: `${2.4 + f.duration * 2.6}s`,
            width: 5 + f.scale * 6,
            height: 5 + f.scale * 6,
          }}
        />
      ))}

      {(mode === 'cloudy' || mode === 'storm') && (
        <>
          <div className={`${styles.cloud} ${styles.cloudA}`} dangerouslySetInnerHTML={{ __html: CLOUD }} />
          <div className={`${styles.cloud} ${styles.cloudB}`} dangerouslySetInnerHTML={{ __html: CLOUD }} />
          <div className={`${styles.cloud} ${styles.cloudC}`} dangerouslySetInnerHTML={{ __html: CLOUD }} />
        </>
      )}

      {mode === 'fog' && <div className={styles.fog} />}
    </div>
  )
}
