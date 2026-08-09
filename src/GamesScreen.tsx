import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ModelViewerElement } from '@google/model-viewer'
import styles from './GamesScreen.module.css'
import PoplurgatchiPlayable from './PoplurgatchiPlayable'
import { playPop } from './pop'

// The optimized PoplurStation GLBs use EXT_meshopt_compression. model-viewer
// owns a separate loader from CubeTab3D, so it needs its own local decoder
// location before the first console/controller element is created.
ModelViewerElement.meshoptDecoderLocation = `${import.meta.env.BASE_URL}meshopt_decoder.js`

interface Game {
  id: 'fps' | 'poplurgatchi'
  title: string
  subtitle: string
  color: string
  preview: string
  web?: string
}

type FpsState = 'loading' | 'menu' | 'zoom' | 'playing' | 'paused' | 'dead' | 'win'
type FpsControl = 'move' | 'look' | 'fire' | 'interact' | 'pause' | 'weaponNext'

interface AnalogStickProps {
  className: string
  label: string
  onChange: (x: number, y: number) => void
}

function AnalogStick({ className, label, onChange }: AnalogStickProps) {
  const pointer = useRef<number | null>(null)
  const thumb = useRef<HTMLSpanElement>(null)

  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const rawX = event.clientX - rect.left - rect.width / 2
    const rawY = event.clientY - rect.top - rect.height / 2
    const limit = rect.width * 0.3
    const magnitude = Math.hypot(rawX, rawY)
    const scale = magnitude > limit ? limit / magnitude : 1
    const x = rawX * scale
    const y = rawY * scale
    if (thumb.current) thumb.current.style.transform = `translate(${x}px, ${y}px)`
    const deadZone = 0.1
    const normalize = (value: number) => {
      const unit = Math.max(-1, Math.min(1, value / limit))
      if (Math.abs(unit) < deadZone) return 0
      return (unit - Math.sign(unit) * deadZone) / (1 - deadZone)
    }
    onChange(normalize(x), -normalize(y))
    event.preventDefault()
  }

  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return
    pointer.current = null
    if (thumb.current) thumb.current.style.transform = ''
    onChange(0, 0)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className={`${styles.controllerStick} ${className}`}
      role="slider"
      aria-label={label}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      tabIndex={0}
      onPointerDown={event => {
        pointer.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        update(event)
      }}
      onPointerMove={update}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={event => {
        if (pointer.current === event.pointerId) {
          pointer.current = null
          if (thumb.current) thumb.current.style.transform = ''
          onChange(0, 0)
        }
      }}
    >
      <span ref={thumb} className={styles.controllerStickThumb} aria-hidden="true" />
    </div>
  )
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
    // approved-arcade, not approved-gameplay: 59eb531 deleted the gameplay
    // still and left this path dangling, which is why the FPS tile rendered as
    // an empty black square next to Poplurgatchi's full art. Arcade is the
    // reference the catalog tracks for this game.
    preview: 'games/fps/reference/approved-arcade.webp',
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

function StationModel({ kind, className, spinning = false }: { kind: 'console' | 'controller'; className: string; spinning?: boolean }) {
  return React.createElement('model-viewer', {
    class: className,
    src: `games/poplurstation/${kind}.glb`,
    alt: `PoplurStation ${kind}`,
    'camera-orbit': kind === 'console' ? '30deg 72deg 2.8m' : '0deg 72deg 2.4m',
    'field-of-view': '28deg',
    exposure: '1.1',
    shadowIntensity: '1',
    shadowSoftness: '0.75',
    'auto-rotate': spinning || undefined,
    'rotation-per-second': spinning ? '34deg' : undefined,
    interactionPrompt: 'none',
    disableZoom: true,
  })
}

export default function GamesScreen({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState(0)
  const [booting, setBooting] = useState<Game | null>(null)
  const [running, setRunning] = useState<Game | null>(null)
  // The boot screen used to be a blind 2200ms timer: it ended on a stopwatch
  // whether or not the game had loaded, so a heavy bundle (the FPS one is the
  // whole raycasting engine plus its sprites) booted straight into a blank
  // frame. The boot now ends when BOTH the animation has had its 2.2s AND the
  // game has actually reported load — with a ceiling so a game that never
  // fires `load` still starts rather than hanging on the boot screen forever.
  const [bootElapsed, setBootElapsed] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [fpsState, setFpsState] = useState<FpsState>('loading')
  const [controllerReady, setControllerReady] = useState(false)
  const bootTimer = useRef<number | null>(null)
  const bootCeiling = useRef<number | null>(null)
  const gameFrameRef = useRef<HTMLIFrameElement>(null)
  const game = GAMES[selected]

  const focus = (index: number) => {
    setSelected((index + GAMES.length) % GAMES.length)
    playPop()
  }

  const launch = (g: Game) => {
    playPop()
    setBootElapsed(false)
    setFpsState('loading')
    setControllerReady(false)
    // Embedded games report readiness from iframe.onLoad. Poplurgatchi is a
    // local React game, so it is ready as soon as this render mounts it; making
    // it wait for an iframe event it can never emit kept the boot card up until
    // the 12-second emergency ceiling.
    setFrameReady(!g.web)
    setBooting(g)
    if (bootTimer.current) window.clearTimeout(bootTimer.current)
    if (bootCeiling.current) window.clearTimeout(bootCeiling.current)
    // The game mounts NOW, behind the boot screen, so the boot animation is
    // the load rather than a delay in front of one.
    setRunning(g)
    bootTimer.current = window.setTimeout(() => {
      setBootElapsed(true)
      bootTimer.current = null
    }, 2200)
    // Never strand anyone on the boot card.
    bootCeiling.current = window.setTimeout(() => {
      setFrameReady(true)
      bootCeiling.current = null
    }, 12_000)
  }

  // Lift the boot card once the animation has played AND the game is up.
  useEffect(() => {
    if (!booting) return
    if (bootElapsed && frameReady) setBooting(null)
  }, [booting, bootElapsed, frameReady])

  const quit = () => {
    playPop()
    setRunning(null)
    setBooting(null)
    setBootElapsed(false)
    setFrameReady(false)
    setFpsState('loading')
    setControllerReady(false)
    if (bootTimer.current) { window.clearTimeout(bootTimer.current); bootTimer.current = null }
    if (bootCeiling.current) { window.clearTimeout(bootCeiling.current); bootCeiling.current = null }
  }

  const sendGameKey = useCallback((code: string, pressed: boolean) => {
    const target = gameFrameRef.current?.contentWindow
    if (!target) return
    const key = code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase()
    target.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
      code,
      key,
      bubbles: true,
      cancelable: true,
    }))
  }, [])

  const sendFpsControl = useCallback((control: FpsControl, values: Record<string, number | boolean> = {}) => {
    const target = gameFrameRef.current?.contentWindow
    if (!target) return
    target.postMessage({ type: 'poplur-fps-control', control, ...values }, '*')
  }, [])

  const holdControlProps = (control: 'fire' | 'interact') => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      sendFpsControl(control, { pressed: true })
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      sendFpsControl(control, { pressed: false })
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: () => sendFpsControl(control, { pressed: false }),
    onLostPointerCapture: () => sendFpsControl(control, { pressed: false }),
  })

  const pulseFpsControl = (control: 'pause' | 'weaponNext') => {
    sendFpsControl(control, { pressed: true })
    window.setTimeout(() => sendFpsControl(control, { pressed: false }), 100)
  }

  useEffect(() => {
    if (running?.id !== 'fps') return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== gameFrameRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplur-fps-ready') {
        setControllerReady(true)
        setFrameReady(true)
      } else if (event.data.type === 'poplur-fps-state' && typeof event.data.state === 'string') {
        setFpsState(event.data.state as FpsState)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [running?.id])

  useEffect(() => () => {
    if (bootTimer.current) window.clearTimeout(bootTimer.current)
    if (bootCeiling.current) window.clearTimeout(bootCeiling.current)
  }, [])

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

  // The boot card overlays whichever view is up, so it MUST live outside the
  // two returns below. It used to sit only in the games-list return — but
  // `launch` sets `running` and `booting` in the same batch, so the very next
  // render took the `running` early-return and the boot card was unreachable.
  // The game mounted bare and you saw exactly the blank first frame the boot
  // screen exists to cover: the fix that added it never actually ran.
  const bootCard = booting && (
    <div className={styles.boot} style={{ ['--accent' as string]: booting.color }}>
      <div className={styles.bootLogo} aria-label="PoplurStation">
        <StationModel kind="console" className={styles.bootConsole} spinning />
      </div>
      <span className={styles.bootWord}>Poplur <b>Station</b></span>
    </div>
  )

  // ── running a game ────────────────────────────────────────────────────────
  if (running) {
    return (
      <div className={`${styles.stage} ${running.id === 'fps' ? styles.fpsStage : ''}`} style={{ ['--accent' as string]: running.color }}>
        {running.id === 'poplurgatchi' ? (
          <PoplurgatchiPlayable />
        ) : running.web ? (
          <iframe
            ref={gameFrameRef}
            className={`${styles.gameFrame} ${running.id === 'fps' ? styles.fpsFrame : ''}`}
            src={`${running.web}?externalController=1`}
            title={running.title}
            allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
            allowFullScreen
            onLoad={() => {
              // The FPS reports ready only after its engine and textures are
              // initialized; iframe load alone is too early. Other web games
              // can still use the ordinary load event.
              if (running.id !== 'fps') setFrameReady(true)
            }}
          />
        ) : null}
        {running.id === 'fps' && (
          <div
            className={styles.stationController}
            data-controller-ready={controllerReady ? 'true' : 'false'}
            data-game-state={fpsState}
            aria-label="Interactive PoplurStation controller"
          >
            <StationModel kind="controller" className={styles.controllerModel} />
            <AnalogStick
              className={styles.moveStick}
              label="Move"
              onChange={(x, y) => sendFpsControl('move', { x, y })}
            />
            <AnalogStick
              className={styles.lookStick}
              label="Look"
              onChange={x => sendFpsControl('look', { x })}
            />
            <button
              type="button"
              className={styles.stationStart}
              aria-label="Start or use"
              title="Start / Use"
              {...holdControlProps('interact')}
            >◆</button>
            <button
              type="button"
              className={styles.stationFire}
              aria-label="Fire"
              title="Fire"
              {...holdControlProps('fire')}
            >●</button>
            <button
              type="button"
              className={styles.stationWeapon}
              aria-label="Next weapon"
              title="Next weapon"
              onClick={() => pulseFpsControl('weaponNext')}
            >↻</button>
            <button
              type="button"
              className={styles.stationPause}
              aria-label={fpsState === 'paused' ? 'Resume game' : 'Pause game'}
              title={fpsState === 'paused' ? 'Resume' : 'Pause'}
              onClick={() => pulseFpsControl('pause')}
            >{fpsState === 'paused' ? '▶' : 'Ⅱ'}</button>
          </div>
        )}
        {bootCard}
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

      {bootCard}
    </div>
  )
}
