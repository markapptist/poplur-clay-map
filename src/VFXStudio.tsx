import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ModelViewerElement } from '@google/model-viewer'
import styles from './VFXStudio.module.css'
import { generateMeshyObject, MeshyUnavailable, type MeshyProgress } from './meshy'
import VFXParticleSystem, { type VFXParticleEffect } from './VFXParticleSystem'

ModelViewerElement.meshoptDecoderLocation = `${import.meta.env.BASE_URL}meshopt_decoder.js`

export interface VFXMedia {
  kind: 'photo' | 'video'
  src: string
}

export type VFXEngine = 'none' | 'scene3d' | 'spritekit' | 'scenekit'

export interface VFXCueTiming {
  startSeconds: number
  durationSeconds: number
  engine: VFXEngine
}

export const VFX_EFFECTS = [
  { id: 'none', name: 'No overlay', kind: 'CLEAN', group: 'objects', engine: 'none', model: null, thumb: '/logo_icon.png' },
  { id: 'meshy', name: 'Create in 3D', kind: 'MESHY AI', group: 'objects', engine: 'scene3d', model: null, thumb: '/logo_icon.png' },
  { id: 'globe', name: 'Clay globe', kind: 'SCENE 3D', group: 'objects', engine: 'scene3d', model: '/poplur-globe-lite.glb', thumb: '/sprites/zoom_globe_y20_p12_s256.png' },
  { id: 'camera', name: 'Poplur camera', kind: 'SCENE 3D', group: 'objects', engine: 'scene3d', model: '/poplur_camera_kodak.glb', thumb: '/sprites/poplur_camera_kodak_y0_p14_s320.png' },
  { id: 'tv', name: 'Clay TV', kind: 'SCENE 3D', group: 'objects', engine: 'scene3d', model: '/clay_tv_navigator.glb', thumb: '/clay_tv.png' },
  { id: 'mic', name: 'Poplur mic', kind: 'SCENE 3D', group: 'objects', engine: 'scene3d', model: '/poplur_mic_lite.glb', thumb: '/sprites/poplur_mic_lite_y0_p0_s512.png' },
  { id: 'plane', name: 'Fly-by', kind: 'SCENE 3D', group: 'objects', engine: 'scene3d', model: '/models/plane.glb', thumb: '/sprites/plane_y0_p74_s256.png' },
  { id: 'pin', name: 'Location pin', kind: 'SCENE 3D', group: 'objects', engine: 'scene3d', model: '/poplur_pin_lite.glb', thumb: '/sprites/poplur_pin_lite_y20_p14_s256.png' },
  { id: 'explosion', name: 'Explosion', kind: 'SCN PARTICLE', group: 'effects', engine: 'scenekit', model: null, thumb: null },
  { id: 'fireworks', name: 'Fireworks', kind: 'SK EMITTER', group: 'effects', engine: 'spritekit', model: null, thumb: null },
  { id: 'confetti', name: 'Confetti', kind: 'SK EMITTER', group: 'effects', engine: 'spritekit', model: null, thumb: null },
  { id: 'rain', name: 'Rain', kind: 'SK EMITTER', group: 'effects', engine: 'spritekit', model: null, thumb: null },
  { id: 'fire', name: 'Fire', kind: 'SCN PARTICLE', group: 'effects', engine: 'scenekit', model: null, thumb: null },
] as const

export type VFXEffectId = typeof VFX_EFFECTS[number]['id']

export interface VFXCustomAsset {
  source: 'meshy'
  prompt: string
  modelUrl: string
  taskId: string
  thumbnailUrl?: string
}

type Placement = { x: number; y: number; scale: number; rotation: number }
type Tool = 'objects' | 'effects' | 'meshy' | 'transform'

const DEFAULT_PLACEMENT: Placement = { x: 64, y: 43, scale: 42, rotation: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function mediaDuration(media: VFXMedia): number {
  if (media.kind === 'photo') return 6
  return 12
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const wholeSeconds = Math.floor(safe % 60)
  const tenths = Math.floor((safe % 1) * 10)
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${tenths}`
}

function engineLabel(engine: VFXEngine): string {
  if (engine === 'spritekit') return 'SpriteKit'
  if (engine === 'scenekit') return 'SceneKit'
  if (engine === 'scene3d') return 'SceneKit 3D'
  return 'No effect'
}

function ActiveModel({ src, name }: { src: string; name: string }) {
  return React.createElement('model-viewer', {
    class: styles.activeModel,
    src,
    alt: `${name} 3D overlay`,
    'camera-orbit': '20deg 72deg 2.8m',
    'field-of-view': '28deg',
    exposure: '1.2',
    shadowIntensity: '1.1',
    shadowSoftness: '.8',
    'auto-rotate': true,
    'rotation-per-second': '18deg',
    interactionPrompt: 'none',
    disableZoom: true,
    loading: 'eager',
  })
}

function EffectThumbnail({ id, thumb }: { id: VFXEffectId; thumb: string | null }) {
  if (thumb) return <img src={thumb} alt="" />
  if (id === 'explosion') return <i className={`${styles.generatedThumb} ${styles.explosionThumb}`}><b /><b /><b /><b /></i>
  if (id === 'fireworks') return <i className={`${styles.generatedThumb} ${styles.fireworksThumb}`}><b /><b /><b /></i>
  if (id === 'confetti') return <i className={`${styles.generatedThumb} ${styles.confettiThumb}`}>{Array.from({ length: 10 }, (_, index) => <b key={index} style={{ left: `${5 + ((index * 17) % 48)}px`, top: `${2 + ((index * 23) % 48)}px`, background: `hsl(${index * 43} 88% 58%)` }} />)}</i>
  if (id === 'rain') return <i className={`${styles.generatedThumb} ${styles.rainThumb}`}>{Array.from({ length: 8 }, (_, index) => <b key={index} style={{ left: `${5 + ((index * 19) % 48)}px`, top: `${-3 + ((index * 17) % 44)}px` }} />)}</i>
  if (id === 'fire') return <i className={`${styles.generatedThumb} ${styles.fireThumb}`}><b /><b /><b /></i>
  return <i className={styles.generatedThumb} />
}

export default function VFXStudio({
  media,
  value,
  timing,
  customAsset,
  onChange,
  onTimingChange,
  onCustomAssetChange,
  onContinue,
}: {
  media: VFXMedia
  value: VFXEffectId
  timing?: VFXCueTiming
  customAsset?: VFXCustomAsset | null
  onChange: (effect: VFXEffectId) => void
  onTimingChange?: (timing: VFXCueTiming) => void
  onCustomAssetChange?: (asset: VFXCustomAsset | null) => void
  onContinue: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const generationRef = useRef<AbortController | null>(null)
  const initialClipDuration = mediaDuration(media)
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT)
  const [tracking, setTracking] = useState<'subject' | 'screen'>('subject')
  const [playing, setPlaying] = useState(media.kind === 'video')
  const [playhead, setPlayhead] = useState(24)
  const [tool, setTool] = useState<Tool>('objects')
  const [intensity, setIntensity] = useState(72)
  const [speed, setSpeed] = useState(1)
  const [clipDurationSeconds, setClipDurationSeconds] = useState(initialClipDuration)
  const [effectStartSeconds, setEffectStartSeconds] = useState(
    timing?.startSeconds ?? initialClipDuration * .24,
  )
  const [effectDurationSeconds, setEffectDurationSeconds] = useState(
    timing?.durationSeconds ?? Math.min(2.5, initialClipDuration * .42),
  )
  const [meshyOpen, setMeshyOpen] = useState(false)
  const [meshyPrompt, setMeshyPrompt] = useState(customAsset?.prompt ?? '')
  const [meshyProgress, setMeshyProgress] = useState<MeshyProgress | null>(null)
  const [meshyError, setMeshyError] = useState<string | null>(null)
  const [meshyGenerating, setMeshyGenerating] = useState(false)
  const selected = useMemo(
    () => VFX_EFFECTS.find(effect => effect.id === value) ?? VFX_EFFECTS[0],
    [value],
  )
  const visibleEffects = useMemo(
    () => {
      if (tool === 'objects') {
        return VFX_EFFECTS.filter(effect => effect.group === 'objects' && effect.id !== 'meshy')
      }
      if (tool === 'effects') return VFX_EFFECTS.filter(effect => effect.group === 'effects')
      return []
    },
    [tool],
  )
  const isParticle = selected.group === 'effects'
  const activeModelUrl = selected.id === 'meshy' ? customAsset?.modelUrl ?? null : selected.model
  const currentSeconds = (playhead / 100) * clipDurationSeconds
  const cueEndSeconds = Math.min(clipDurationSeconds, effectStartSeconds + effectDurationSeconds)
  const cueLeft = clipDurationSeconds > 0 ? (effectStartSeconds / clipDurationSeconds) * 100 : 0
  const cueWidth = clipDurationSeconds > 0 ? ((cueEndSeconds - effectStartSeconds) / clipDurationSeconds) * 100 : 0
  const effectActive = value !== 'none'
    && currentSeconds >= effectStartSeconds
    && currentSeconds <= cueEndSeconds

  useEffect(() => {
    onTimingChange?.({
      startSeconds: Number(effectStartSeconds.toFixed(2)),
      durationSeconds: Number(effectDurationSeconds.toFixed(2)),
      engine: selected.engine,
    })
  }, [effectDurationSeconds, effectStartSeconds, onTimingChange, selected.engine])

  useEffect(() => {
    if (media.kind !== 'photo' || !playing) return
    const timer = window.setInterval(() => {
      setPlayhead(current => {
        const step = (100 * .1) / clipDurationSeconds
        return current + step >= 100 ? 0 : current + step
      })
    }, 100)
    return () => window.clearInterval(timer)
  }, [clipDurationSeconds, media.kind, playing])

  useEffect(() => () => generationRef.current?.abort(), [])

  const placeAtPlayhead = () => {
    const minimumDuration = Math.min(.25, clipDurationSeconds)
    const start = clamp(currentSeconds, 0, Math.max(0, clipDurationSeconds - minimumDuration))
    const duration = clamp(effectDurationSeconds, minimumDuration, Math.max(minimumDuration, clipDurationSeconds - start))
    setEffectStartSeconds(start)
    setEffectDurationSeconds(duration)
  }

  const selectEffect = (effect: VFXEffectId) => {
    if (effect === 'meshy' && (!customAsset || value === 'meshy')) {
      setMeshyOpen(true)
      setTool('meshy')
      return
    }
    onChange(effect)
    if (effect !== 'none') {
      setPlacement(DEFAULT_PLACEMENT)
      placeAtPlayhead()
    }
  }

  const generateCustomObject = async () => {
    const prompt = meshyPrompt.trim()
    if (!prompt || meshyGenerating) return
    generationRef.current?.abort()
    const controller = new AbortController()
    generationRef.current = controller
    setMeshyError(null)
    setMeshyProgress({ ratio: .02, stage: 'Starting Meshy' })
    setMeshyGenerating(true)
    try {
      const generated = await generateMeshyObject({
        prompt,
        signal: controller.signal,
        onProgress: setMeshyProgress,
      })
      onCustomAssetChange?.({
        source: 'meshy',
        prompt,
        modelUrl: generated.modelUrl,
        taskId: generated.taskId,
        thumbnailUrl: generated.thumbnailUrl,
      })
      onChange('meshy')
      setPlacement(DEFAULT_PLACEMENT)
      placeAtPlayhead()
      setMeshyOpen(false)
      setTool('transform')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setMeshyError(error instanceof MeshyUnavailable
        ? 'Meshy generation connects through your signed-in Poplur account.'
        : error instanceof Error ? error.message : 'Meshy could not build that object.')
    } finally {
      if (generationRef.current === controller) generationRef.current = null
      setMeshyGenerating(false)
    }
  }

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) {
      setPlaying(current => !current)
      return
    }
    if (video.paused) {
      void video.play()
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  const seek = (next: number) => {
    const video = videoRef.current
    setPlayhead(next)
    if (video?.duration && Number.isFinite(video.duration)) {
      video.currentTime = (next / 100) * video.duration
    }
  }

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (value === 'none') return
    const stage = event.currentTarget.parentElement
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const currentX = (placement.x / 100) * rect.width
    const currentY = (placement.y / 100) * rect.height
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left - currentX,
      offsetY: event.clientY - rect.top - currentY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    const stage = event.currentTarget.parentElement
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = ((event.clientX - rect.left - dragRef.current.offsetX) / rect.width) * 100
    const y = ((event.clientY - rect.top - dragRef.current.offsetY) / rect.height) * 100
    setPlacement(current => ({ ...current, x: clamp(x, 9, 91), y: clamp(y, 11, 87) }))
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section className={styles.studio} aria-label="Poplur VFX studio">
      <header className={styles.header}>
        <div className={styles.title}>
          <img src="/subscreens/assets/create_ic_vfx.imageset/create_ic_vfx.png" alt="" />
          <span><b>VFX</b><small>COMPOSITOR</small></span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" aria-label="Undo" disabled>↶</button>
          <button type="button" aria-label="Redo" disabled>↷</button>
          <button type="button" className={styles.doneButton} onClick={onContinue}>Done</button>
        </div>
      </header>

      <div className={styles.stage}>
        {media.kind === 'video' ? (
          <video
            ref={videoRef}
            src={media.src}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={event => {
              const duration = event.currentTarget.duration
              if (!duration || !Number.isFinite(duration)) return
              setClipDurationSeconds(duration)
              setEffectStartSeconds(current => clamp(current, 0, Math.max(0, duration - .25)))
              setEffectDurationSeconds(current => clamp(current, .25, duration))
            }}
            onTimeUpdate={event => {
              const video = event.currentTarget
              if (video.duration && Number.isFinite(video.duration)) {
                setPlayhead((video.currentTime / video.duration) * 100)
              }
            }}
          />
        ) : (
          <img src={media.src} alt="Effect preview" />
        )}

        <div className={styles.stageShade} aria-hidden="true" />
        <div className={styles.previewBadge}><i /> LIVE PREVIEW</div>
        {effectActive && activeModelUrl && (
          <div
            className={styles.objectPlacement}
            data-tracking={tracking}
            style={{
              left: `${placement.x}%`,
              top: `${placement.y}%`,
              width: `${placement.scale}%`,
              transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)`,
            }}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <ActiveModel src={activeModelUrl} name={selected.name} />
            <i className={styles.handleNW} /><i className={styles.handleNE} />
            <i className={styles.handleSW} /><i className={styles.handleSE} />
            <span>{tracking === 'subject' ? 'TRACKED' : 'SCREEN'}</span>
          </div>
        )}
        {isParticle && (
          <VFXParticleSystem
            effect={selected.id as VFXParticleEffect}
            intensity={intensity}
            speed={speed}
            active={effectActive}
          />
        )}
        {activeModelUrl && (
          <button
            type="button"
            className={`${styles.trackingPill} ${tracking === 'subject' ? styles.trackingOn : ''}`}
            aria-pressed={tracking === 'subject'}
            onClick={() => setTracking(current => current === 'subject' ? 'screen' : 'subject')}
          >
            {tracking === 'subject' ? 'Subject tracked' : 'Screen anchored'}
          </button>
        )}
        {value === 'none' && (
          <button type="button" className={styles.addPrompt} onClick={() => selectEffect('globe')}>
            <b>+</b><span>Add a VFX layer</span>
          </button>
        )}
      </div>

      <div className={styles.timeline}>
        <button type="button" className={styles.playButton} onClick={togglePlayback} aria-label={playing ? 'Pause preview' : 'Play preview'}>
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <div className={styles.timelineTrack}>
          <div className={styles.frames} aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <img key={index} src="/feed/posters/ad-food.jpg" alt="" />)}
          </div>
          <div className={styles.effectLane} aria-label="Timed VFX layer">
            {value !== 'none' ? (
              <span
                className={`${styles.effectClip} ${effectActive ? styles.effectClipActive : ''}`}
                style={{ left: `${cueLeft}%`, width: `${Math.max(2, cueWidth)}%` }}
              >
                <small>{engineLabel(selected.engine)}</small>
                <b>{selected.name}</b>
              </span>
            ) : (
              <span className={styles.emptyCue}>Choose a layer, then place it in time</span>
            )}
          </div>
          <input type="range" min="0" max="100" step="0.1" value={playhead} aria-label="VFX timeline" onChange={event => seek(Number(event.target.value))} />
          <i className={styles.playhead} style={{ left: `${playhead}%` }} />
        </div>
        <time>{formatTimestamp(currentSeconds)}<small>{formatTimestamp(clipDurationSeconds)}</small></time>
        <button
          type="button"
          className={styles.placeAtPlayhead}
          disabled={value === 'none'}
          onClick={placeAtPlayhead}
        >
          Place at {formatTimestamp(currentSeconds)}
        </button>
      </div>

      <div className={styles.toolTabs} role="tablist" aria-label="VFX tools">
        <button type="button" role="tab" aria-selected={tool === 'objects'} onClick={() => { setMeshyOpen(false); setTool('objects') }}>Objects</button>
        <button type="button" role="tab" aria-selected={tool === 'effects'} onClick={() => { setMeshyOpen(false); setTool('effects') }}>Particles</button>
        <button type="button" role="tab" className={styles.meshyTab} aria-selected={tool === 'meshy'} onClick={() => { setMeshyOpen(true); setTool('meshy') }}>Meshy AI</button>
        <button type="button" role="tab" aria-selected={tool === 'transform'} onClick={() => { setMeshyOpen(false); setTool('transform') }}>Transform</button>
      </div>

      {tool === 'meshy' || meshyOpen ? (
        <div className={styles.meshyPanel} aria-label="Create a 3D object with Meshy">
          <div className={styles.meshyHead}>
            <span><b>Meshy AI object generator</b><small>Text to textured GLB · placed at the playhead</small></span>
            <button type="button" onClick={() => {
              generationRef.current?.abort()
              setMeshyOpen(false)
              setTool('objects')
            }} aria-label="Close Meshy generator">×</button>
          </div>
          <textarea
            value={meshyPrompt}
            maxLength={600}
            disabled={meshyGenerating}
            onChange={event => setMeshyPrompt(event.target.value)}
            placeholder="A glossy pink clay boombox with tiny chrome knobs"
            aria-label="Describe the 3D object"
          />
          <div className={styles.meshyStatus} aria-live="polite">
            {meshyProgress && <span style={{ '--meshy-progress': `${meshyProgress.ratio * 100}%` } as React.CSSProperties}><i /></span>}
            <small>{meshyError ?? meshyProgress?.stage ?? 'Generated as a mobile-ready GLB, then added at the playhead.'}</small>
          </div>
          <button
            type="button"
            className={styles.meshyGenerate}
            disabled={!meshyPrompt.trim() || meshyGenerating}
            onClick={() => { void generateCustomObject() }}
          >
            {meshyGenerating ? 'Building object…' : 'Generate with Meshy'}
          </button>
        </div>
      ) : tool !== 'transform' ? (
        <div className={styles.objectRail} aria-label={tool === 'objects' ? 'Poplur 3D objects' : 'SpriteKit and SceneKit particle effects'}>
          {visibleEffects.map(effect => (
            <button
              type="button"
              key={effect.id}
              className={effect.id === value ? styles.objectOn : ''}
              aria-pressed={effect.id === value}
              onClick={() => selectEffect(effect.id)}
            >
              <span><EffectThumbnail id={effect.id} thumb={effect.thumb} /></span>
              <b>{effect.name}</b>
              <small>{effect.kind}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.transformPanel}>
          {isParticle && (
            <>
              <label>
                <span>Intensity <b>{intensity}%</b></span>
                <input type="range" min="20" max="100" step="1" value={intensity} onChange={event => setIntensity(Number(event.target.value))} />
              </label>
              <label>
                <span>Speed <b>{speed.toFixed(1)}×</b></span>
                <input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={event => setSpeed(Number(event.target.value))} />
              </label>
            </>
          )}
          {!isParticle && value !== 'none' && (
            <>
              <label>
                <span>Size <b>{placement.scale}%</b></span>
                <input
                  type="range"
                  min="20"
                  max="76"
                  step="1"
                  value={placement.scale}
                  onChange={event => setPlacement(current => ({ ...current, scale: Number(event.target.value) }))}
                />
              </label>
              <label>
                <span>Angle <b>{placement.rotation}°</b></span>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={placement.rotation}
                  onChange={event => setPlacement(current => ({ ...current, rotation: Number(event.target.value) }))}
                />
              </label>
            </>
          )}
          {value !== 'none' ? (
            <>
              <label>
                <span>Start <b>{formatTimestamp(effectStartSeconds)}</b></span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, clipDurationSeconds - .25)}
                  step="0.1"
                  value={effectStartSeconds}
                  onChange={event => {
                    const start = Number(event.target.value)
                    setEffectStartSeconds(start)
                    setEffectDurationSeconds(current => clamp(current, .25, Math.max(.25, clipDurationSeconds - start)))
                  }}
                />
              </label>
              <label>
                <span>Duration <b>{effectDurationSeconds.toFixed(1)}s</b></span>
                <input
                  type="range"
                  min="0.25"
                  max={Math.max(.25, clipDurationSeconds - effectStartSeconds)}
                  step="0.1"
                  value={effectDurationSeconds}
                  onChange={event => setEffectDurationSeconds(Number(event.target.value))}
                />
              </label>
              <button type="button" onClick={() => {
                setPlacement(DEFAULT_PLACEMENT)
                setIntensity(72)
                setSpeed(1)
                placeAtPlayhead()
              }}>Reset layer at playhead</button>
            </>
          ) : (
            <p className={styles.noTransform}>Choose an object or particle effect to edit its timing.</p>
          )}
        </div>
      )}
    </section>
  )
}
