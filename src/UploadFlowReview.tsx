import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PostComposer, { type ComposerTarget, type PostComposerStep } from './PostComposer'
import UploadStatusView from './UploadStatusView'
import { playPop } from './pop'
import {
  resolveUploadReviewRoute,
  screensForUploadFlow,
  type UploadFlowId,
  type UploadMediaKind,
  type UploadReviewScreenId,
} from './uploadFlowCatalog'
import styles from './UploadFlowReview.module.css'

const SAMPLE_PHOTO = '/feed/posters/ad-food.jpg'
const SAMPLE_VIDEO = '/feed/ad-food.mp4'
const SAMPLE_TARGET: ComposerTarget = { lat: 43.6532, lng: -79.3832, radiusKm: 3.5, resume: true }

function writeRoute(flow: UploadFlowId, screen: UploadReviewScreenId, media: UploadMediaKind): void {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'uploadflows')
  url.searchParams.set('flow', flow)
  url.searchParams.set('screen', screen)
  url.searchParams.set('media', media)
  window.history.replaceState(null, '', url)
}

function UploadingScreen({
  complete = false,
  flow,
  radius,
  onReset,
}: {
  complete?: boolean
  flow: UploadFlowId
  radius: number
  onReset?: () => void
}) {
  return <UploadStatusView complete={complete} flow={flow} radius={radius} progress={complete ? null : .64} onReset={onReset} />
}

function LocationRadiusPreview({
  radius,
  target,
  onRadiusChange,
  onTargetChange,
  onContinue,
  flow,
}: {
  radius: number
  target: ComposerTarget
  onRadiusChange: (radius: number) => void
  onTargetChange: (target: ComposerTarget) => void
  onContinue: () => void
  flow: UploadFlowId
}) {
  const RADIUS_MIN = .5
  const RADIUS_MAX = 25
  const RADIUS_STEP = .5
  const RADIUS_ORB_SIZE = 28
  const [radiusPalette, setRadiusPalette] = useState({
    face: '#F63B9A',
    fillA: '#ffe1f1',
    fillB: '#ff86c4',
    fillC: '#f53c99',
  })
  const mapFrameRef = useRef<HTMLIFrameElement>(null)
  const initialTargetRef = useRef(target)
  const radiusRailRef = useRef<HTMLDivElement>(null)
  const draggingRadiusRef = useRef(false)
  const radiusRatio = (radius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)

  const updateTerrain = useCallback((nextRadius: number) => {
    mapFrameRef.current?.contentWindow?.postMessage({
      type: 'poplur-radius-preview',
      radiusKm: nextRadius,
    }, '*')
  }, [])

  const commitRadius = useCallback((rawRadius: number, withSound = true) => {
    const stepped = RADIUS_MIN + Math.round((rawRadius - RADIUS_MIN) / RADIUS_STEP) * RADIUS_STEP
    const nextRadius = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, stepped))
    if (radius === nextRadius) return
    if (withSound) playPop(.2)
    onRadiusChange(nextRadius)
  }, [onRadiusChange, radius])

  const setRadiusFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rail = radiusRailRef.current
    if (!rail) return
    const bounds = rail.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    commitRadius(RADIUS_MIN + ratio * (RADIUS_MAX - RADIUS_MIN))
  }, [commitRadius])

  useEffect(() => {
    updateTerrain(radius)
  }, [radius, updateTerrain])

  useEffect(() => {
    const onMapMessage = (event: MessageEvent) => {
      if (event.source !== mapFrameRef.current?.contentWindow) return
      if (event.data?.type === 'poplur-radius-palette') {
        const next = event.data.palette as Partial<typeof radiusPalette> | undefined
        const valid = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
        if (!next || !valid(next.face) || !valid(next.fillA) || !valid(next.fillB) || !valid(next.fillC)) return
        setRadiusPalette({ face: next.face, fillA: next.fillA, fillB: next.fillB, fillC: next.fillC })
        return
      }
      if (event.data?.type === 'poplur-radius-location') {
        const lat = Number(event.data.lat)
        const lng = Number(event.data.lng)
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return
        onTargetChange({ lat, lng, radiusKm: radius, resume: true })
      }
    }
    window.addEventListener('message', onMapMessage)
    return () => window.removeEventListener('message', onMapMessage)
  }, [onTargetChange, radius])

  const handleRadiusKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextRadius: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextRadius = radius - RADIUS_STEP
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextRadius = radius + RADIUS_STEP
    if (event.key === 'Home') nextRadius = RADIUS_MIN
    if (event.key === 'End') nextRadius = RADIUS_MAX
    if (nextRadius === null) return
    event.preventDefault()
    commitRadius(nextRadius)
  }

  const radiusPosition = `calc(${RADIUS_ORB_SIZE / 2}px + ${(radiusRatio * 100).toFixed(4)}% - ${(radiusRatio * RADIUS_ORB_SIZE).toFixed(4)}px)`

  return (
    <section className={styles.locationRadius} aria-label="3D post radius preview">
      <iframe
        ref={mapFrameRef}
        title="Angled 3D building map"
        src={`/?map=1&front=1&radiusReview=1&pickLat=${initialTargetRef.current.lat}&pickLng=${initialTargetRef.current.lng}`}
        onLoad={() => updateTerrain(radius)}
      />
      <div className={styles.locationIntro}>
        <span>POST LOCATION</span>
        <strong>{flow === 'map' ? 'Choose your starting spot' : 'Place your finished pop'}</strong>
        <small>Tap the map to place the pin, then set how far this pop can reach.</small>
        <em>PIN {target.lat.toFixed(4)}, {target.lng.toFixed(4)}</em>
      </div>
      <div
        className={styles.locationControls}
        style={{
          '--radius-face': radiusPalette.face,
          '--radius-fill-a': radiusPalette.fillA,
          '--radius-fill-b': radiusPalette.fillB,
          '--radius-fill-c': radiusPalette.fillC,
        } as React.CSSProperties}
      >
        <div className={styles.radiusPicker}>
          <span><b>CLAIM RADIUS</b><strong>{radius.toFixed(1)} km</strong></span>
          <div
            className={styles.radiusControl}
            role="slider"
            tabIndex={0}
            aria-label="Claim radius"
            aria-valuemin={RADIUS_MIN}
            aria-valuemax={RADIUS_MAX}
            aria-valuenow={radius}
            aria-valuetext={`${radius.toFixed(1)} kilometres`}
            onKeyDown={handleRadiusKey}
            onPointerDown={event => {
              draggingRadiusRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              setRadiusFromPointer(event)
            }}
            onPointerMove={event => {
              if (draggingRadiusRef.current) setRadiusFromPointer(event)
            }}
            onPointerUp={event => {
              draggingRadiusRef.current = false
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={() => { draggingRadiusRef.current = false }}
            onLostPointerCapture={() => { draggingRadiusRef.current = false }}
          >
            <div
              ref={radiusRailRef}
              className={styles.radiusRail}
              style={{ '--radius-progress': `${radiusRatio * 100}%` } as React.CSSProperties}
              aria-hidden="true"
            />
            <i className={styles.radiusOrb} style={{ left: radiusPosition }} aria-hidden="true" />
          </div>
        </div>
        <button type="button" className={styles.locationContinue} onClick={() => { playPop(); onContinue() }}>
          <span>{flow === 'map' ? 'Save spot & open camera' : 'Use this spot'}</span>
          <b aria-hidden="true">→</b>
        </button>
      </div>
    </section>
  )
}

function ComposerReview({
  step,
  target,
  media,
  onStepChange,
  onRadiusChange,
  onRequestLocation,
}: {
  step: PostComposerStep
  target?: ComposerTarget
  media: UploadMediaKind
  onStepChange: (step: PostComposerStep) => void
  onRadiusChange: (radius: number) => void
  onRequestLocation: () => void
}) {
  return (
    <PostComposer
      media={media === 'video' ? { kind: 'video', src: SAMPLE_VIDEO, length: '0:10' } : { kind: 'photo', src: SAMPLE_PHOTO }}
      target={target}
      initialStep={step}
      reviewMode
      onClose={() => {}}
      onStepChange={onStepChange}
      onRadiusChange={onRadiusChange}
      onRequestLocation={onRequestLocation}
    />
  )
}

function composerStepForScreen(screen: UploadReviewScreenId): PostComposerStep | null {
  if (screen === 'edit' || screen === 'effects' || screen === 'finish') return screen
  if (screen === 'publish') return 'channel'
  return null
}

function NonComposerPreview({
  flow,
  screen,
  motionLabOpen,
  radius,
  target,
  onRadiusChange,
  onTargetChange,
  onLocationContinue,
  onReset,
}: {
  flow: UploadFlowId
  screen: UploadReviewScreenId
  motionLabOpen: boolean
  radius: number
  target: ComposerTarget
  onRadiusChange: (radius: number) => void
  onTargetChange: (target: ComposerTarget) => void
  onLocationContinue: () => void
  onReset: () => void
}) {
  if (screen === 'capture') {
    const motionLab = motionLabOpen ? '&motion-lab=1' : ''
    return (
      <div className={styles.captureFrame}>
        <iframe title="Live camera upload screen" src={`/?view=camera&uploadReview=1${motionLab}`} />
        {flow === 'map' && (
          <div className={styles.retainedSpot}>
            <img src="/sprites/poplur_pin_lite_y0_p0_s256.png" alt="" />
            <span><b>MAP SPOT SAVED</b><small>{radius.toFixed(1)} km radius retained</small></span>
          </div>
        )}
      </div>
    )
  }
  if (screen === 'location') {
    return (
      <LocationRadiusPreview
        radius={radius}
        target={target}
        onRadiusChange={onRadiusChange}
        onTargetChange={onTargetChange}
        onContinue={onLocationContinue}
        flow={flow}
      />
    )
  }
  if (screen === 'uploading') return <UploadingScreen flow={flow} radius={radius} />
  if (screen === 'posted') return <UploadingScreen flow={flow} radius={radius} complete onReset={onReset} />
  return null
}

export default function UploadFlowReview() {
  const initial = useMemo(() => resolveUploadReviewRoute(window.location.search), [])
  const [flow, setFlow] = useState<UploadFlowId>(initial.flow)
  const [screen, setScreen] = useState<UploadReviewScreenId>(initial.screen)
  const [media, setMedia] = useState<UploadMediaKind>(initial.media)
  const [motionLabOpen, setMotionLabOpen] = useState(false)
  const [radius, setRadius] = useState(SAMPLE_TARGET.radiusKm ?? 3.5)
  const [target, setTarget] = useState<ComposerTarget>(SAMPLE_TARGET)
  const [composerRouteStep, setComposerRouteStep] = useState<PostComposerStep>(
    composerStepForScreen(initial.screen) ?? 'edit',
  )
  const screens = screensForUploadFlow(flow)
  const current = screens.find(item => item.id === screen) ?? screens[0]
  const currentIndex = screens.findIndex(item => item.id === current.id)
  const currentComposerStep = composerStepForScreen(current.id)
  const composerVisible = currentComposerStep !== null
  const canChooseMedia = ['capture', 'edit', 'effects', 'finish', 'publish'].includes(current.id)

  useEffect(() => {
    document.title = `Poplur upload review — ${flow} / ${current.label}`
    writeRoute(flow, current.id, media)
  }, [current.id, current.label, flow, media])

  useEffect(() => {
    if (currentComposerStep) setComposerRouteStep(currentComposerStep)
  }, [currentComposerStep])

  const chooseFlow = (next: UploadFlowId) => {
    const first = screensForUploadFlow(next)[0].id
    playPop(.18)
    setFlow(next)
    setScreen(first)
    setRadius(SAMPLE_TARGET.radiusKm ?? 3.5)
    setTarget(SAMPLE_TARGET)
    setComposerRouteStep('edit')
  }

  const chooseScreen = (next: UploadReviewScreenId) => {
    playPop(.16)
    setScreen(next)
  }

  const handleComposerStepChange = useCallback((next: PostComposerStep) => {
    setComposerRouteStep(next)
    if (next === 'channel') {
      setScreen(flow === 'camera' && screen === 'finish' ? 'location' : 'publish')
      return
    }
    setScreen(next)
  }, [flow, screen])

  const composerTarget = flow === 'map' || current.id === 'publish'
    ? { ...target, radiusKm: radius }
    : undefined

  const goRelative = (offset: -1 | 1) => {
    const next = screens[currentIndex + offset]
    if (next) chooseScreen(next.id)
  }

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <div className={styles.heading}>
            <img className={styles.headingBadge} src="/logo_icon.png" alt="" />
            <div>
              <span>POPLUR REVIEW</span>
              <h1>Upload pipeline</h1>
              <p>One draft · eight distinct stages</p>
            </div>
          </div>
          <div className={styles.flowTabs} role="tablist" aria-label="Upload entry flow">
            <button type="button" role="tab" aria-selected={flow === 'camera'} className={flow === 'camera' ? styles.flowActive : ''} onClick={() => chooseFlow('camera')}>Camera first</button>
            <button type="button" role="tab" aria-selected={flow === 'map'} className={flow === 'map' ? styles.flowActive : ''} onClick={() => chooseFlow('map')}>Map first</button>
          </div>
        </div>
        <ol className={styles.screenList} aria-label={`${flow} upload stages`}>
          {screens.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === current.id ? 'step' : undefined}
                className={item.id === current.id ? styles.screenActive : ''}
                onClick={() => chooseScreen(item.id)}
              >
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span><strong>{item.label}</strong><small>{item.note}</small></span>
              </button>
            </li>
          ))}
        </ol>
        <footer className={styles.sidebarFooter}>
          <button type="button" aria-label="Previous upload stage" disabled={currentIndex === 0} onClick={() => goRelative(-1)}>←</button>
          <span><b>{currentIndex + 1}</b> / {screens.length}</span>
          <button type="button" aria-label="Next upload stage" disabled={currentIndex === screens.length - 1} onClick={() => goRelative(1)}>→</button>
        </footer>
      </aside>

      <section className={styles.previewArea}>
        <header className={styles.previewHeader}>
          <div>
            <span>{flow === 'camera' ? 'CAMERA-FIRST FLOW' : 'MAP-FIRST FLOW'}</span>
            <h2>{current.label}</h2>
          </div>
          <div className={styles.previewTools}>
            {canChooseMedia && (
              <div className={styles.mediaTabs} role="group" aria-label="Preview media kind">
                <button type="button" aria-pressed={media === 'photo'} className={media === 'photo' ? styles.mediaActive : ''} onClick={() => setMedia('photo')}>Photo</button>
                <button type="button" aria-pressed={media === 'video'} className={media === 'video' ? styles.mediaActive : ''} onClick={() => setMedia('video')}>Video</button>
              </div>
            )}
            {current.id === 'capture' && (
              <button
                type="button"
                className={motionLabOpen ? styles.motionLabActive : ''}
                aria-pressed={motionLabOpen}
                title="Simulate device motion on the camera cube"
                onClick={() => setMotionLabOpen(open => !open)}
              >
                Accelerometer
              </button>
            )}
            <p>{current.note}</p>
          </div>
        </header>
        <div className={styles.device}>
          <div
            className={styles.deviceViewport}
            data-testid="upload-device"
            data-upload-flow={flow}
            data-upload-stage={current.id}
          >
            <div className={`${styles.composerLayer} ${composerVisible ? '' : styles.composerLayerHidden}`} aria-hidden={!composerVisible}>
              <ComposerReview
                key={`${flow}-${media}`}
                step={composerRouteStep}
                target={composerTarget}
                media={media}
                onStepChange={handleComposerStepChange}
                onRadiusChange={setRadius}
                onRequestLocation={() => setScreen('location')}
              />
            </div>
            {!composerVisible && <NonComposerPreview
              flow={flow}
              screen={current.id}
              motionLabOpen={motionLabOpen}
              radius={radius}
              target={{ ...target, radiusKm: radius }}
              onRadiusChange={setRadius}
              onTargetChange={setTarget}
              onLocationContinue={() => setScreen(flow === 'map' ? 'capture' : 'publish')}
              onReset={() => setScreen(flow === 'map' ? 'location' : 'capture')}
            />}
          </div>
        </div>
      </section>
    </main>
  )
}
