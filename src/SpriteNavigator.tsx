import { useEffect, useRef, useState } from 'react'
import type { CubeTab3DProps } from './navigatorContract'
import { DEFAULT_CUBE_MODEL, TAB_ORDER } from './navigatorContract'
import spritesJSON from './navigatorSprites.json'
import { primeMotionAudio } from './motionEffectsAudio'
import { preloadPop, primePopAudio } from './pop'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import './SpriteNavigator.css'

export interface NavigatorSpriteFrame { yaw: number; pitch: number; src: string; face?: number }
const sprites = spritesJSON as Record<string, NavigatorSpriteFrame[]>
const IMAGE_URL = /\.(avif|png|webp|jpe?g)(?:[?#].*)?$/i
const labels = { map: 'Map', feed: 'Feed', profile: 'Profile', post: 'Camera' }

function spriteFrames(model: string): NavigatorSpriteFrame[] {
  if (sprites[model]) return sprites[model]
  // Card packs use an immutable CDN prefix in native builds, while the same
  // authored model lives beneath subscreens/ during local preview.
  const card = model.match(/(?:^|\/)store-models\/(poplur_card_[a-z_]+\.glb)(?:[?#].*)?$/)?.[1]
  return card ? sprites[`subscreens/store-models/${card}`] ?? [] : []
}

export function supportsNavigatorSprite(model = DEFAULT_CUBE_MODEL): boolean {
  return IMAGE_URL.test(model) || model.startsWith('data:image/') || spriteFrames(model).length > 0
}

export function nearestNavigatorFrame(frames: readonly NavigatorSpriteFrame[], yaw: number, pitch: number) {
  return frames.reduce<NavigatorSpriteFrame | undefined>((best, frame) =>
    !best || Math.hypot(frame.yaw - yaw, frame.pitch - pitch) < Math.hypot(best.yaw - yaw, best.pitch - pitch) ? frame : best, undefined)
}

/** Shared DOM navigator: pre-baked clay views, no WebGL or animation clock.
 * Visible tilt is input, so its sensor lease lasts as long as the control is
 * visible. Only a changed pose replaces the image; resting costs no paints. */
export default function SpriteNavigator(props: CubeTab3DProps) {
  const { targetTab, size = 200, modelUrl = DEFAULT_CUBE_MODEL, renderingVisible = true } = props
  const surface = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const callbacks = useRef(props); callbacks.current = props
  const [shown, setShown] = useState<{ model: string; src: string } | null>(null)
  const [pressed, setPressed] = useState(false)
  const frames = spriteFrames(modelUrl)
  // Reward faces are outcomes, not different viewing angles. Motion must
  // never replace a landed reward with another face from the sprite sheet.
  const frameRef = useRef(frames)
  const visibleFrames = props.diceRollFace ? frames.filter(frame => !frame.face || frame.face === props.diceRollFace) : frames
  frameRef.current = visibleFrames
  const neutralPitch = useRef<number>()
  const centre = IMAGE_URL.test(modelUrl) || modelUrl.startsWith('data:image/') ? modelUrl :
    nearestNavigatorFrame(visibleFrames, 0, 0)?.src

  useEffect(() => {
    if (!props.diceRollPulse || !renderingVisible || !image.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = image.current.animate([
      { transform: 'scale(.82) rotate(-28deg)' },
      { transform: 'scale(1.12) rotate(35deg)', offset: 0.35 },
      { transform: 'scale(.96) rotate(-12deg)', offset: 0.7 },
      { transform: 'scale(1) rotate(0)' },
    ], { duration: reduced ? 240 : 960, easing: 'ease-out', iterations: 1 })
    return () => animation.cancel()
  }, [props.diceRollPulse, renderingVisible])

  useEffect(() => { preloadPop() }, [])
  useEffect(() => {
    let cancelled = false
    if (!centre) {
      console.error(`[SpriteNavigator] missing baked model: ${modelUrl}`)
      return
    }
    const next = new Image()
    next.src = centre
    next.decode().then(() => {
      if (cancelled) return
      setShown({ model: modelUrl, src: centre })
      callbacks.current.onModelReady?.(modelUrl)
    }).catch(() => { if (!cancelled) console.error(`[SpriteNavigator] could not decode ${modelUrl}`) })
    return () => { cancelled = true; next.removeAttribute('src') }
  }, [modelUrl, centre])

  useEffect(() => {
    const nextURL = props.prepareModelUrl
    const src = nextURL && (IMAGE_URL.test(nextURL) ? nextURL : nearestNavigatorFrame(spriteFrames(nextURL), 0, 0)?.src)
    if (!src) return
    const next = new Image(); next.src = src
    return () => next.removeAttribute('src')
  }, [props.prepareModelUrl])

  useEffect(() => {
    if (!renderingVisible || !shown) return
    let nativeActive = window.__poplurNativeAppActive !== false
    let lastPoseAt = -Infinity
    let lastFrame: NavigatorSpriteFrame | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const eligible = () => !document.hidden && nativeActive
    const setPose = (yaw: number, pitch: number) => {
      if (!eligible() || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return
      const now = performance.now()
      if (now - lastPoseAt < 80) return
      lastPoseAt = now
      yaw = Math.max(-24, Math.min(24, yaw))
      pitch = Math.max(-16, Math.min(16, pitch))
      const next = nearestNavigatorFrame(frameRef.current, yaw, pitch)
      // A little hysteresis keeps sensor noise at a view boundary from
      // repeatedly decoding/painting its two neighboring images.
      if (lastFrame && next && Math.hypot(lastFrame.yaw - yaw, lastFrame.pitch - pitch)
        < Math.hypot(next.yaw - yaw, next.pitch - pitch) + 1.5) return
      if (image.current && next && image.current.getAttribute('src') !== next.src) image.current.src = next.src
      lastFrame = next
    }
    const tilt = (roll: number, pitch: number) => {
      if (!eligible() || !Number.isFinite(roll) || !Number.isFinite(pitch)) return
      // Both hosts send radians, but Android gravity and Core Motion use
      // opposite pitch signs. Calibrate the comfortable hold on first input.
      const uprightPitch = Math.abs(pitch)
      neutralPitch.current ??= uprightPitch
      setPose(roll * 180 / Math.PI * 1.6, (uprightPitch - neutralPitch.current) * 180 / Math.PI * 0.6)
    }
    const nativeMotion = (event: Event) => {
      const { roll, pitch } = (event as CustomEvent<{ roll?: number; pitch?: number }>).detail ?? {}
      if (typeof roll === 'number' && typeof pitch === 'number') tilt(roll, pitch)
    }
    const deviceMotion = (event: DeviceOrientationEvent) => {
      if (event.gamma != null && event.beta != null) tilt(event.gamma * Math.PI / 180, event.beta * Math.PI / 180)
    }
    const report = (active: boolean) => {
      if (isNativeShell()) postNativeEvent({ type: 'navigatorMotionDemandChanged', active, aiming: false })
    }
    const park = () => {
      clearInterval(heartbeat); heartbeat = undefined
      neutralPitch.current = undefined
      report(false)
    }
    const sync = () => {
      if (!eligible()) { park(); return }
      lastPoseAt = -Infinity
      report(true)
      // Renew iOS's six-second safety lease, never a rendering clock. If
      // WebKit suspends, native still expires the lease without a final event.
      if (isNativeShell() && !heartbeat) heartbeat = setInterval(() => {
        if (eligible()) report(true)
        else park()
      }, 2_000)
    }
    const lifecycle = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active
      if (typeof active !== 'boolean') return
      nativeActive = active
      sync()
    }
    window.addEventListener('poplur-native-motion', nativeMotion)
    if (!isNativeShell()) window.addEventListener('deviceorientation', deviceMotion, { passive: true })
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('poplur-native-app-lifecycle', lifecycle)
    sync()
    return () => {
      park()
      window.removeEventListener('poplur-native-motion', nativeMotion)
      window.removeEventListener('deviceorientation', deviceMotion)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('poplur-native-app-lifecycle', lifecycle)
    }
  }, [renderingVisible, shown])

  useEffect(() => {
    const node = surface.current
    if (!node || !renderingVisible) return
    let start: { x: number; y: number; lastY: number; at: number; scroll: Element | null } | null = null
    let held = false, moved = false, scrolling = false
    let hold: ReturnType<typeof setTimeout> | undefined
    let pendingTap: ReturnType<typeof setTimeout> | undefined
    const cancelHold = () => { clearTimeout(hold); hold = undefined }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return
      primeMotionAudio(); primePopAudio()
      const rect = node.getBoundingClientRect()
      const onObject = Math.hypot(event.clientX - rect.x - rect.width / 2, event.clientY - rect.y - rect.height / 2) <= rect.width * 0.34
      const scroll = onObject ? null : document.elementsFromPoint(event.clientX, event.clientY).find(el =>
        el !== node && !el.contains(node) && el.scrollHeight - el.clientHeight > 8 && /auto|scroll/.test(getComputedStyle(el).overflowY)) ?? null
      start = { x: event.clientX, y: event.clientY, lastY: event.clientY, at: performance.now(), scroll }
      held = false; moved = false; scrolling = false; setPressed(true)
      try { node.setPointerCapture(event.pointerId) } catch { /* synthetic event */ }
      hold = setTimeout(() => { held = true; setPressed(false); callbacks.current.onHold() }, 500)
    }
    const move = (event: PointerEvent) => {
      if (!start || held) return
      const dx = event.clientX - start.x, dy = event.clientY - start.y
      if (Math.hypot(dx, dy) > 8) { moved = true; cancelHold(); setPressed(false) }
      if (start.scroll && moved && Math.abs(dy) > Math.abs(dx)) scrolling = true
      if (scrolling && start.scroll) start.scroll.scrollTop -= event.clientY - start.lastY
      start.lastY = event.clientY
    }
    const up = (event: PointerEvent) => {
      cancelHold(); setPressed(false)
      const gesture = start; start = null
      if (!gesture || held || scrolling) return
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
      if (!moved && Math.hypot(dx, dy) <= 8) {
        if (performance.now() - gesture.at >= 350) return
        const cb = callbacks.current
        if (cb.onDoubleTap && (cb.doubleTapWindowMs ?? 0) > 0) {
          if (pendingTap) { clearTimeout(pendingTap); pendingTap = undefined; cb.onDoubleTap() }
          else pendingTap = setTimeout(() => { pendingTap = undefined; callbacks.current.onTap() }, cb.doubleTapWindowMs)
        } else cb.onTap()
        return
      }
      const vertical = Math.abs(dy) > Math.abs(dx)
      if (Math.abs(vertical ? dy : dx) < 28) return
      if (vertical) callbacks.current.onVerticalSwipe?.(dy < 0 ? 1 : -1)
      else {
        const index = TAB_ORDER.indexOf(callbacks.current.targetTab)
        callbacks.current.onFaceChange(TAB_ORDER[(index + (dx < 0 ? 1 : -1) + TAB_ORDER.length) % TAB_ORDER.length])
      }
    }
    const cancel = () => { cancelHold(); start = null; setPressed(false) }
    const click = (event: MouseEvent) => {
      // VoiceOver and other assistive activation can dispatch a click with
      // no pointer sequence. Pointer clicks already ran the gesture handler.
      if (event.detail === 0) callbacks.current.onTap()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacks.current.onTap() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const index = TAB_ORDER.indexOf(callbacks.current.targetTab)
        callbacks.current.onFaceChange(TAB_ORDER[(index + (event.key === 'ArrowRight' ? 1 : -1) + TAB_ORDER.length) % TAB_ORDER.length])
      }
    }
    node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cancel); node.addEventListener('keydown', key)
    node.addEventListener('click', click)
    return () => {
      cancelHold(); clearTimeout(pendingTap)
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cancel); node.removeEventListener('keydown', key)
      node.removeEventListener('click', click)
    }
  }, [renderingVisible])

  return <div ref={surface} role="button" tabIndex={0} data-cube-renderer="sprite" data-cube-model={shown?.model}
    aria-label={`${labels[targetTab]} navigator — swipe to switch tabs, tap to open, hold for menu`}
    style={{ position: 'relative', width: size, height: size, touchAction: 'none', cursor: 'grab' }}>
    {shown && <img ref={image} src={shown.src} alt="" draggable={false} data-poplur-navigator-sprite=""
      style={{ width: size, height: size, objectFit: 'contain', pointerEvents: 'none', transform: pressed ? 'scale(.96)' : undefined }} />}
    {props.camcorderRecording && <span aria-label="Recording" style={{ position: 'absolute', top: '37%', right: '31%', width: 5, height: 5, borderRadius: '50%', background: '#ff253f', boxShadow: '0 0 5px #ff253f' }} />}
    {props.cameraFlashArmed && <span aria-label="Flash on" style={{ position: 'absolute', top: '39%', left: '29%', width: 18, height: 8, borderRadius: 2, background: '#fff9de', boxShadow: '0 0 5px #fff9de' }} />}
    {Boolean(props.cameraFlashPulse) && <span key={props.cameraFlashPulse} className="poplur-sprite-shutter" aria-hidden="true" />}
  </div>
}
