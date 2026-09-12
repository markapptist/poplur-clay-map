import React, { useEffect, useMemo, useState } from 'react'
import styles from './WeatherFX.module.css'
import { modelSprite } from './modelSprite'
import { startWeatherAudio, stopWeatherAudio, playThunder } from './weatherAudio'
import { isGateMuted, onGateChange } from './audioGate'
import { ambientAllowed, onAmbientSleepChange } from './frameGovernor'
import { createWeatherLightningScheduler } from './weatherLightning'
import type { WeatherMode } from './weatherCode'

export { modeForCode } from './weatherCode'
export type { WeatherMode } from './weatherCode'

/** Modes that carry the drifting clay clouds overhead. */
const CLOUDY_MODES: WeatherMode[] = ['cloudy', 'rain', 'thunder', 'storm', 'hail', 'fog']
/** Modes that darken the scene like a heavy sky. */
const DIM_MODES: WeatherMode[] = ['thunder', 'storm', 'hail']

interface Particle { left: number; delay: number; duration: number; scale: number }

function makeParticles(count: number, seed: number): Particle[] {
  // Deterministic pseudo-random so React renders stay stable
  let s = seed
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  return Array.from({ length: count }, () => ({
    left: rand() * 100,
    // NEGATIVE, so every particle starts already in flight. Two things follow
    // that a positive delay did not give us. The storm is at full strength on
    // the first frame — a delay of up to 4s meant the native shell's 3s ambient
    // burst could expire before some drops had started at all. And every PAUSED
    // frame now holds the particle at a scattered on-screen position instead of
    // at its authored top:-30px, so anything that stops the motion (reduced
    // motion, low power, emergency) leaves static weather rather than clear
    // sky. Stopping the rain must never mean hiding the rain.
    delay: -rand() * 4,
    duration: 0.6 + rand() * 0.9,
    scale: 0.6 + rand() * 0.8,
  }))
}

export default function WeatherFX({ mode }: { mode: WeatherMode }) {
  // Every particle is its own composited layer riding WebKit's remote layer
  // tree — the device traces' "fewer layers" lever, applied to weather. The
  // shell tier thins the storm rather than cancelling it: a dozen flakes still
  // read as snow on a 6" screen, at a third of the layer bill. Browsers keep
  // the full show.
  const lite = typeof document !== 'undefined'
    && document.documentElement.classList.contains('tier-ios')
  const drops = useMemo(() => makeParticles(lite ? 16 : 46, 7), [lite])
  const flakes = useMemo(() => makeParticles(lite ? 12 : 36, 13), [lite])
  const stones = useMemo(() => makeParticles(38, 29), [])

  // The provided clay cloud GLB, rendered once to a transparent sprite.
  const [cloud, setCloud] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    // Defer the three.js render off the map's critical path: creating a second
    // WebGL context while Mapbox is still fetching its style can stall it.
    const id = window.setTimeout(() => {
      modelSprite('cloud.glb', { yaw: -18, pitch: 10, size: 512 })
        .then(url => { if (alive) setCloud(url) })
        .catch(() => { /* sprite unavailable — sky just stays clear */ })
    }, 3000)
    return () => { alive = false; window.clearTimeout(id) }
  }, [])

  // The visible weather must remain weather: rain continues falling and a
  // storm can still flash while the user is watching the map. Ambient idling
  // parks both its audio and sparse lightning timer; waking re-arms it.
  const [flashTick, setFlashTick] = useState(0)
  useEffect(() => {
    let sleeping = !ambientAllowed()
    let muted = isGateMuted()
    let hidden = document.visibilityState !== 'visible'
    let audioActive = false
    let visualActive = !hidden && !sleeping
    const lightning = createWeatherLightningScheduler({
      mode,
      onStrike: () => {
      setFlashTick(t => t + 1)
      if (audioActive) playThunder(0.55)
      },
    })
    const sync = () => {
      visualActive = !hidden && !sleeping
      const nextAudioActive = visualActive && !muted
      if (nextAudioActive !== audioActive) {
        audioActive = nextAudioActive
        if (audioActive) startWeatherAudio(mode)
        else stopWeatherAudio()
      }
      lightning.sync(visualActive)
    }
    const stopAmbient = onAmbientSleepChange(next => { sleeping = next; sync() })
    const stopGate = onGateChange(next => { muted = next; sync() })
    const onVisibility = () => { hidden = document.visibilityState !== 'visible'; sync() }
    document.addEventListener('visibilitychange', onVisibility)
    sync()
    return () => {
      visualActive = false
      audioActive = false
      lightning.dispose()
      stopWeatherAudio()
      stopAmbient()
      stopGate()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mode])

  if (mode === 'clear') return null

  const rains = mode === 'rain' || mode === 'thunder' || mode === 'storm'
  const dims = DIM_MODES.includes(mode)

  return (
    <div className={`${styles.layer} ${styles.weatherLayer}`} aria-hidden="true">
      {rains && (
        <div className={dims ? styles.stormDim : undefined}>
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

      {mode === 'hail' && (
        <div className={styles.stormDim}>
          {stones.map((s, i) => (
            <span
              key={i}
              className={styles.stone}
              style={{
                left: `${s.left}%`,
                animationDelay: `${s.delay * 0.5}s`,
                animationDuration: `${0.45 + s.duration * 0.35}s`,
                width: 5 + s.scale * 5,
                height: 5 + s.scale * 5,
              }}
            />
          ))}
        </div>
      )}

      {/* Lightning flash only on the full thunder-and-lightning storm.
          Remounted per strike (key) so the one-shot flash replays, whole
          screen, in sync with the thunder fired from the same tick. */}
      {(mode === 'thunder' || mode === 'storm') && flashTick > 0 && (
        <div key={flashTick} className={styles.lightning} />
      )}

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

      {cloud && CLOUDY_MODES.includes(mode) && (
        <>
          <img className={`${styles.cloud} ${styles.cloudA}`} src={cloud} alt="" />
          <img className={`${styles.cloud} ${styles.cloudB}`} src={cloud} alt="" />
          <img className={`${styles.cloud} ${styles.cloudC}`} src={cloud} alt="" />
        </>
      )}

      {mode === 'fog' && <div className={styles.fog} />}
    </div>
  )
}
