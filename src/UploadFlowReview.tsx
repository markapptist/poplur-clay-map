import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ModelViewerElement } from '@google/model-viewer'
import PostComposer, { type ComposerTarget, type PostComposerStep } from './PostComposer'
import VideoEditor from './VideoEditor'
import { playPop } from './pop'
import styles from './UploadFlowReview.module.css'

ModelViewerElement.meshoptDecoderLocation = `${import.meta.env.BASE_URL}meshopt_decoder.js`

type FlowId = 'camera' | 'map'
type ScreenId =
  | 'location'
  | 'capture'
  | 'confirm'
  | 'edit'
  | 'video'
  | 'effects'
  | 'choice'
  | 'ai'
  | 'channel'
  | 'location-return'
  | 'channel-ready'
  | 'uploading'
  | 'posted'

interface ReviewScreen {
  id: ScreenId
  label: string
  note: string
  gap?: boolean
}

const CAMERA_FLOW: ReviewScreen[] = [
  { id: 'capture', label: 'Capture', note: 'Live camera: photo or video' },
  { id: 'confirm', label: 'Keep or redo', note: 'Capture confirmation', gap: true },
  { id: 'edit', label: 'Filters', note: 'Photo grade and video filter' },
  { id: 'video', label: 'Trim and music', note: 'Video-only editor' },
  { id: 'effects', label: 'VFX Studio', note: 'Timed 3D objects and native particle effects' },
  { id: 'choice', label: 'Original or AI', note: 'Choose before generation' },
  { id: 'ai', label: 'Poplur AI', note: 'Chat with the attached capture' },
  { id: 'channel', label: 'Channel', note: 'Choose a channel and preview the post' },
  { id: 'location-return', label: 'Location', note: 'Preview the radius over 3D terrain' },
  { id: 'channel-ready', label: 'Ready to post', note: 'Content and confirmed mini-map' },
  { id: 'uploading', label: 'Uploading', note: 'Clay globe transfer' },
  { id: 'posted', label: 'Posted', note: 'Celebration and camera reset' },
]

const MAP_FLOW: ReviewScreen[] = [
  { id: 'location', label: 'Location', note: 'Choose a spot and claim radius' },
  { id: 'capture', label: 'Capture', note: 'Camera opens with the spot retained' },
  { id: 'confirm', label: 'Keep or redo', note: 'Capture confirmation', gap: true },
  { id: 'edit', label: 'Filters', note: 'Photo grade and video filter' },
  { id: 'video', label: 'Trim and music', note: 'Video-only editor' },
  { id: 'effects', label: 'VFX Studio', note: 'Timed 3D objects and native particle effects' },
  { id: 'choice', label: 'Original or AI', note: 'Choose before generation' },
  { id: 'ai', label: 'Poplur AI', note: 'Chat with the attached capture' },
  { id: 'channel-ready', label: 'Ready to post', note: 'Content and confirmed mini-map' },
  { id: 'uploading', label: 'Uploading', note: 'Clay globe transfer' },
  { id: 'posted', label: 'Posted', note: 'Celebration and map reset' },
]

const SAMPLE_PHOTO = '/feed/posters/ad-food.jpg'
const SAMPLE_VIDEO = '/feed/ad-food.mp4'
const SAMPLE_TARGET: ComposerTarget = { lat: 43.6532, lng: -79.3832, radiusKm: 3.5, resume: true }

function screensFor(flow: FlowId): ReviewScreen[] {
  return flow === 'camera' ? CAMERA_FLOW : MAP_FLOW
}

function readRoute(): { flow: FlowId; screen: ScreenId } {
  const params = new URLSearchParams(window.location.search)
  const flow: FlowId = params.get('flow') === 'map' ? 'map' : 'camera'
  const screens = screensFor(flow)
  const requested = params.get('screen') as ScreenId | null
  const screen = screens.some(item => item.id === requested) ? requested! : screens[0].id
  return { flow, screen }
}

function writeRoute(flow: FlowId, screen: ScreenId): void {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'uploadflows')
  url.searchParams.set('flow', flow)
  url.searchParams.set('screen', screen)
  window.history.replaceState(null, '', url)
}

function CaptureConfirmation() {
  return (
    <section className={styles.captureReview} aria-label="Capture confirmation review">
      <img src={SAMPLE_PHOTO} alt="Captured post preview" />
      <div className={styles.captureShade} />
      <div className={styles.captureScroll}>
        <div className={styles.flowBrand}>
          <img src="/logo_icon.png" alt="" />
          <span>CAPTURE READY</span>
        </div>
        <div className={styles.captureTitle}>
          <span>PHOTO · ORIGINAL</span>
          <strong>Keep this shot?</strong>
        </div>
        <div className={styles.captureActions}>
          <button type="button" className={styles.redoButton}>
            <b aria-hidden="true">↺</b>
            <span>Redo</span>
          </button>
          <button type="button" className={styles.keepButton}>
            <b aria-hidden="true">✓</b>
            <span>Keep photo</span>
          </button>
        </div>
      </div>
    </section>
  )
}

const UPLOAD_LINES = [
  'Teaching the globe where your pop lives…',
  'Polishing the pixels. Very important work.',
  'Negotiating with one dramatic cloud…',
  'Giving your radius a tiny pep talk…',
]

function UploadGlobeModel() {
  return React.createElement('model-viewer', {
    class: styles.uploadGlobeModel,
    src: '/poplur-globe-lite.glb',
    alt: 'Spinning Poplur clay globe',
    'camera-orbit': '20deg 72deg 3.7m',
    'field-of-view': '28deg',
    exposure: '1.15',
    shadowIntensity: '1.1',
    shadowSoftness: '.8',
    'auto-rotate': true,
    'rotation-per-second': '28deg',
    interactionPrompt: 'none',
    disableZoom: true,
  })
}

function UploadingScreen({ complete = false, flow, onReset }: { complete?: boolean; flow: FlowId; onReset?: () => void }) {
  const [line, setLine] = useState(0)

  useEffect(() => {
    if (complete) return
    const timer = window.setInterval(() => setLine(current => (current + 1) % UPLOAD_LINES.length), 1800)
    return () => window.clearInterval(timer)
  }, [complete])

  return (
    <section className={`${styles.statusScreen} ${styles.globeUpload}`} aria-label={complete ? 'Posted confirmation review' : 'Upload progress review'}>
      <div className={styles.uploadDotMap} aria-hidden="true" />
      <UploadGlobeModel />
      <div className={styles.uploadWordmark}>
        <img src="/logo_text.png" alt="Poplur" />
        <span>{complete ? 'UPLOAD COMPLETE' : 'UPLOADING YOUR POP'}</span>
      </div>
      {!complete && (
        <div className={styles.globeProgress}>
          <p key={line}>{UPLOAD_LINES[line]}</p>
          <div className={styles.progressHeading}>
            <span>CH 101 · FOOD</span>
            <strong>64%</strong>
          </div>
          <div className={styles.clayProgressTrack}><i /></div>
        </div>
      )}
      {complete && (
        <div className={styles.postedOverlay} role="dialog" aria-label="Congratulations, your pop is posted">
          <div className={styles.celebrationConfetti} aria-hidden="true">
            {Array.from({ length: 38 }, (_, index) => (
              <i
                key={index}
                style={{
                  '--piece': index,
                  left: `${(index * 37) % 101}%`,
                  background: `hsl(${(index * 47) % 360} 88% 62%)`,
                  animationDelay: `${(index % 8) * -.22}s`,
                  animationDuration: `${2.5 + (index % 6) * .24}s`,
                } as React.CSSProperties}
              />
            ))}
          </div>
          <div className={styles.postedPopup}>
            <img src="/logo_icon.png" alt="" />
            <span className={styles.postedLine}>POP IS LIVE</span>
            <h2 className={styles.postedLine}>Congratulations!</h2>
            <p className={styles.postedLine}>CH 101 · FOOD</p>
            <div className={`${styles.postedRadius} ${styles.postedLine}`}><b>3.5</b><span>km radius</span></div>
            <small className={styles.postedLine}>{flow === 'map' ? 'Pinned to your confirmed location' : 'Added to your profile'}</small>
            <button type="button" className={styles.resetCube} onClick={onReset} aria-label={flow === 'map' ? 'Return to map' : 'Return to camera'}>
              <img src="/sprites/poplur_camera_kodak_y0_p14_s320.png" alt="" />
              <span>{flow === 'map' ? 'BACK TO MAP' : 'BACK TO CAMERA'}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function LocationRadiusPreview() {
  const RADIUS_MIN = .5
  const RADIUS_MAX = 25
  const RADIUS_STEP = .5
  const RADIUS_ORB_SIZE = 22
  const [radius, setRadius] = useState(3.5)
  const [radiusPalette, setRadiusPalette] = useState({
    face: '#F63B9A',
    fillA: '#ffe1f1',
    fillB: '#ff86c4',
    fillC: '#f53c99',
  })
  const mapFrameRef = useRef<HTMLIFrameElement>(null)
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
    setRadius(current => {
      if (current === nextRadius) return current
      if (withSound) playPop(.2)
      return nextRadius
    })
  }, [])

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
    const onPalette = (event: MessageEvent) => {
      if (event.source !== mapFrameRef.current?.contentWindow) return
      if (event.data?.type !== 'poplur-radius-palette') return
      const next = event.data.palette as Partial<typeof radiusPalette> | undefined
      const valid = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      if (!next || !valid(next.face) || !valid(next.fillA) || !valid(next.fillB) || !valid(next.fillC)) return
      setRadiusPalette({ face: next.face, fillA: next.fillA, fillB: next.fillB, fillC: next.fillC })
    }
    window.addEventListener('message', onPalette)
    return () => window.removeEventListener('message', onPalette)
  }, [])

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
        src="/?map=1&front=1&radiusReview=1"
        onLoad={() => updateTerrain(radius)}
      />
      <div
        className={styles.radiusPicker}
        style={{
          '--radius-face': radiusPalette.face,
          '--radius-fill-a': radiusPalette.fillA,
          '--radius-fill-b': radiusPalette.fillB,
          '--radius-fill-c': radiusPalette.fillC,
        } as React.CSSProperties}
      >
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
    </section>
  )
}

function ComposerReview({
  step,
  withTarget,
  useVideo = false,
}: {
  step: PostComposerStep
  withTarget: boolean
  useVideo?: boolean
}) {
  return (
    <PostComposer
      media={useVideo ? { kind: 'video', src: SAMPLE_VIDEO, length: '0:10' } : { kind: 'photo', src: SAMPLE_PHOTO }}
      target={withTarget ? SAMPLE_TARGET : undefined}
      initialStep={step}
      reviewMode
      onClose={() => {}}
    />
  )
}

function ScreenPreview({
  flow,
  screen,
  motionLabOpen,
  onReset,
}: {
  flow: FlowId
  screen: ScreenId
  motionLabOpen: boolean
  onReset: () => void
}) {
  if (screen === 'capture') {
    const motionLab = motionLabOpen ? '&motion-lab=1' : ''
    return <iframe title="Live camera upload screen" src={`/?view=camera&uploadReview=1${motionLab}`} />
  }
  if (screen === 'location' || screen === 'location-return') {
    return <LocationRadiusPreview />
  }
  if (screen === 'confirm') return <CaptureConfirmation />
  if (screen === 'video') {
    return <VideoEditor src={SAMPLE_VIDEO} onCancel={() => {}} onDone={() => {}} />
  }
  if (screen === 'uploading') return <UploadingScreen flow={flow} />
  if (screen === 'posted') return <UploadingScreen flow={flow} complete onReset={onReset} />

  const step: PostComposerStep = screen === 'effects'
    ? 'effects'
    : screen === 'choice'
      ? 'choice'
      : screen === 'ai'
        ? 'ai'
        : screen === 'channel' || screen === 'channel-ready'
          ? 'channel'
          : 'edit'
  const withTarget = flow === 'map' || screen === 'channel-ready'
  return <ComposerReview step={step} withTarget={withTarget} useVideo={screen === 'effects'} />
}

export default function UploadFlowReview() {
  const initial = useMemo(readRoute, [])
  const [flow, setFlow] = useState<FlowId>(initial.flow)
  const [screen, setScreen] = useState<ScreenId>(initial.screen)
  const [motionLabOpen, setMotionLabOpen] = useState(true)
  const screens = screensFor(flow)
  const current = screens.find(item => item.id === screen) ?? screens[0]

  useEffect(() => {
    document.title = `Poplur upload review — ${flow} / ${current.label}`
    writeRoute(flow, current.id)
  }, [current.id, current.label, flow])

  const chooseFlow = (next: FlowId) => {
    const first = screensFor(next)[0].id
    setFlow(next)
    setScreen(first)
  }

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.heading}>
          <span>POPLUR REVIEW</span>
          <h1>Upload flows</h1>
        </div>
        <div className={styles.flowTabs} role="tablist" aria-label="Upload entry flow">
          <button type="button" className={flow === 'camera' ? styles.flowActive : ''} onClick={() => chooseFlow('camera')}>Camera first</button>
          <button type="button" className={flow === 'map' ? styles.flowActive : ''} onClick={() => chooseFlow('map')}>Map first</button>
        </div>
        <ol className={styles.screenList}>
          {screens.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === current.id ? styles.screenActive : ''}
                onClick={() => setScreen(item.id)}
              >
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span><strong>{item.label}</strong><small>{item.note}</small></span>
                {item.gap && <em>GAP</em>}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className={styles.previewArea}>
        <header className={styles.previewHeader}>
          <div>
            <span>{flow === 'camera' ? 'CAMERA-FIRST FLOW' : 'MAP-FIRST FLOW'}</span>
            <h2>{current.label}</h2>
          </div>
          <div className={styles.previewTools}>
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
          <div key={`${flow}-${current.id}`} className={styles.deviceViewport}>
            <ScreenPreview
              flow={flow}
              screen={current.id}
              motionLabOpen={motionLabOpen}
              onReset={() => setScreen(flow === 'map' ? 'location' : 'capture')}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
