import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './GamesScreen.module.css'
import PoplurgatchiPlayable from './PoplurgatchiPlayable'
import ArcadeScreen from './ArcadeScreen'
import { playPop } from './pop'
import { PoplurPerformanceManager, type PoplurPerformanceSnapshot } from './poplurPerformanceManager'
import {
  dropAt,
  formatCoords,
  onPostedContentChange,
  pickUp,
  postingFor,
  radiusKmFor,
} from './postedContent'
import { HOME } from './reach'
import StationControllerModel from './StationControllerModel'
import StationBootModel from './StationBootModel'
import {
  loadGameDirector,
  offlineGameDirector,
  type GameDirectorSession,
} from './gameDirector'
import {
  POPLUR_GAME_CONTROLLER_INPUT,
  dispatchGameControllerInput,
  gameControllerAxisAt,
  gameControllerDirection,
  gameControllerRegionAt,
  isGameControllerInputDetail,
  type GameControllerInputDetail,
  type GameControllerRegion,
} from './gameControllerInput'

interface Game {
  id: 'fps' | 'poplurgatchi' | 'arcade'
  title: string
  subtitle: string
  color: string
  preview: string
  web?: string
}

type FpsState = 'loading' | 'menu' | 'zoom' | 'playing' | 'paused' | 'dead' | 'win' | 'levelclear'
type FpsControl = 'move' | 'look' | 'fire' | 'interact' | 'pause' | 'weaponNext'

const GAMES: Game[] = [
  {
    id: 'poplurgatchi',
    title: 'Poplurgatchi',
    subtitle: 'Living virtual pet — care, quests & growth',
    color: '#ff389e',
    preview: 'games/poplurgatchi/assets/device-rainbow.webp',
  },
  {
    id: 'arcade',
    title: 'Poplur Boy',
    subtitle: 'Cinder Isles — explore, battle & collect',
    color: '#b06cf0',
    // The shell art doubles as the cover: it IS the product, and a separate
    // key-art file would be one more thing to keep in step with the skins.
    preview: 'games/arcade/shells/galaxy_purple.png',
  },
  {
    id: 'fps',
    title: 'FPS Shooter',
    subtitle: 'Adaptive three-mission neon shooter',
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

interface ControllerPointer {
  region: GameControllerRegion
  x: number
  y: number
  repeatTimer: number | null
  repeatsLeft: number
}

/** The supplied controller GLB is the control surface.
 *
 * It was previously hidden and replaced by visible HTML sticks/buttons, then
 * later by an invisible gesture layer on the app's navigation cube. The asset
 * is a flattened mesh with no named button nodes, so this component performs
 * one normalised hit test on the model itself. Nothing is drawn over it.
 */
function StationController3D({ enabled, state }: { enabled: boolean; state: FpsState }) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, ControllerPointer>())
  const [pressedCount, setPressedCount] = useState(0)

  const point = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return null
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    }
  }, [])

  const emitAxis = useCallback((pointer: ControllerPointer, repeated = false) => {
    if (pointer.region.kind !== 'axis') return
    const axis = gameControllerAxisAt(pointer.region, pointer.x, pointer.y)
    dispatchGameControllerInput({
      source: 'poplurstation-3d',
      control: pointer.region.control,
      pressed: axis.x !== 0 || axis.y !== 0,
      x: axis.x,
      y: axis.y,
      repeated,
    })
  }, [])

  const stopRepeat = useCallback((pointer: ControllerPointer) => {
    if (pointer.repeatTimer !== null) window.clearTimeout(pointer.repeatTimer)
    pointer.repeatTimer = null
  }, [])

  const scheduleRepeat = useCallback((pointerId: number, delay = 280) => {
    const pointer = pointers.current.get(pointerId)
    if (!pointer || pointer.region.kind !== 'axis' || pointer.region.control === 'look') return
    stopRepeat(pointer)
    pointer.repeatTimer = window.setTimeout(() => {
      const current = pointers.current.get(pointerId)
      if (!current || current.repeatsLeft <= 0) return
      current.repeatsLeft -= 1
      emitAxis(current, true)
      scheduleRepeat(pointerId, 110)
    }, delay)
  }, [emitAxis, stopRepeat])

  const releasePointer = useCallback((pointerId: number) => {
    const pointer = pointers.current.get(pointerId)
    if (!pointer) return
    pointers.current.delete(pointerId)
    stopRepeat(pointer)
    if (pointer.region.kind === 'axis') {
      dispatchGameControllerInput({
        source: 'poplurstation-3d', control: pointer.region.control,
        pressed: false, x: 0, y: 0,
      })
    } else {
      dispatchGameControllerInput({
        source: 'poplurstation-3d', control: pointer.region.control, pressed: false,
      })
    }
    setPressedCount(pointers.current.size)
  }, [stopRepeat])

  const releaseAll = useCallback(() => {
    for (const pointerId of [...pointers.current.keys()]) releasePointer(pointerId)
  }, [releasePointer])

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) releaseAll() }
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibility)
      releaseAll()
    }
  }, [releaseAll])

  return (
    <div
      ref={surfaceRef}
      className={styles.stationController}
      data-controller-ready={enabled ? 'true' : 'false'}
      data-controller-pressed={pressedCount > 0 ? 'true' : 'false'}
      data-game-state={state}
      role="application"
      aria-label="Interactive PoplurStation 3D controller. Left pad moves, right stick looks, face and shoulder buttons act."
      onPointerDown={event => {
        if (!enabled || pointers.current.has(event.pointerId)) return
        const p = point(event.clientX, event.clientY)
        const region = p && gameControllerRegionAt(p.x, p.y)
        if (!p || !region) return
        event.preventDefault()
        playPop(0.22)
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* best effort */ }
        const pointer: ControllerPointer = {
          region, x: p.x, y: p.y, repeatTimer: null, repeatsLeft: 48,
        }
        pointers.current.set(event.pointerId, pointer)
        setPressedCount(pointers.current.size)
        if (region.kind === 'axis') {
          emitAxis(pointer)
          scheduleRepeat(event.pointerId)
        } else {
          dispatchGameControllerInput({
            source: 'poplurstation-3d', control: region.control, pressed: true,
          })
        }
      }}
      onPointerMove={event => {
        const pointer = pointers.current.get(event.pointerId)
        if (!pointer || pointer.region.kind !== 'axis') return
        const p = point(event.clientX, event.clientY)
        if (!p) return
        pointer.x = p.x
        pointer.y = p.y
        emitAxis(pointer)
        event.preventDefault()
      }}
      onPointerUp={event => {
        releasePointer(event.pointerId)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={event => releasePointer(event.pointerId)}
      onLostPointerCapture={event => releasePointer(event.pointerId)}
      onContextMenu={event => event.preventDefault()}
    >
      <img
        className={styles.controllerPoster}
        src="games/poplurstation/controller-poster-v2.png"
        alt=""
        draggable={false}
        aria-hidden="true"
      />
      <StationControllerModel className={styles.controllerModel} />
    </div>
  )
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
  const [bootLeaving, setBootLeaving] = useState(false)
  const [fpsState, setFpsState] = useState<FpsState>('loading')
  const [controllerReady, setControllerReady] = useState(false)
  const [fpsFrameRequested, setFpsFrameRequested] = useState(false)
  const [fpsFrameLive, setFpsFrameLive] = useState(false)
  const [directors, setDirectors] = useState<Partial<Record<Game['id'], GameDirectorSession>>>({})
  const bootTimer = useRef<number | null>(null)
  const bootCeiling = useRef<number | null>(null)
  const bootDismiss = useRef<number | null>(null)
  const directorRequest = useRef<AbortController | null>(null)
  const gameFrameRef = useRef<HTMLIFrameElement>(null)
  const controllerDirection = useRef<ReturnType<typeof gameControllerDirection>>(null)
  const fpsMoveAxis = useRef({ x: 0, y: 0 })
  const fpsDpadAxis = useRef({ x: 0, y: 0 })
  const autoLaunchHandled = useRef(false)
  const game = GAMES[selected]

  // Games run full-bleed (GamesScreen.module.css .stage), but HomeTwin's
  // wordmark and bottom stat row still sit above every subscreen so the cube
  // stays a reachable way out — which meant they sat on top of the console art
  // for as long as this screen was open. Ask HomeTwin to clear them for the
  // whole time GamesScreen is mounted (list and running alike); the cube
  // itself is untouched by this event, so it is never lost. The cleanup ALWAYS
  // fires, or leaving via a route other than onClose would strand home with a
  // muted HUD.
  useEffect(() => {
    // Deferred: mount effects run child-before-parent, so a same-commit mount
    // (GamesScreen resumed at boot, inside HomeTwin's own first render) would
    // dispatch this before HomeTwin's listener exists otherwise. A macrotask
    // lands after that first commit's effects, listener included, every time.
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('poplur-games-chrome-mute', { detail: { on: true } }))
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.dispatchEvent(new CustomEvent('poplur-games-chrome-mute', { detail: { on: false } }))
    }
  }, [])

  const focus = (index: number) => {
    setSelected((index + GAMES.length) % GAMES.length)
    playPop()
  }

  const launch = (g: Game) => {
    playPop()
    directorRequest.current?.abort()
    const request = new AbortController()
    directorRequest.current = request
    // Gameplay never waits on the network. A reviewed preset is available on
    // the first render, then a signed-in AI session replaces it if the bounded
    // server request succeeds.
    const reviewedPreset = offlineGameDirector(g.id)
    setDirectors(current => ({
      ...current,
      [g.id]: current[g.id]?.day === reviewedPreset.day ? current[g.id] : reviewedPreset,
    }))
    void loadGameDirector(g.id, { signal: request.signal }).then(session => {
      if (request.signal.aborted) return
      setDirectors(current => ({ ...current, [g.id]: session }))
    })
    setBootElapsed(false)
    setBootLeaving(false)
    setFpsState('loading')
    setControllerReady(false)
    const allowFpsFrame = g.id === 'fps'
      && PoplurPerformanceManager.snapshot.isForeground
      && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed
    setFpsFrameRequested(g.id === 'fps')
    setFpsFrameLive(allowFpsFrame)
    // Embedded games report readiness from iframe.onLoad. Poplurgatchi is a
    // local React game, so it is ready as soon as this render mounts it; making
    // it wait for an iframe event it can never emit kept the boot card up until
    // the 12-second emergency ceiling.
    setFrameReady(!g.web)
    // Poplur Boy boots ITSELF: the handheld blacks its panel, drops the mark and
    // chimes. Showing the Station card over that meant two boots racing, and the
    // card (2.2s) outlasted the handheld's (1.5s + hold), so the one you actually
    // saw was the card and the shell's boot was over before it lifted.
    setBooting(g.id === 'arcade' ? null : g)
    if (bootTimer.current) window.clearTimeout(bootTimer.current)
    if (bootCeiling.current) window.clearTimeout(bootCeiling.current)
    if (bootDismiss.current) {
      window.clearTimeout(bootDismiss.current)
      bootDismiss.current = null
    }
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

  // `/games/fps/index.html` is the raw raycasting engine. A direct visit hands
  // off here so the actual PoplurStation controller remains the sole visible
  // input surface; the iframe below then reloads the engine in raw/embed mode.
  useEffect(() => {
    if (autoLaunchHandled.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('launch') !== 'fps') return
    autoLaunchHandled.current = true
    const fps = GAMES.find(candidate => candidate.id === 'fps')
    if (fps) {
      launch(fps)
      // Direct-entry already spent a navigation on the handoff; do not make
      // it wait for a second ornamental minimum once the iframe says ready.
      setBootElapsed(true)
    }
    params.delete('launch')
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }, [])

  // Lift the boot card once the animation has played AND the game is up.
  useEffect(() => {
    if (!booting) return
    if (!bootElapsed || !frameReady || bootLeaving) return
    // Keep the game mounted under a very short release wipe instead of
    // snapping from firmware UI to gameplay on the readiness frame.
    setBootLeaving(true)
    bootDismiss.current = window.setTimeout(() => {
      setBooting(null)
      setBootLeaving(false)
      bootDismiss.current = null
    }, 260)
  }, [booting, bootElapsed, frameReady, bootLeaving])

  const quit = () => {
    playPop()
    directorRequest.current?.abort()
    directorRequest.current = null
    setRunning(null)
    setBooting(null)
    setBootElapsed(false)
    setBootLeaving(false)
    setFrameReady(false)
    setFpsState('loading')
    setControllerReady(false)
    setFpsFrameRequested(false)
    setFpsFrameLive(false)
    if (bootTimer.current) { window.clearTimeout(bootTimer.current); bootTimer.current = null }
    if (bootCeiling.current) { window.clearTimeout(bootCeiling.current); bootCeiling.current = null }
    if (bootDismiss.current) { window.clearTimeout(bootDismiss.current); bootDismiss.current = null }
  }

  const sendFpsControl = useCallback((control: FpsControl, values: Record<string, number | boolean> = {}) => {
    const target = gameFrameRef.current?.contentWindow
    if (!target) return
    target.postMessage({ type: 'poplur-fps-control', control, ...values }, '*')
  }, [])

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

  // The iframe owns the FPS runtime, but the signed server call stays in the
  // authenticated parent. Send only the validated session contract after the
  // engine reports ready; the game queues it for the next run rather than
  // changing combat underneath an active player.
  useEffect(() => {
    const director = directors.fps
    if (running?.id !== 'fps' || !controllerReady || !director) return
    gameFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-fps-director',
      session: director,
    }, '*')
  }, [controllerReady, directors.fps, running?.id])

  // The supplied 3D controller owns game input. Its single validated contract
  // is translated here at the game boundary: the FPS receives analog messages,
  // Cinder Isles receives its existing retro-button pulses, and Poplurgatchi
  // receives the same left/right/confirm keyboard contract it already exposes.
  useEffect(() => {
    if (!running) return
    const fireButtons = new Set<string>()
    const clamp = (value: number) => Math.max(-1, Math.min(1, value))
    const sendCombinedMove = () => {
      sendFpsControl('move', {
        x: clamp(fpsMoveAxis.current.x + fpsDpadAxis.current.x),
        y: clamp(fpsMoveAxis.current.y + fpsDpadAxis.current.y),
      })
    }
    const retroButton = (button: string, repeated = false) => {
      window.dispatchEvent(new CustomEvent('poplur-retro-button', { detail: { button, repeated } }))
    }
    const petKey = (key: 'ArrowLeft' | 'ArrowRight' | 'Enter') => {
      const code = key === 'Enter' ? 'Enter' : key
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
      window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }))
    }
    const localDirection = (detail: GameControllerInputDetail) => {
      const next = detail.pressed
        ? gameControllerDirection(detail.x ?? 0, detail.y ?? 0)
        : null
      const shouldPulse = next !== null && (next !== controllerDirection.current || detail.repeated === true)
      controllerDirection.current = next
      if (!shouldPulse) return
      if (running.id === 'arcade') retroButton(next, detail.repeated)
      else if (running.id === 'poplurgatchi') {
        petKey(next === 'left' || next === 'up' ? 'ArrowLeft' : 'ArrowRight')
      }
    }
    const onControllerInput = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!isGameControllerInputDetail(detail)) return

      if (detail.control === 'move' || detail.control === 'dpad') {
        if (running.id === 'fps') {
          const target = detail.control === 'move' ? fpsMoveAxis : fpsDpadAxis
          target.current = { x: detail.x ?? 0, y: detail.y ?? 0 }
          sendCombinedMove()
        } else {
          localDirection(detail)
        }
        return
      }
      if (detail.control === 'look') {
        if (running.id === 'fps') sendFpsControl('look', { x: detail.x ?? 0 })
        return
      }

      if (running.id === 'fps') {
        if (detail.control === 'a' || detail.control === 'rightTrigger') {
          if (detail.pressed) fireButtons.add(detail.control)
          else fireButtons.delete(detail.control)
          sendFpsControl('fire', { pressed: fireButtons.size > 0 })
        } else if ((detail.control === 'b' || detail.control === 'x' || detail.control === 'leftTrigger') && detail.pressed) {
          sendFpsControl('interact', { pressed: true })
        } else if ((detail.control === 'y' || detail.control === 'select') && detail.pressed) {
          sendFpsControl('weaponNext', { pressed: true })
        } else if (detail.control === 'start' && detail.pressed) {
          sendFpsControl(
            fpsState === 'playing' || fpsState === 'paused' ? 'pause' : 'interact',
            { pressed: true },
          )
        }
        return
      }

      if (!detail.pressed) return
      if (running.id === 'arcade') {
        const mapped = {
          a: 'a', b: 'b', x: 'b', y: 'select',
          leftTrigger: 'l', rightTrigger: 'r', start: 'start', select: 'select',
        }[detail.control]
        if (mapped) retroButton(mapped)
      } else if (running.id === 'poplurgatchi') {
        if (detail.control === 'a' || detail.control === 'rightTrigger' || detail.control === 'start' || detail.control === 'y') petKey('Enter')
        else if (detail.control === 'b' || detail.control === 'leftTrigger' || detail.control === 'select') petKey('ArrowLeft')
        else if (detail.control === 'x') petKey('ArrowRight')
      }
    }
    window.addEventListener(POPLUR_GAME_CONTROLLER_INPUT, onControllerInput)
    return () => {
      window.removeEventListener(POPLUR_GAME_CONTROLLER_INPUT, onControllerInput)
      controllerDirection.current = null
      fpsMoveAxis.current = { x: 0, y: 0 }
      fpsDpadAxis.current = { x: 0, y: 0 }
      if (running.id === 'fps') {
        sendFpsControl('move', { x: 0, y: 0 })
        sendFpsControl('look', { x: 0 })
        sendFpsControl('fire', { pressed: false })
      }
    }
  }, [fpsState, running, sendFpsControl])

  // The bundled FPS owns an unconditional rAF plus a deliberate 10fps hidden
  // interval. Its code runs inside the iframe, so pausing the parent visually
  // cannot stop it; the only reliable ownership boundary is retiring the
  // iframe. Recreate it only while the user is still on this running game and
  // the shared performance policy says video-backed work may run.
  useEffect(() => {
    if (running?.id !== 'fps' || !fpsFrameRequested) {
      setFpsFrameLive(false)
      return
    }
    const sync = (snapshot: PoplurPerformanceSnapshot) => {
      const live = snapshot.isForeground && snapshot.expensiveVideoBackedTexturesAllowed
      setFpsFrameLive(live)
      if (!live) {
        setControllerReady(false)
        setFpsState('loading')
      }
    }
    const stopPolicy = PoplurPerformanceManager.subscribe(sync)
    const retire = () => setFpsFrameLive(false)
    const onVisibility = () => { if (document.hidden) retire() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', retire)
    return () => {
      stopPolicy()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', retire)
    }
  }, [fpsFrameRequested, running?.id])

  useEffect(() => () => {
    directorRequest.current?.abort()
    if (bootTimer.current) window.clearTimeout(bootTimer.current)
    if (bootCeiling.current) window.clearTimeout(bootCeiling.current)
    if (bootDismiss.current) window.clearTimeout(bootDismiss.current)
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
  const bootComplete = bootElapsed && frameReady
  const bootCard = booting && (
    <div
      className={styles.boot}
      data-ready={bootComplete || undefined}
      data-leaving={bootLeaving || undefined}
      style={{ ['--accent' as string]: booting.color }}
    >
      <span className={styles.bootSrOnly} role="status" aria-live="polite" aria-atomic="true">
        {bootComplete
          ? `${booting.title} ready`
          : `Starting ${booting.title} on Poplur Station`}
      </span>
      <div className={styles.bootCenter} aria-hidden="true">
        <div className={styles.bootStage}>
          <StationBootModel className={styles.bootModel} />
          <span className={styles.bootShadow} />
        </div>
        <div className={styles.bootWordmark}>POPLURSTATION</div>
      </div>
    </div>
  )

  // ── running a game ────────────────────────────────────────────────────────
  if (running) {
    const director = directors[running.id] ?? offlineGameDirector(running.id)
    return (
      <div className={`${styles.stage} ${running.id === 'fps' ? styles.fpsStage : ''}`} style={{ ['--accent' as string]: running.color }}>
        {running.id === 'poplurgatchi' ? (
          <PoplurgatchiPlayable director={director} />
        ) : running.id === 'arcade' ? (
          <ArcadeScreen director={director} />
        ) : running.web && fpsFrameLive ? (
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
          <StationController3D enabled={controllerReady} state={fpsState} />
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

      {/* The featured card is a CARD now, not the whole viewport: the screen
          reads as a catalogue (the Apps-folder shape) and the hero is merely
          the focused row writ a little larger. */}
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

      <div className={styles.listWrap}>
        <span className={styles.listLabel}>YOUR GAMES</span>
        <div className={styles.list} role="list" aria-label="Games" data-clay-scroll>
          {GAMES.map((g, i) => (
            <GameRow
              key={g.id}
              game={g}
              focused={i === selected}
              onFocus={() => focus(i)}
              onPlay={() => launch(g)}
            />
          ))}
        </div>
      </div>

      {bootCard}
    </div>
  )
}

/** One game in the catalogue — the Apps-folder row shape: art, identity, and
 *  the two facts that make a game a POST rather than a file (the radius it
 *  reaches, and the ground it was left on). A game that has never been dropped
 *  says so — it has no reach, which is different from a reach of zero.
 */
function GameRow({ game, focused, onFocus, onPlay }: {
  game: Game
  focused: boolean
  onFocus: () => void
  onPlay: () => void
}) {
  // Re-read on every drop/move/pick-up rather than holding a copy: the ledger
  // and the postings are the truth, and a like landing elsewhere in the app
  // changes this row's radius without anything here being told directly.
  const [, bump] = useState(0)
  useEffect(() => onPostedContentChange(() => bump(n => n + 1)), [])

  const posting = postingFor('game', game.id)
  const reachKm = radiusKmFor('game', game.id)

  const toggleGround = (event: React.MouseEvent) => {
    // The row itself focuses the hero; this control must not also do that.
    event.stopPropagation()
    playPop()
    if (posting) pickUp('game', game.id)
    // No live fix here yet, so HOME stands in — the same origin the apps
    // folder and musicPosts use, so every distance still agrees.
    else dropAt('game', game.id, HOME)
    bump(n => n + 1)
  }

  return (
    <div
      className={`${styles.row} ${focused ? styles.rowOn : ''}`}
      role="listitem"
      tabIndex={0}
      style={{ ['--accent' as string]: game.color }}
      onClick={onFocus}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        // Stop here or the window-level handler launches the FOCUSED game on
        // the same keystroke, which need not be the row the keyboard is on.
        event.stopPropagation()
        onPlay()
      }}
    >
      <span className={styles.rowArt} aria-hidden="true">
        <Cover game={game} size="tile" />
      </span>

      <span className={styles.rowInfo}>
        <b className={styles.rowTitle}>{game.title}</b>
        <i className={styles.rowSub}>{game.subtitle}</i>
        <span className={styles.rowStatus}>
          <span className={styles.rowRadius} data-unposted={reachKm == null ? 'true' : 'false'}>
            {reachKm == null ? 'Not posted' : `${reachKm.toFixed(1)} km radius`}
          </span>
          {posting && posting.place && <span className={styles.rowPlace}>{posting.place}</span>}
          {posting && <span className={styles.rowCoords}>{formatCoords(posting.coords)}</span>}
        </span>
      </span>

      <span className={styles.rowActions}>
        <button
          type="button"
          className={styles.rowPlay}
          onClick={event => { event.stopPropagation(); onPlay() }}
        >
          <span className={styles.playTri}>▶</span> PLAY
        </button>
        <button
          type="button"
          className={styles.dropBtn}
          data-posted={posting ? 'true' : 'false'}
          onClick={toggleGround}
        >
          {posting ? 'Pick up' : 'Drop here'}
        </button>
      </span>
    </div>
  )
}
