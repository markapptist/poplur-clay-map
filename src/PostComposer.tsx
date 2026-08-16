import React, { useEffect, useRef, useState } from 'react'
import styles from './PostComposer.module.css'
import { AR_FILTERS } from './ARFilters'
import { CHANNELS } from './FeedTwin'
import { playPop } from './pop'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { setPendingAICompose, setPendingMapPost, type PendingMapPost } from './cameraStore'
import VideoEditor from './VideoEditor'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import VFXStudio, {
  type VFXCueTiming,
  type VFXCustomAsset,
  type VFXEffectId,
} from './VFXStudio'
import ComposerAIChat from './ComposerAIChat'

// Web twin of PostCaptureComposerOverlay.swift — the one composer every capture
// route ends in, with the same step machine the app ships:
//
//   edit (filter + trim) → VFX Studio → original-or-AI choice → AI chat → channel
//
// It is reached from all three entry points, exactly like the native flow:
//   • the camera, after a photo/video capture
//   • the camera roll, after picking a capture
//   • the map, after tapping a coordinate to post there (carries the coordinate
//     and the claim radius through to publish)
//
// The AI step is honest about where the model actually runs: generation is the
// poplurAiApi Cloud Function, reached with a signed-in Firebase token, so inside
// the app shell this hands to the real Poplur AI screen. The browser twin has no
// account, so it says so instead of inventing a generated image.

export interface ComposerMedia {
  kind: 'photo' | 'video'
  src: string
  /** mm:ss run time, for video (matches the roll's Capture.length) */
  length?: string
}

export interface ComposerTarget {
  lat: number
  lng: number
  /** the claim radius chosen on the map, carried through to the post */
  radiusKm?: number
  /** true only when this spot answers a "pick a spot on the map" trip — the
   *  signal that a parked draft should resume. A plain map "Post here" leaves
   *  it unset and gets a FRESH camera. */
  resume?: boolean
}

export interface PublishedPost {
  media: ComposerMedia
  filterId: string
  effectId: string
  effectTiming: VFXCueTiming
  effectAsset?: VFXCustomAsset
  channelId: string
  caption: string
  usedAI: boolean
  target?: ComposerTarget
}

export type PostComposerStep = 'edit' | 'effects' | 'choice' | 'ai' | 'channel'

function previousComposerStep(step: PostComposerStep, usedAI: boolean): PostComposerStep | null {
  switch (step) {
    case 'edit': return null
    case 'effects': return 'edit'
    case 'choice': return 'effects'
    case 'ai': return 'choice'
    case 'channel': return usedAI ? 'ai' : 'choice'
  }
}

type NativeUploadResult = {
  requestId?: string
  ok?: boolean
  error?: string
}

type NativeUploadProgress = {
  requestId?: string
  /** Preferred bridge shape: a normalized 0...1 transfer fraction. */
  progress?: number
  /** iOS PostUploadService bridge field. */
  fraction?: number
  /** Accepted for native implementations that mirror Foundation Progress. */
  fractionCompleted?: number
  bytesTransferred?: number
  totalBytes?: number
  phase?: string
}

type UploadPhase = 'preparing' | 'uploading' | 'saving'

type UploadProgressUpdate = {
  fraction: number | null
  phase: UploadPhase
}

const NATIVE_UPLOAD_TIMEOUT_MS = 90_000
const MAX_PREVIEW_PLAY_MS = 12_000

function releasePreviewVideo(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function stillFromVideo(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  try {
    const canvas = document.createElement('canvas')
    const width = Math.min(720, video.videoWidth)
    canvas.width = width
    canvas.height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

/**
 * A native shell owns Firebase auth, Storage and the Firestore write. The web
 * composer must wait for that side to report the result; otherwise it can show
 * a green "Posted" state while the device has not uploaded anything yet.
 */
function normalizedUploadProgress(detail: NativeUploadProgress): number | null {
  let fraction = detail.progress ?? detail.fraction ?? detail.fractionCompleted
  if (!Number.isFinite(fraction)
      && Number.isFinite(detail.bytesTransferred)
      && Number.isFinite(detail.totalBytes)
      && Number(detail.totalBytes) > 0) {
    fraction = Number(detail.bytesTransferred) / Number(detail.totalBytes)
  }
  if (!Number.isFinite(fraction)) return null
  // A few bridges report an integer percentage. Accept that without requiring
  // a second event name, while keeping the preferred contract normalized.
  const normalized = Number(fraction) > 1 ? Number(fraction) / 100 : Number(fraction)
  return Math.min(1, Math.max(0, normalized))
}

function uploadPhase(detail: NativeUploadProgress, fraction: number | null): UploadPhase {
  const phase = detail.phase?.trim().toLowerCase() ?? ''
  if (phase.includes('queue') || phase.includes('prepar') || phase.includes('encod') || phase.includes('stag')) return 'preparing'
  if (phase.includes('sav') || phase.includes('publish') || phase.includes('finish') || phase.includes('complete')) return 'saving'
  // A completed Storage transfer can still be waiting on its Firestore post.
  if (fraction === 1) return 'saving'
  return 'uploading'
}

function awaitNativeUpload(
  requestId: string,
  onProgress: (update: UploadProgressUpdate) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Upload is taking longer than expected.'))
    }, NATIVE_UPLOAD_TIMEOUT_MS)

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<NativeUploadResult>).detail
      if (!detail || detail.requestId !== requestId) return
      cleanup()
      if (detail.ok) resolve()
      else reject(new Error(detail.error || 'The post could not be uploaded.'))
    }

    const onNativeProgress = (event: Event) => {
      const detail = (event as CustomEvent<NativeUploadProgress>).detail
      if (!detail || detail.requestId !== requestId) return
      const fraction = normalizedUploadProgress(detail)
      onProgress({ fraction, phase: uploadPhase(detail, fraction) })
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('poplur-upload-result', onResult)
      window.removeEventListener('poplur-upload-progress', onNativeProgress)
    }

    window.addEventListener('poplur-upload-result', onResult)
    window.addEventListener('poplur-upload-progress', onNativeProgress)
  })
}

export default function PostComposer({
  media: incomingMedia,
  target,
  draft,
  onClose,
  onPosted,
  bindArrows,
  bindBack,
  initialStep,
  reviewMode = false,
}: {
  media: ComposerMedia
  /** set when the post is bound to a map coordinate */
  target?: ComposerTarget
  /** a draft resumed from "pick a spot on the map" — reopens at the channel
   *  step with the caption/channel/filter the user had already chosen */
  draft?: Omit<PendingMapPost, 'media'>
  onClose: () => void
  onPosted?: (post: PublishedPost) => void
  /** Hands the clay channel arrows a job while the composer is open: stepping
   *  the filter over the capture (and the channel on the channel step). */
  bindArrows?: (fn: ((dir: 1 | -1) => void) | null) => void
  /** Registers "back one screen" for the cube — the composer's only back
   *  control now that the header's ‹ and ✕ are gone. */
  bindBack?: (fn: (() => void) | null) => void
  /** Development workbench entry point. Production capture routes omit it and
   *  continue to enter through the normal state machine. */
  initialStep?: PostComposerStep
  /** Keeps server-only actions visible in the upload-flow review workbench. */
  reviewMode?: boolean
}) {
  const [step, setStep] = useState<PostComposerStep>(draft ? 'channel' : initialStep ?? 'edit')
  const [filterId, setFilterId] = useState(draft?.filterId ?? 'none')
  const [effectId, setEffectId] = useState<VFXEffectId>((draft?.effectId as VFXEffectId | undefined) ?? 'none')
  const [effectTiming, setEffectTiming] = useState<VFXCueTiming>(draft?.effectTiming ?? {
    startSeconds: 0,
    durationSeconds: 2.5,
    engine: 'none',
  })
  const [effectAsset, setEffectAsset] = useState<VFXCustomAsset | null>(draft?.effectAsset ?? null)
  const [caption, setCaption] = useState(draft?.caption ?? '')
  // The editor hands back a NEW clip (trimmed, scored), which then stands in
  // for the capture everywhere below — preview, bake-for-upload, the draft
  // stashed for the map trip. Held separately from the prop so backing out of
  // the editor leaves the original untouched.
  const [editedMedia, setEditedMedia] = useState<ComposerMedia | null>(null)
  const media = editedMedia ?? incomingMedia
  const [editorOpen, setEditorOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [usedAI, setUsedAI] = useState(draft?.usedAI ?? false)
  const [channelId, setChannelId] = useState(draft?.channelId ?? CHANNELS[0]?.id ?? 'food')
  const [radiusKm, setRadiusKm] = useState(target?.radiusKm ?? 3)
  const [posted, setPosted] = useState(false)
  const [publishing, setPublishing] = useState(false)
  // A percentage is displayed only when the host reports real transferred
  // bytes. Preparing/awaiting-native phases stay visibly indeterminate rather
  // than filling a made-up timeline that could reach 99% and stall.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadPhaseState, setUploadPhaseState] = useState<UploadPhase>('preparing')
  // Set when the post could NOT actually be uploaded (browser preview has no
  // account) — the confirmation must never imply an upload that did not happen.
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const filterCss = AR_FILTERS.find(f => f.id === filterId)?.css ?? 'none'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      const previous = previousComposerStep(step, usedAI)
      if (previous === null) onClose()
      else setStep(previous)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step, usedAI])

  // The cube's back: one screen at a time, closing from the first. Matches
  // the Escape key exactly.
  // The preview had `autoPlay loop muted playsInline` and still came up frozen
  // on a black frame. Those attributes only make autoplay ALLOWED, not
  // guaranteed: WKWebView routinely declines the automatic start for a source
  // that is still arriving (a fresh MediaRecorder blob is exactly that), and a
  // declined autoplay is silent — no error, no event, just a video that never
  // moves. Asking explicitly once the data is there is what actually starts it.
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const filterRailRef = useRef<HTMLDivElement | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(() =>
    incomingMedia.kind === 'video'
      && (typeof document === 'undefined' || !document.hidden)
      && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed)
  const [previewStill, setPreviewStill] = useState<string | null>(null)

  const retirePreview = React.useCallback(() => {
    const video = previewVideoRef.current
    if (video) {
      const still = stillFromVideo(video)
      if (still) setPreviewStill(still)
      releasePreviewVideo(video)
    }
    setPreviewPlaying(false)
  }, [])

  // A new capture receives one automatic, muted pass. Subsequent passes are
  // explicit taps, and every pass has the same hard decoder lease.
  useEffect(() => {
    setPreviewStill(null)
    setPreviewPlaying(media.kind === 'video'
      && !document.hidden
      && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed)
  }, [media.kind, media.src])

  // The editor owns this source while it is open. Unmounting the composer's
  // player avoids two decoders reading the same recording behind the overlay.
  useEffect(() => {
    if (editorOpen) retirePreview()
  }, [editorOpen, retirePreview])

  // The channel step owns a compact, framed playback preview. Retire the
  // full-bleed player before mounting it so one clip never consumes two video
  // decoder leases at the same time on a phone.
  useEffect(() => {
    if (step === 'channel') retirePreview()
  }, [retirePreview, step])

  useEffect(() => PoplurPerformanceManager.subscribe(snapshot => {
    if (!snapshot.isForeground || !snapshot.expensiveVideoBackedTexturesAllowed) retirePreview()
  }), [retirePreview])

  useEffect(() => {
    const v = previewVideoRef.current
    if (!v || media.kind !== 'video' || !previewPlaying || editorOpen) return
    if (!v.getAttribute('src')) {
      v.src = media.src
      v.load()
    }
    let cancelled = false
    const kick = () => {
      if (cancelled) return
      // muted is what makes an unattended play() legal on iOS; set it here too
      // in case something upstream cleared the attribute.
      v.muted = true
      void v.play().catch(() => { /* a later readiness event will retry */ })
    }
    kick()
    v.addEventListener('loadeddata', kick)
    v.addEventListener('canplay', kick)
    const lease = window.setTimeout(retirePreview, MAX_PREVIEW_PLAY_MS)
    const onVisibility = () => { if (document.hidden) retirePreview() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', retirePreview)
    return () => {
      cancelled = true
      window.clearTimeout(lease)
      v.removeEventListener('loadeddata', kick)
      v.removeEventListener('canplay', kick)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', retirePreview)
      releasePreviewVideo(v)
    }
  }, [editorOpen, media.kind, media.src, previewPlaying, retirePreview])

  const backRef = useRef({ step, usedAI, onClose })
  backRef.current = { step, usedAI, onClose }
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      const { step: current, usedAI: currentUsesAI, onClose: close } = backRef.current
      const previous = previousComposerStep(current, currentUsesAI)
      if (previous === null) close()
      else setStep(previous)
    })
    return () => bindBack(null)
  }, [bindBack])

  /** Bake the chosen filter into the pixels so the post carries what you saw.
   *  Photos are re-drawn through the CSS filter here; video keeps its filter id
   *  so the shell can apply it during export (the browser cannot re-encode a
   *  clip cheaply, and native already has PostCaptureMediaProcessor for it). */
  const renderForUpload = (): Promise<string> => new Promise(resolve => {
    if (media.kind !== 'photo' || filterCss === 'none') return resolve(media.src)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(media.src)
      ctx.filter = filterCss
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => resolve(media.src)
    img.src = media.src
  })

  /** Blob URLs (recordings) cannot cross the native bridge — read the bytes. */
  const asTransferable = async (src: string): Promise<string> => {
    if (!src.startsWith('blob:')) return src
    const blob = await fetch(src).then(r => r.blob())
    return await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
  }

  // The clay channel arrows drive the composer while it is open: on the edit
  // step they walk the filters over your capture (so you can flick through
  // looks without reaching for the rail), and on the channel step they walk the
  // channels — in both cases the arrows do the thing the screen is about.
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    if (!bindArrows) return
    bindArrows((dir: 1 | -1) => {
      playPop()
      if (stepRef.current === 'channel') {
        setChannelId(current => {
          const i = CHANNELS.findIndex(c => c.id === current)
          return CHANNELS[((i + dir) % CHANNELS.length + CHANNELS.length) % CHANNELS.length].id
        })
        return
      }
      setFilterId(current => {
        const i = AR_FILTERS.findIndex(f => f.id === current)
        return AR_FILTERS[((i + dir) % AR_FILTERS.length + AR_FILTERS.length) % AR_FILTERS.length].id
      })
    })
    return () => bindArrows(null)
  }, [bindArrows])

  // Keep the selected look in view whether it was chosen by touch or by the
  // persistent clay arrows. The rail itself remains a small pool of image
  // views over one decoded source; it never opens another video decoder.
  useEffect(() => {
    if (step !== 'edit') return
    const selected = filterRailRef.current?.querySelector<HTMLElement>(
      `[data-filter-id="${filterId}"]`,
    )
    selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [filterId, step])

  const publish = async () => {
    playPop()
    setPublishing(true)
    setUploadProgress(null)
    setUploadPhaseState('preparing')
    const post: PublishedPost = {
      media,
      filterId,
      effectId,
      effectTiming,
      effectAsset: effectAsset ?? undefined,
      channelId,
      caption,
      usedAI,
      target: target && { ...target, radiusKm },
    }
    try {
      // The app shell owns the account, Firebase Storage and the posts write
      // (UploadPostToCoordinate / UploadImageToCurrentCoordinate). Hand it the
      // finished post rather than re-implementing auth inside this bundle.
      if (isNativeShell()) {
        const baked = await renderForUpload()
        const data = await asTransferable(baked)
        const requestId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        // Install both listeners before native receives the message. Decode
        // failures can answer immediately, and the first byte-progress event
        // must not be lost to a bridge race.
        const uploadResult = awaitNativeUpload(requestId, update => {
          setUploadPhaseState(update.phase)
          setUploadProgress(current => {
            if (update.fraction === null) return current
            return current === null ? update.fraction : Math.max(current, update.fraction)
          })
        })
        setUploadPhaseState('uploading')
        postNativeEvent({
          type: 'publishPost',
          requestId,
          kind: media.kind,
          data,
          caption,
          channelId,
          filterId,
          effectId,
          effectStartSeconds: effectTiming.startSeconds,
          effectDurationSeconds: effectTiming.durationSeconds,
          effectEngine: effectTiming.engine,
          effectAssetUrl: effectAsset?.modelUrl,
          effectAssetTaskId: effectAsset?.taskId,
          effectAssetPrompt: effectAsset?.prompt,
          usedAI,
          latitude: target?.lat,
          longitude: target?.lng,
          radiusKm: target ? radiusKm : undefined,
        })
        await uploadResult
        onPosted?.(post)
        setPosted(true)
        window.setTimeout(onClose, 1800)
      } else {
        setUploadNote('Posting needs your Poplur account, so it uploads from the app — nothing was sent from this browser preview.')
        // The claim still paints: the browser preview is where flows are
        // inspected, and the map half of the capture loop is part of the flow.
        onPosted?.(post)
        setPosted(true)
        window.setTimeout(onClose, 2600)
      }
    } catch (error) {
      setUploadNote(error instanceof Error ? error.message : 'That post could not be prepared for upload. Your capture is still in the camera roll.')
      setPosted(true)
    } finally {
      setPublishing(false)
    }
  }

  const uploadPhaseLabel = uploadPhaseState === 'preparing'
    ? 'Preparing your pop'
    : uploadPhaseState === 'saving'
      ? 'Finishing your pop'
      : 'Uploading your pop'
  const uploadPercent = uploadProgress === null ? null : Math.round(uploadProgress * 100)
  const composerStepLabel = step === 'edit'
    ? 'FILTER'
    : step === 'effects'
      ? 'VFX STUDIO'
      : step === 'choice'
        ? 'ORIGINAL OR AI'
      : step === 'ai'
        ? 'POPLUR AI'
        : target
          ? 'READY TO POST'
          : 'CHANNEL'
  const filterPreviewSrc = media.kind === 'photo' ? media.src : previewStill

  const preview = (
    <div className={styles.preview}>
      {media.kind === 'video' ? (
        <>
          {previewPlaying && !editorOpen ? (
            <video
              ref={previewVideoRef}
              className={styles.media}
              src={media.src}
              style={{ filter: filterCss === 'none' ? undefined : filterCss }}
              autoPlay muted playsInline preload="metadata"
              onLoadedData={event => {
                if (previewStill) return
                const still = stillFromVideo(event.currentTarget)
                if (still) setPreviewStill(still)
              }}
              onEnded={retirePreview}
              onClick={retirePreview}
            />
          ) : previewStill ? (
            <img
              className={styles.media}
              src={previewStill}
              alt="Your video preview"
              style={{ filter: filterCss === 'none' ? undefined : filterCss }}
            />
          ) : null}
          {!editorOpen && !previewPlaying && (
            <button
              type="button"
              className={styles.previewReplay}
              onClick={() => {
                if (!document.hidden && PoplurPerformanceManager.snapshot.expensiveVideoBackedTexturesAllowed) {
                  setPreviewPlaying(true)
                }
              }}
              aria-label="Play video preview"
            >▶</button>
          )}
        </>
      ) : (
        <img
          className={styles.media}
          src={media.src}
          alt="Your capture"
          style={{ filter: filterCss === 'none' ? undefined : filterCss }}
        />
      )}
    </div>
  )

  if (posted) {
    return (
      <div className={styles.stage} role="dialog" aria-label="Posted">
        <div className={styles.doneWrap}>
          <div className={styles.doneEmblem}>
            <img src="logo_icon.png" alt="" />
            <span className={styles.doneTick}>{uploadNote ? '↑' : '✓'}</span>
          </div>
          <span className={styles.doneEyebrow}>{uploadNote ? 'CAPTURE SAVED' : 'POP IS LIVE'}</span>
          <h2 className={styles.doneTitle}>{uploadNote ? 'Not uploaded' : 'Posted'}</h2>
          <p className={styles.doneMeta}>
            {CHANNELS.find(c => c.id === channelId)?.name} · CH {CHANNELS.find(c => c.id === channelId)?.number}
            {target ? ` · ${radiusKm.toFixed(1)} km radius` : ''}
          </p>
          {uploadNote && <p className={styles.doneNote}>{uploadNote}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.stage} role="dialog" aria-label="Post composer" aria-busy={publishing}>
      {/* No header, no ‹, no ✕ — the cube is the back button here, like every
          subscreen. The capture IS the screen. */}
      {preview}

      {!editorOpen && !publishing && (
        <div className={styles.composerChrome} aria-hidden="true">
          <img src="logo_icon.png" alt="" />
          <span>{composerStepLabel}</span>
        </div>
      )}

      {publishing && (
        <section className={styles.uploadProgressCard} aria-label="Post upload progress">
          <div className={styles.uploadProgressHead}>
            <span aria-live="polite">{uploadPhaseLabel}</span>
            <b aria-hidden="true">{uploadPercent === null ? 'IN PROGRESS' : `${uploadPercent}%`}</b>
          </div>
          <div
            className={`${styles.uploadProgressTrack} ${uploadPercent === null ? styles.uploadProgressTrackIndeterminate : ''}`}
            role="progressbar"
            aria-label={uploadPhaseLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadPercent ?? undefined}
            aria-valuetext={uploadPercent === null ? `${uploadPhaseLabel}, in progress` : `${uploadPercent}%`}
          >
            <span
              className={styles.uploadProgressFill}
              style={uploadProgress === null ? undefined : { width: `${uploadProgress * 100}%` }}
            />
          </div>
          <p>{uploadPercent === null ? 'Keeping your capture safe while Poplur sends it.' : 'Your capture is uploading securely.'}</p>
        </section>
      )}

      {/* ── 1. edit: full-bleed capture, Snapchat-style. The clay channel
             arrows flip through the filters; the name of the current one
             floats at the base in shader text. ─────────────────────────── */}
      {editorOpen && media.kind === 'video' && (
        <VideoEditor
          src={media.src}
          onCancel={() => { playPop(); setEditorOpen(false) }}
          onDone={edit => {
            // Keep the run time honest: the strip, the roll and the composer
            // all read `length`, and leaving the original there would label a
            // 4s trim as the 30s take it came from.
            const seconds = Math.max(0, Math.round(edit.trimEnd - edit.trimStart))
            setEditedMedia({
              kind: 'video',
              src: edit.src,
              length: `0:${String(seconds).padStart(2, '0')}`,
            })
            setEditorOpen(false)
            if (edit.unbaked) {
              setUploadNote('This device could not render the edit, so the original clip was kept.')
            }
          }}
        />
      )}

      {step === 'edit' && (
        <>
          {/* Trimming and scoring is a WORKBENCH, not another rail on top of
              the viewfinder — it needs the whole screen for a filmstrip you can
              actually hit with a thumb. Video only: there is nothing to trim on
              a still, and a button that opened an empty timeline would be a
              worse answer than no button. */}
          {media.kind === 'video' && (
            <button
              className={styles.editFab}
              onClick={() => { playPop(); setEditorOpen(true) }}
              aria-label="Trim and add music"
            >✂ TRIM &amp; MUSIC</button>
          )}
          <button
            className={styles.nextFab}
            onClick={() => { playPop(); setStep('effects') }}
            aria-label="Continue to post"
            title="Next"
          ><span aria-hidden="true">›</span></button>
          <div className={styles.filterBrowser}>
            <span
              key={filterId}
              className={`${styles.filterName} ${styles.filterNameShader}`}
              aria-live="polite"
            >
              {AR_FILTERS.find(f => f.id === filterId)?.label ?? 'ORIGINAL'}
            </span>
            <div
              ref={filterRailRef}
              className={styles.filterPreviewRail}
              role="group"
              aria-label="Filter previews"
            >
              {AR_FILTERS.map(filter => {
                const selected = filter.id === filterId
                return (
                  <button
                    key={filter.id}
                    type="button"
                    data-filter-id={filter.id}
                    className={`${styles.filterPreviewButton} ${selected ? styles.filterPreviewButtonOn : ''}`}
                    onClick={() => {
                      playPop()
                      setFilterId(filter.id)
                    }}
                    aria-label={`Apply ${filter.label} filter`}
                    aria-pressed={selected}
                  >
                    <span className={styles.filterPreviewImageWrap}>
                      <img
                        src={filterPreviewSrc ?? filter.thumbnail}
                        alt=""
                        className={styles.filterPreviewImage}
                        style={filterPreviewSrc && filter.css !== 'none' ? { filter: filter.css } : undefined}
                        draggable={false}
                      />
                    </span>
                    <span className={styles.filterPreviewLabel}>{filter.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── 2. VFX: GPU-backed overlays and tracked graphics ──────────────── */}
      {step === 'effects' && (
        <VFXStudio
          media={media}
          value={effectId}
          timing={effectTiming}
          customAsset={effectAsset}
          onChange={effect => { playPop(); setEffectId(effect) }}
          onTimingChange={setEffectTiming}
          onCustomAssetChange={setEffectAsset}
          onContinue={() => { playPop(); setStep('choice') }}
        />
      )}

      {/* ── 3. Explicit original-or-AI fork. This decision belongs in both
             entry orders; reaching the AI chat must never imply consent. ── */}
      {step === 'choice' && (
        <div className={`${styles.panel} ${styles.panelCentered} ${styles.choicePanel}`}>
          <img className={styles.panelEmblem} src="logo_icon.png" alt="" />
          <span className={styles.panelLabel}>YOUR EDIT IS READY</span>
          <h2 className={styles.choiceHead}>Post this version or create with Poplur AI?</h2>
          <button
            type="button"
            className={`${styles.secondary} ${styles.choiceAction}`}
            onClick={() => { playPop(); setUsedAI(false); setStep('channel') }}
          >
            <b aria-hidden="true">✓</b>
            <span>Post original</span>
          </button>
          <button
            type="button"
            className={`${styles.primary} ${styles.choiceAction}`}
            onClick={() => { playPop(); setUsedAI(false); setStep('ai') }}
          >
            <b aria-hidden="true">P</b>
            <span>Create with Poplur AI</span>
          </button>
        </div>
      )}

      {/* ── 4. AI: the same conversational surface as the camera subscreen ── */}
      {step === 'ai' && (
        <ComposerAIChat
          media={media}
          prompt={aiPrompt}
          onPromptChange={setAiPrompt}
          onGenerate={() => {
            playPop()
            if (reviewMode) {
              setUsedAI(true)
              setStep('channel')
              return
            }
            setPendingAICompose({
              media,
              prompt: aiPrompt,
              caption,
              channelId,
              filterId,
              effectId,
              effectTiming,
              effectAsset: effectAsset ?? undefined,
            })
            window.dispatchEvent(new CustomEvent('poplur-ai-compose'))
            postNativeEvent({ type: 'holdMenuNavigate', action: 'create' })
            onClose()
          }}
          onUseOriginal={() => { playPop(); setUsedAI(false); setStep('channel') }}
        />
      )}

      {/* ── 5. channel (+ radius when posting to a coordinate) ─────────────── */}
      {step === 'channel' && (
        <div className={`${styles.panel} ${styles.channelPanel}`}>
          <span className={styles.panelLabel}>CAPTION</span>
          <input
            className={styles.caption}
            value={caption}
            placeholder="Add a caption…"
            onChange={e => setCaption(e.target.value)}
          />
          {target && (
            <label className={styles.radiusRow}>
              <span>Claim radius <b>{radiusKm.toFixed(1)} km</b></span>
              <input
                type="range" min={0.5} max={25} step={0.5}
                value={radiusKm}
                onChange={e => setRadiusKm(Number(e.target.value))}
              />
            </label>
          )}
          <span className={styles.panelLabel}>CHANNEL</span>
          <div className={styles.channels}>
            {CHANNELS.map(c => (
              <button
                key={c.id}
                className={c.id === channelId ? `${styles.chan} ${styles.chanOn}` : styles.chan}
                onClick={() => { playPop(); setChannelId(c.id) }}
                aria-pressed={c.id === channelId}
              >
                <img className={styles.chanIcon} src={`channels/${c.icon}.png`} alt="" />
                <span className={styles.chanNum}>CH {c.number}</span>
                <span className={styles.chanName}>{c.name}</span>
              </button>
            ))}
          </div>
          <section className={target ? styles.readyPreview : styles.channelContentPreview} aria-label="Post preview">
            <div className={styles.channelPreviewMedia}>
              {media.kind === 'video' ? (
                <video src={media.src} autoPlay muted loop playsInline preload="metadata" />
              ) : (
                <img src={media.src} alt="Post preview" />
              )}
              <span>CH {CHANNELS.find(c => c.id === channelId)?.number}</span>
              <strong>{caption || 'Your pop preview'}</strong>
            </div>
            {target && (
              <div className={styles.confirmedMiniMap} aria-label="Confirmed post location">
                <i /><i /><i /><i /><i />
                <img src="sprites/poplur_pin_lite_y0_p0_s256.png" alt="Confirmed location" />
                <span><b>CONFIRMED LOCATION</b><small>{target.lat.toFixed(4)}, {target.lng.toFixed(4)}</small></span>
              </div>
            )}
          </section>
          {!target && (
            /* Camera→map: the May '26 CaptureFlow direction the web home lost.
               The draft (media + choices) is stashed module-side, the map tab
               opens, and the spot the user taps comes back as a normal
               poplur-post-here target — the composer then resumes right here
               with everything kept. */
            <button
              className={`${styles.secondary} ${styles.spotButton}`}
              onClick={() => {
                playPop()
                setPendingMapPost({
                  media,
                  caption,
                  channelId,
                  filterId,
                  effectId,
                  effectTiming,
                  effectAsset: effectAsset ?? undefined,
                  usedAI,
                })
                // CustomEvent, NOT postMessage: HomeTwin's message handler
                // opens with `event.source !== mapIframe → return`, so a
                // same-document postMessage is silently dropped. Same-document
                // signals here travel as CustomEvents (see poplur-engagement).
                window.dispatchEvent(new CustomEvent('poplur-pick-spot'))
                onClose()
              }}
            >
              <img src="sprites/poplur_pin_lite_y0_p0_s256.png" alt="" />
              <span>Pick a spot on the map</span>
            </button>
          )}
          {/* A pop IS ground. Posting without a spot was the one path that let
              a post exist with no place attached — it uploaded to "wherever you
              happen to be", which is not a decision the user made and is not
              something they can see before committing. The spot is now a
              precondition, so the only way to post is to have chosen where.

              Disabled rather than hidden: a button that vanishes reads as a
              bug, while a disabled one with the reason under it teaches the
              step. `📍 Pick a spot on the map` directly above is the way out,
              so this is never a dead end. */}
          <button
            className={styles.primary}
            onClick={() => { void publish() }}
            disabled={publishing || !target}
          >
            {publishing ? 'Uploading…' : target ? 'Post to this spot' : 'Pick a spot to post'}
          </button>
          {!target && !publishing && (
            <p className={styles.needSpot}>
              Location required before posting.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
