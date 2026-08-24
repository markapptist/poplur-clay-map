import { useEffect, useRef } from 'react'
import styles from './StudioSynthwave.module.css'

type StudioSynthwaveProps = {
  active: boolean
  energy: number
  levels: number[]
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const mod = (value: number, size: number) => ((value % size) + size) % size

/**
 * A lightweight live-input landscape. It consumes Studio's existing analyser
 * samples, so it never opens another AudioContext, requests the microphone, or
 * pretends to hear sound while capture is stopped.
 */
export default function StudioSynthwave({ active, energy, levels }: StudioSynthwaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeRef = useRef(active)
  const energyRef = useRef(energy)
  const levelsRef = useRef(levels)
  const drawRef = useRef<(now: number, advance: boolean, elapsedMs: number) => void>(() => {})
  const lastSampleRef = useRef(0)

  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { energyRef.current = energy }, [energy])
  useEffect(() => { levelsRef.current = levels }, [levels])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!context) return

    let width = 1
    let height = 1
    let pixelRatio = 1
    let phase = 0
    let smoothedEnergy = active ? clamp(energyRef.current) : 0.03
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let skyPaint: CanvasGradient | string = '#090318'
    let groundPaint: CanvasGradient | string = '#05020b'
    let frontMountainPaint: CanvasGradient | string = 'rgba(25, 7, 75, .86)'
    let backMountainPaint: CanvasGradient | string = 'rgba(35, 8, 72, .64)'
    let vignettePaint: CanvasGradient | string = 'rgba(2, 0, 8, .28)'

    const rebuildPaints = () => {
      const horizon = height * 0.56
      const sky = context.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, '#090318')
      sky.addColorStop(0.48, '#2b0b49')
      sky.addColorStop(0.68, '#160629')
      sky.addColorStop(1, '#05020b')
      skyPaint = sky

      const ground = context.createLinearGradient(0, horizon, 0, height)
      ground.addColorStop(0, 'rgba(27, 6, 60, .9)')
      ground.addColorStop(1, '#05020b')
      groundPaint = ground

      const front = context.createLinearGradient(0, horizon - height * 0.2, 0, horizon + 28)
      front.addColorStop(0, 'rgba(30, 36, 171, .56)')
      front.addColorStop(1, 'rgba(25, 7, 75, .86)')
      frontMountainPaint = front

      const back = context.createLinearGradient(0, horizon - height * 0.2, 0, horizon + 28)
      back.addColorStop(0, 'rgba(142, 28, 176, .25)')
      back.addColorStop(1, 'rgba(35, 8, 72, .64)')
      backMountainPaint = back

      const vignette = context.createRadialGradient(width * 0.5, height * 0.46, width * 0.12, width * 0.5, height * 0.46, width * 0.72)
      vignette.addColorStop(0, 'rgba(2, 0, 8, 0)')
      vignette.addColorStop(0.72, 'rgba(2, 0, 8, .08)')
      vignette.addColorStop(1, 'rgba(2, 0, 8, .7)')
      vignettePaint = vignette
    }

    const sampleLevel = (x: number) => {
      const history = levelsRef.current
      if (!history.length || width <= 1) return 0.04
      const ratio = mod(x, width) / width
      // New sound enters on the left; phase then carries that peak to the
      // right, exactly matching the landscape's travel direction.
      const index = Math.max(0, history.length - 1 - Math.floor(ratio * history.length))
      return clamp((history[index] ?? 4) / 110)
    }

    const mountainY = (x: number, horizon: number, layer: 'back' | 'front') => {
      const rate = layer === 'front' ? 1 : 0.48
      const shifted = x - phase * rate
      const coarse = 0.5 + 0.5 * Math.sin(shifted * 0.018 + (layer === 'front' ? 0.5 : 2.2))
      const detail = 0.5 + 0.5 * Math.sin(shifted * 0.043 + (layer === 'front' ? 1.7 : 0.2))
      const spike = Math.pow(Math.abs(Math.sin(shifted * 0.011 + (layer === 'front' ? 0.2 : 1.4))), 8)
      const audio = sampleLevel(shifted)
      const amplitude = height * (layer === 'front' ? 0.16 : 0.095)
      const audioLift = activeRef.current ? audio * (0.3 + smoothedEnergy * 1.05) : 0.03
      const shape = 0.2 + coarse * 0.25 + detail * 0.18 + spike * 0.44 + audioLift
      return horizon - amplitude * shape
    }

    const drawStars = (horizon: number) => {
      for (let i = 0; i < 28; i += 1) {
        const x = mod(i * 83 + i * i * 7 + phase * 0.12, width)
        const y = 18 + mod(i * i * 47 + i * 19, Math.max(24, horizon * 0.72))
        const radius = i % 5 === 0 ? 1.25 : 0.7
        context.fillStyle = i % 4 === 0 ? 'rgba(108, 229, 255, .78)' : 'rgba(255, 210, 239, .54)'
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
      }
    }

    const drawSun = (horizon: number) => {
      const radius = Math.min(width, height) * 0.145 + smoothedEnergy * 4
      const centerX = width * 0.5
      const centerY = horizon * 0.53
      const aura = context.createRadialGradient(centerX, centerY, radius * 0.4, centerX, centerY, radius * 1.65)
      aura.addColorStop(0, `rgba(255, 92, 177, ${0.3 + smoothedEnergy * 0.16})`)
      aura.addColorStop(0.58, 'rgba(232, 45, 153, .14)')
      aura.addColorStop(1, 'rgba(232, 45, 153, 0)')
      context.fillStyle = aura
      context.fillRect(centerX - radius * 1.7, centerY - radius * 1.7, radius * 3.4, radius * 3.4)

      context.save()
      context.beginPath()
      context.arc(centerX, centerY, radius, 0, Math.PI * 2)
      context.clip()
      const sun = context.createLinearGradient(0, centerY - radius, 0, centerY + radius)
      sun.addColorStop(0, '#fff75b')
      sun.addColorStop(0.46, '#ffc34e')
      sun.addColorStop(0.72, '#ff638e')
      sun.addColorStop(1, '#ef2ba6')
      context.fillStyle = sun
      context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2)
      context.fillStyle = 'rgba(37, 8, 55, .82)'
      for (let y = centerY + radius * 0.05; y < centerY + radius; y += 11) {
        const bandHeight = 2.5 + ((y - centerY) / radius) * 3.5
        context.fillRect(centerX - radius, y, radius * 2, bandHeight)
      }
      context.restore()
    }

    const drawMountain = (horizon: number, layer: 'back' | 'front') => {
      const step = layer === 'front' ? 12 : 16
      const points: Array<[number, number]> = []
      for (let x = -step; x <= width + step; x += step) points.push([x, mountainY(x, horizon, layer)])

      context.beginPath()
      context.moveTo(points[0][0], horizon + 22)
      for (const [x, y] of points) context.lineTo(x, y)
      context.lineTo(points[points.length - 1][0], horizon + 22)
      context.closePath()
      context.fillStyle = layer === 'front' ? frontMountainPaint : backMountainPaint
      context.fill()

      context.beginPath()
      points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
      context.strokeStyle = layer === 'front' ? 'rgba(27, 203, 255, .24)' : 'rgba(210, 72, 255, .18)'
      context.lineWidth = layer === 'front' ? 5 : 3
      context.stroke()
      context.strokeStyle = layer === 'front' ? 'rgba(49, 225, 255, .96)' : 'rgba(221, 80, 255, .55)'
      context.lineWidth = layer === 'front' ? 1.7 : 1
      context.stroke()

      context.lineWidth = layer === 'front' ? 0.75 : 0.55
      context.strokeStyle = layer === 'front' ? 'rgba(38, 220, 255, .62)' : 'rgba(210, 79, 255, .3)'
      for (let band = 1; band <= 3; band += 1) {
        const amount = band / 4
        context.beginPath()
        points.forEach(([x, top], index) => {
          const y = top + (horizon + 14 - top) * amount
          index ? context.lineTo(x, y) : context.moveTo(x, y)
        })
        context.stroke()
      }
      for (let index = 0; index < points.length; index += layer === 'front' ? 2 : 3) {
        const [x, y] = points[index]
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(x, horizon + 14)
        context.stroke()
      }
    }

    const drawGrid = (horizon: number) => {
      context.fillStyle = groundPaint
      context.fillRect(0, horizon, width, height - horizon)

      context.lineWidth = 0.8
      for (let row = 1; row <= 12; row += 1) {
        const amount = row / 12
        const y = horizon + (height - horizon) * amount * amount
        context.strokeStyle = `rgba(255, 45, 176, ${0.15 + amount * 0.5})`
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(width, y)
        context.stroke()
      }

      const spacing = Math.max(38, width / 7)
      const shift = mod(phase * 1.2, spacing)
      context.strokeStyle = 'rgba(229, 48, 255, .55)'
      context.lineWidth = 0.85
      for (let column = -10; column <= 10; column += 1) {
        const bottomX = width * 0.5 + column * spacing + shift
        context.beginPath()
        context.moveTo(width * 0.5, horizon)
        context.lineTo(bottomX, height)
        context.stroke()
      }

      context.strokeStyle = `rgba(65, 228, 255, ${0.55 + smoothedEnergy * 0.3})`
      context.lineWidth = 1.4
      context.beginPath()
      context.moveTo(0, horizon)
      context.lineTo(width, horizon)
      context.stroke()
    }

    const render = (_now: number, advance: boolean, elapsedMs = 0) => {
      if (width <= 1 || height <= 1) return
      const target = activeRef.current ? clamp(energyRef.current) : 0.03
      smoothedEnergy += (target - smoothedEnergy) * (activeRef.current ? 0.28 : 0.12)
      if (advance && activeRef.current && !motionQuery.matches) {
        const elapsed = Math.min(0.1, Math.max(0, elapsedMs / 1000))
        phase += elapsed * (28 + smoothedEnergy * 62)
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.fillStyle = skyPaint
      context.fillRect(0, 0, width, height)

      const horizon = height * 0.56
      drawStars(horizon)
      drawSun(horizon)
      drawMountain(horizon, 'back')
      drawGrid(horizon)
      drawMountain(horizon, 'front')

      context.fillStyle = vignettePaint
      context.fillRect(0, 0, width, height)
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const nextWidth = Math.max(1, Math.round(bounds.width))
      const nextHeight = Math.max(1, Math.round(bounds.height))
      const nextRatio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1))
      if (nextWidth === width && nextHeight === height && nextRatio === pixelRatio) return
      width = nextWidth
      height = nextHeight
      pixelRatio = nextRatio
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      rebuildPaints()
      render(performance.now(), false)
    }

    const handleMotionChange = () => {
      render(performance.now(), false)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    motionQuery.addEventListener('change', handleMotionChange)
    drawRef.current = render
    resize()
    render(performance.now(), false)

    return () => {
      drawRef.current = () => {}
      observer.disconnect()
      motionQuery.removeEventListener('change', handleMotionChange)
    }
  }, [])

  // Studio's analyser already publishes a fresh level sample every 55ms,
  // including during silence. Those samples are the animation clock: one draw
  // per real input update, no second timer/rAF, and nothing recurring at idle.
  useEffect(() => {
    if (document.hidden) return
    const now = performance.now()
    if (!active) {
      lastSampleRef.current = 0
      drawRef.current(now, false, 0)
      return
    }
    const elapsed = lastSampleRef.current ? now - lastSampleRef.current : 0
    lastSampleRef.current = now
    drawRef.current(now, true, elapsed)
  }, [active, energy, levels])

  return (
    <div
      className={styles.scene}
      data-active={active ? 'true' : 'false'}
      data-poplur-studio-synthwave
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      <span className={styles.scanlines} />
      <span className={styles.inputState}>{active ? 'LIVE INPUT' : 'SOUND REACTIVE'}</span>
    </div>
  )
}
