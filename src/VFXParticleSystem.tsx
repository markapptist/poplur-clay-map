import { useEffect, useRef, useState } from 'react'
import styles from './VFXStudio.module.css'
import { onFrame } from './frameGovernor'
import {
  PoplurPerformanceManager,
  type PoplurPerformancePolicy,
} from './poplurPerformanceManager'

export type VFXParticleEffect = 'explosion' | 'fireworks' | 'confetti' | 'rain' | 'fire'

interface ParticleRuntime {
  setActive: (active: boolean) => void
  updateSettings: (intensity: number, speed: number) => void
  dispose: () => void
}

const PARTICLE_CAP: Record<VFXParticleEffect, number> = {
  explosion: 150,
  fireworks: 220,
  confetti: 150,
  rain: 180,
  fire: 130,
}

function textureCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Particle texture canvas is unavailable')
  context.clearRect(0, 0, width, height)
  return { canvas, context }
}

function textureFor(effect: VFXParticleEffect): HTMLCanvasElement {
  const isStreak = effect === 'rain' || effect === 'fireworks'
  const width = isStreak ? 64 : 128
  const height = isStreak || effect === 'fire' ? 192 : 128
  const { canvas, context } = textureCanvas(width, height)

  if (effect === 'explosion') {
    const glow = context.createRadialGradient(64, 64, 2, 64, 64, 61)
    glow.addColorStop(0, 'rgba(255,255,238,1)')
    glow.addColorStop(.14, 'rgba(255,239,148,.98)')
    glow.addColorStop(.34, 'rgba(255,166,35,.9)')
    glow.addColorStop(.58, 'rgba(255,68,27,.58)')
    glow.addColorStop(.82, 'rgba(126,22,44,.16)')
    glow.addColorStop(1, 'rgba(126,22,44,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, 128, 128)
  } else if (effect === 'fireworks' || effect === 'rain') {
    const vertical = context.createLinearGradient(0, 0, 0, height)
    if (effect === 'rain') {
      vertical.addColorStop(0, 'rgba(214,252,255,0)')
      vertical.addColorStop(.12, 'rgba(214,252,255,.38)')
      vertical.addColorStop(.68, 'rgba(96,213,255,1)')
      vertical.addColorStop(.9, 'rgba(232,255,255,.82)')
      vertical.addColorStop(1, 'rgba(232,255,255,0)')
    } else {
      vertical.addColorStop(0, 'rgba(255,88,202,0)')
      vertical.addColorStop(.24, 'rgba(255,88,202,.24)')
      vertical.addColorStop(.58, 'rgba(255,223,91,.98)')
      vertical.addColorStop(.78, 'rgba(255,255,245,.9)')
      vertical.addColorStop(1, 'rgba(101,230,255,0)')
    }
    context.fillStyle = vertical
    context.fillRect(width * .31, 0, width * .38, height)

    const feather = context.createLinearGradient(0, 0, width, 0)
    feather.addColorStop(0, 'rgba(255,255,255,0)')
    feather.addColorStop(.36, 'rgba(255,255,255,.45)')
    feather.addColorStop(.5, 'rgba(255,255,255,1)')
    feather.addColorStop(.64, 'rgba(255,255,255,.45)')
    feather.addColorStop(1, 'rgba(255,255,255,0)')
    context.globalCompositeOperation = 'destination-in'
    context.fillStyle = feather
    context.fillRect(0, 0, width, height)
    context.globalCompositeOperation = 'source-over'
  } else if (effect === 'fire') {
    const flame = context.createLinearGradient(0, 192, 0, 8)
    flame.addColorStop(0, 'rgba(255,56,20,0)')
    flame.addColorStop(.12, 'rgba(255,56,20,.82)')
    flame.addColorStop(.38, 'rgba(255,132,19,.96)')
    flame.addColorStop(.64, 'rgba(255,226,75,.9)')
    flame.addColorStop(.82, 'rgba(255,255,224,.58)')
    flame.addColorStop(1, 'rgba(255,255,224,0)')
    context.fillStyle = flame
    context.beginPath()
    context.moveTo(64, 4)
    context.bezierCurveTo(92, 47, 117, 96, 103, 143)
    context.bezierCurveTo(94, 178, 77, 190, 64, 191)
    context.bezierCurveTo(42, 188, 22, 168, 23, 139)
    context.bezierCurveTo(24, 104, 52, 79, 47, 45)
    context.bezierCurveTo(54, 31, 61, 17, 64, 4)
    context.closePath()
    context.fill()
  } else {
    const clay = context.createLinearGradient(0, 0, 128, 128)
    clay.addColorStop(0, 'rgba(255,87,181,.98)')
    clay.addColorStop(.34, 'rgba(255,224,84,.96)')
    clay.addColorStop(.68, 'rgba(83,226,255,.94)')
    clay.addColorStop(1, 'rgba(140,87,255,.9)')
    context.fillStyle = clay
    context.fillRect(0, 0, 128, 128)
    context.strokeStyle = 'rgba(255,255,255,.76)'
    context.lineWidth = 9
    context.strokeRect(5, 5, 118, 118)
  }

  return canvas
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

let vfxParticleSequence = 0

export default function VFXParticleSystem({
  effect,
  intensity,
  speed,
  active,
}: {
  effect: VFXParticleEffect
  intensity: number
  speed: number
  active: boolean
}) {
  const [rendererID] = useState(() => `vfx-particles-${++vfxParticleSequence}`)
  const rendererHandle = useRef<ReturnType<typeof PoplurPerformanceManager.registerRenderer> | null>(null)
  const [grant, setGrant] = useState(() => ({
    active: false,
    policy: PoplurPerformanceManager.policy,
  }))

  useEffect(() => {
    let alive = true
    const handle = PoplurPerformanceManager.registerRenderer({
      id: rendererID,
      heavy: false,
      priority: 98,
      visible: true,
      demanded: active && intensity > 0,
      onActiveChange: (granted, policy) => {
        if (alive) setGrant({ active: granted, policy })
      },
    })
    rendererHandle.current = handle
    return () => {
      alive = false
      rendererHandle.current = null
      handle.dispose()
    }
  }, [rendererID])

  useEffect(() => rendererHandle.current?.setDemand(active && intensity > 0), [active, intensity])

  if (!active || intensity <= 0
    || !grant.active
    || !grant.policy.particlesAllowed
    || !grant.policy.decorativeRenderingAllowed) return null

  return (
    <ParticleSurface
      key={`${effect}-${grant.policy.mode}`}
      effect={effect}
      intensity={intensity}
      speed={speed}
      active
      policy={grant.policy}
    />
  )
}

function ParticleSurface({
  effect,
  intensity,
  speed,
  active,
  policy,
}: {
  effect: VFXParticleEffect
  intensity: number
  speed: number
  active: boolean
  policy: PoplurPerformancePolicy
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<ParticleRuntime | null>(null)
  const activeRef = useRef(active)
  const intensityRef = useRef(intensity)
  const speedRef = useRef(speed)

  useEffect(() => {
    activeRef.current = active
    runtimeRef.current?.setActive(active)
  }, [active])

  useEffect(() => {
    intensityRef.current = intensity
    speedRef.current = speed
    runtimeRef.current?.updateSettings(intensity, speed)
  }, [intensity, speed])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // The original effects are orthographic textured particles. Paint those
    // same textures and trajectories into one 2D surface; no scene, shader,
    // depth buffer or additional WebGL context is needed.
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return
    canvas.className = styles.particleCanvas
    canvas.setAttribute('aria-hidden', 'true')
    host.replaceChildren(canvas)
    const capacity = PARTICLE_CAP[effect]
    const texture = textureFor(effect)
    let width = 1
    let height = 1
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, policy.maximumPixelRatio)

    const position = new Float32Array(capacity * 3)
    const velocity = new Float32Array(capacity * 3)
    const age = new Float32Array(capacity)
    const lifetime = new Float32Array(capacity)
    const size = new Float32Array(capacity)
    const rotation = new Float32Array(capacity * 3)
    const spin = new Float32Array(capacity * 3)
    let halfWidth = 1
    let stopFrames: (() => void) | null = null
    let burstClock = 0
    let enabled = false
    let disposed = false

    const seedParticle = (index: number, delay = 0, burstGroup = 0) => {
      const offset = index * 3
      age[index] = -delay
      rotation[offset] = randomBetween(-Math.PI, Math.PI)
      rotation[offset + 1] = randomBetween(-Math.PI, Math.PI)
      rotation[offset + 2] = randomBetween(-Math.PI, Math.PI)
      spin[offset] = randomBetween(-4.5, 4.5)
      spin[offset + 1] = randomBetween(-5, 5)
      spin[offset + 2] = randomBetween(-6, 6)

      if (effect === 'confetti') {
        size[index] = randomBetween(.76, 1.16)
        position[offset] = randomBetween(-halfWidth, halfWidth)
        position[offset + 1] = randomBetween(-1.05, 1.15)
        position[offset + 2] = randomBetween(-.45, .45)
        velocity[offset] = randomBetween(-.14, .14)
        velocity[offset + 1] = randomBetween(-.48, -.27)
        velocity[offset + 2] = randomBetween(-.06, .06)
        lifetime[index] = randomBetween(3.4, 5.8)
        age[index] = randomBetween(0, lifetime[index])
        return
      }

      if (effect === 'rain') {
        size[index] = randomBetween(.8, 1.28)
        position[offset] = randomBetween(-halfWidth - .25, halfWidth + .25)
        position[offset + 1] = randomBetween(-1.1, 1.2)
        position[offset + 2] = randomBetween(-.3, .3)
        velocity[offset] = randomBetween(-.35, -.22)
        velocity[offset + 1] = randomBetween(-2.1, -1.45)
        velocity[offset + 2] = 0
        lifetime[index] = randomBetween(.9, 1.5)
        age[index] = randomBetween(0, lifetime[index])
        return
      }

      if (effect === 'fire') {
        size[index] = randomBetween(.82, 1.08)
        position[offset] = randomBetween(-halfWidth * .58, halfWidth * .58)
        position[offset + 1] = randomBetween(-1.08, -.88)
        position[offset + 2] = randomBetween(-.25, .28)
        velocity[offset] = randomBetween(-.13, .13)
        velocity[offset + 1] = randomBetween(.55, 1.05)
        velocity[offset + 2] = randomBetween(-.04, .04)
        lifetime[index] = randomBetween(.75, 1.5)
        age[index] = randomBetween(0, lifetime[index])
        return
      }

      const groupCount = effect === 'fireworks' ? 4 : 3
      size[index] = randomBetween(.82, 1.18)
      const group = burstGroup % groupCount
      const originX = effect === 'fireworks'
        ? (-halfWidth * .58) + group * ((halfWidth * 1.16) / Math.max(1, groupCount - 1))
        : randomBetween(-halfWidth * .5, halfWidth * .5)
      const originY = effect === 'fireworks'
        ? .48 - (group % 2) * .48
        : randomBetween(-.22, .24)
      const angle = Math.random() * Math.PI * 2
      const force = effect === 'fireworks' ? randomBetween(.45, 1.12) : randomBetween(.25, 1.02)
      position[offset] = originX + randomBetween(-.025, .025)
      position[offset + 1] = originY + randomBetween(-.025, .025)
      position[offset + 2] = randomBetween(-.22, .22)
      velocity[offset] = Math.cos(angle) * force
      velocity[offset + 1] = Math.sin(angle) * force
      velocity[offset + 2] = randomBetween(-.09, .09)
      lifetime[index] = effect === 'fireworks' ? randomBetween(.72, 1.35) : randomBetween(.52, 1.08)
    }

    const seedPool = () => {
      const groupSize = Math.max(1, Math.floor(capacity / 4))
      for (let index = 0; index < capacity; index += 1) {
        const group = Math.floor(index / groupSize)
        const delay = effect === 'fireworks' ? group * .16 : effect === 'explosion' ? (index % 3) * .06 : 0
        seedParticle(index, delay, group)
      }
      burstClock = effect === 'fireworks' ? 1.65 : 1.25
    }

    seedPool()

    const resize = () => {
      const rect = host.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      halfWidth = width / height
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const updateParticle = (index: number, dt: number): number => {
      const offset = index * 3
      age[index] += dt
      if (age[index] < 0) return 0
      if (age[index] >= lifetime[index]) {
        if (effect === 'confetti' || effect === 'rain' || effect === 'fire') seedParticle(index)
        else return 0
      }

      const progress = Math.max(0, Math.min(1, age[index] / lifetime[index]))
      let driftX = 0
      if (effect === 'confetti') {
        velocity[offset + 1] -= .04 * dt
        driftX = Math.sin(age[index] * 4 + index) * .08
      } else if (effect === 'fire') {
        driftX = Math.sin(age[index] * 7 + index) * .1
        velocity[offset] *= .992
      } else {
        velocity[offset + 1] -= (effect === 'fireworks' ? .44 : .26) * dt
        velocity[offset] *= .993
        velocity[offset + 1] *= .993
      }

      position[offset] += (velocity[offset] + driftX) * dt
      position[offset + 1] += velocity[offset + 1] * dt
      position[offset + 2] += velocity[offset + 2] * dt
      rotation[offset] += spin[offset] * dt
      rotation[offset + 1] += spin[offset + 1] * dt
      rotation[offset + 2] += spin[offset + 2] * dt

      if ((effect === 'confetti' || effect === 'rain') && position[offset + 1] < -1.2) seedParticle(index)
      if (effect === 'fire' && position[offset + 1] > .45) seedParticle(index)

      if (effect === 'explosion') return Math.sin(progress * Math.PI) * 1.55
      if (effect === 'fireworks') return Math.max(.08, (1 - progress) * 1.18)
      if (effect === 'fire') return Math.sin(progress * Math.PI)
      return 1
    }

    const renderFrame = (dtMs: number) => {
      if (!enabled || disposed || document.hidden) return
      const dt = Math.min(.05, dtMs / 1000) * speedRef.current
      const requestedCount = Math.round(
        capacity * (intensityRef.current / 100) * policy.particleDensityMultiplier,
      )
      const visibleCount = policy.particlesAllowed
        ? Math.max(0, Math.min(capacity, policy.maxParticleObjects, requestedCount))
        : 0
      const opacity = effect === 'rain'
        ? .68 + intensityRef.current / 260
        : .58 + intensityRef.current / 250

      if (effect === 'explosion' || effect === 'fireworks') {
        burstClock -= dt
        if (burstClock <= 0) seedPool()
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = effect === 'confetti' ? 'source-over' : 'lighter'
      context.globalAlpha = Math.min(1, opacity)
      const unit = height / 2
      for (let index = 0; index < visibleCount; index += 1) {
        const particleScale = updateParticle(index, dt)
        if (particleScale <= 0) continue
        const offset = index * 3
        const x = width / 2 + position[offset] * unit
        const y = height / 2 - position[offset + 1] * unit
        let angle = rotation[offset + 2]
        let w = .15 * particleScale * size[index] * unit
        let h = w
        if (effect === 'confetti') {
          // Project the tumbling card's two tilt axes into the same
          // orthographic view, including its thin edge as it turns over.
          w = .04 * size[index] * unit * Math.max(.14, Math.abs(Math.cos(rotation[offset + 1])))
          h = .075 * size[index] * unit * Math.max(.14, Math.abs(Math.cos(rotation[offset])))
        } else if (effect === 'rain' || effect === 'fireworks') {
          angle = Math.atan2(velocity[offset + 1], velocity[offset]) - Math.PI / 2
          w = (effect === 'rain' ? .035 : .024 * Math.max(.42, particleScale)) * unit
          h = (effect === 'rain' ? .3 * size[index] : .15 * particleScale) * unit
        } else if (effect === 'fire') {
          angle = Math.sin(age[index] * 6 + index) * .14
          w = .13 * particleScale * size[index] * unit
          h = .24 * particleScale * size[index] * unit
        }
        const cos = Math.cos(angle) * pixelRatio
        const sin = Math.sin(angle) * pixelRatio
        context.setTransform(cos, -sin, sin, cos, x * pixelRatio, y * pixelRatio)
        context.drawImage(texture, -w / 2, -h / 2, w, h)
      }
    }

    const start = () => {
      if (stopFrames
        || disposed
        || document.hidden
        || !activeRef.current
        || !policy.particlesAllowed
        || !policy.decorativeRenderingAllowed) return
      enabled = true
      stopFrames = onFrame(dtMs => renderFrame(dtMs), 'managed')
    }
    const stop = () => {
      enabled = false
      stopFrames?.()
      stopFrames = null
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
    }

    const onVisibility = () => {
      if (document.hidden) stop()
      else if (activeRef.current) start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const runtime: ParticleRuntime = {
      setActive: nextActive => {
        if (nextActive) start()
        else stop()
      },
      updateSettings: (nextIntensity, nextSpeed) => {
        intensityRef.current = nextIntensity
        speedRef.current = nextSpeed
      },
      dispose: () => {
        disposed = true
        stop()
        observer.disconnect()
        document.removeEventListener('visibilitychange', onVisibility)
        canvas.remove()
        canvas.width = canvas.height = 1
        texture.width = texture.height = 1
      },
    }
    runtimeRef.current = runtime
    runtime.updateSettings(intensityRef.current, speedRef.current)
    runtime.setActive(activeRef.current)

    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = null
      runtime.dispose()
    }
  }, [effect, policy])

  return (
    <div
      ref={hostRef}
      className={styles.particleSystem}
      aria-label={`${effect} particle system preview`}
      style={{ opacity: active ? 1 : 0 }}
    />
  )
}
