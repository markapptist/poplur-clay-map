import { renderMessageCard } from './newsMessageDraft'
import React, { useEffect, useRef, useState } from 'react'
import styles from './PostComposer.module.css'
import { photoViewSeconds } from './mediaTiming'
import { awaitNativeUpload, NativeUploadError, type UploadPhase } from './nativeUpload'
import { AR_FILTERS } from './ARFilters'
import { CHANNELS, POSTABLE_CHANNELS } from './FeedTwin'
import { channelUrl } from './assetPacks'
import { playPop } from './pop'
import { playCubeNavigationPop } from './cubeNavigationSound'
import {
  aiImageSourceDataURL,
  generateWithPoplurAI,
  materializeAIGeneratedImage,
  prepareAIImageSource,
} from './aiGeneration'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { track } from './analytics'
import { getLastSceneTerms, setPendingMapPost, type PendingMapPost } from './cameraStore'
import { dropNewsMessage, type NewsMediaAttachment } from './newsMessages'
import VideoEditor from './VideoEditor'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import VFXStudio, {
  type VFXCueTiming,
  type VFXCustomAsset,
  type VFXEffectId,
} from './VFXStudio'
import ComposerAIChat from './ComposerAIChat'
import UploadStatusView from './UploadStatusView'
import ShellOverlayPortal from './ShellOverlayPortal'
import {
  createClientPostId,
  POST_RIGHTS_VERSION,
  POST_SCHEMA_VERSION,
  publicCoordinate,
  publicCoordinateCell,
  validatePublishPrivacy,
  type PostLocationVisibility,
} from './publishing'
import { PIN_COLOR_IDS, PIN_COLOR_SWATCH, type PinColorId } from './pinColors'
import {
  accountPrivacySnapshot,
  hidesPublicPostOrigin,
  onAccountPrivacyChange,
} from './accountPrivacy'
import { CLAIM_RADIUS_SEED_KM, clampClaimRadiusKm, formatClaimRadiusKm, preferredClaimRadiusKm } from './claimRadius'
import { useClaimRadiusLimitKm } from './useClaimRadiusLimit'

// Web twin of PostCaptureComposerOverlay.swift — the one composer every capture
// route ends in, with the same step machine the app ships:
//
//   choose version (original or AI) → location → review → publish
//   Filters, video tools and VFX stay available as one optional edit-tools trip.
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

import { carouselSlides } from './carouselSlides'
export { MAX_CAROUSEL_ITEMS, carouselSlides } from './carouselSlides'

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
  destination: 'feed' | 'tv'
  postId: string
  audience: 'public'
  locationVisibility: PostLocationVisibility
  /** The poster's chosen pin model colour; null keeps the original pink pin. */
  pinColor: PinColorId | null
  photoViewSeconds: number | null
}

export type PostComposerStep = 'edit' | 'effects' | 'finish' | 'channel'

function previousComposerStep(step: PostComposerStep): PostComposerStep | null {
  switch (step) {
    case 'edit': return 'finish'
    case 'effects': return 'edit'
    case 'finish': return null
    case 'channel': return 'finish'
  }
}

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

export default function PostComposer({
  items,
  media: incomingMedia,
  target,
  draft,
  onClose,
  onPosted,
  bindArrows,
  bindBack,
  initialStep,
  reviewMode = false,
  onStepChange,
  onRequestLocation,
}: {
  /** Every slide of a carousel, cover first. Omit for a single-media post —
   *  omitted and a one-item array mean the same thing, and both keep the wire
   *  format byte-identical to what it was before carousels existed. */
  items?: readonly ComposerMedia[]
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
  /** Keeps the review workbench route and its real composer interaction in
   * lockstep. Production callers do not need to observe internal stages. */
  onStepChange?: (step: PostComposerStep) => void
  /** Review surfaces can own navigation to the canonical location stage
   * without dispatching production HomeTwin events. */
  onRequestLocation?: () => void
}) {
  const [step, setStep] = useState<PostComposerStep>(draft ? 'channel' : initialStep ?? 'finish')
  const [filterId, setFilterId] = useState(draft?.filterId ?? 'none')
  const [effectId, setEffectId] = useState<VFXEffectId>((draft?.effectId as VFXEffectId | undefined) ?? 'none')
  const [effectTiming, setEffectTiming] = useState<VFXCueTiming>(draft?.effectTiming ?? {
    startSeconds: 0,
    durationSeconds: 2.5,
    engine: 'none',
  })
  const [effectAsset, setEffectAsset] = useState<VFXCustomAsset | null>(draft?.effectAsset ?? null)
  const [photoSeconds, setPhotoSeconds] = useState<number | null>(photoViewSeconds(draft?.photoViewSeconds))
  const [caption, setCaption] = useState(draft?.caption ?? '')
  // Keep the non-AI/manual-edit baseline separate from an accepted AI image.
  // Otherwise Back → "Keep original" can mislabel and upload the AI pixels.
  const [baselineMedia, setBaselineMedia] = useState<ComposerMedia>(
    () => draft?.originalMedia ?? incomingMedia,
  )
  const [selectedAIMedia, setSelectedAIMedia] = useState<ComposerMedia | null>(
    () => draft?.usedAI ? incomingMedia : null,
  )
  useEffect(() => {
    if (draft?.messageCard) setBaselineMedia(renderMessageCard(caption))
  }, [caption, draft?.messageCard])
  const media = selectedAIMedia ?? baselineMedia
  const [editorOpen, setEditorOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState(draft?.aiPrompt ?? '')
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiCandidate, setAiCandidate] = useState<string | null>(null)
  const [aiGenerating, setAiGenerating] = useState(false)
  const aiRequestRef = useRef<AbortController | null>(null)
  const [usedAI, setUsedAI] = useState(draft?.usedAI ?? false)
  const usedAIRef = useRef(usedAI)
  usedAIRef.current = usedAI
  // Every channel a recording can go to. LIVE is not one of them — it carries
  // whoever is broadcasting right now, so a photo filed there would be
  // published into a channel that never shows it.
  const channelChoices = POSTABLE_CHANNELS()
  const [channelId, setChannelId] = useState(draft?.channelId ?? channelChoices[0]?.id ?? 'food')
  const [pinColor, setPinColor] = useState<PinColorId | null>(draft?.pinColor ?? null)
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const claimRadiusMaxKm = useClaimRadiusLimitKm()
  const [radiusKm, setRadiusKm] = useState(() => target?.radiusKm === undefined
    ? preferredClaimRadiusKm(claimRadiusMaxKm)
    : clampClaimRadiusKm(target.radiusKm, claimRadiusMaxKm))
  const [accountPrivacy, setAccountPrivacy] = useState(accountPrivacySnapshot)
  const locationVisibility: PostLocationVisibility = hidesPublicPostOrigin(accountPrivacy)
    ? 'hidden'
    : 'approximate'
  const [rightsAttested, setRightsAttested] = useState(draft?.rightsAttested ?? false)
  const [posted, setPosted] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const publishingRef = useRef(false)
  const closeTimerRef = useRef(0)
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])
  const postIdRef = useRef(createClientPostId())
  // A percentage is displayed only when the host reports real transferred
  // bytes. Preparing/awaiting-native phases stay visibly indeterminate rather
  // than filling a made-up timeline that could reach 99% and stall.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadPhaseState, setUploadPhaseState] = useState<UploadPhase>('preparing')
  // Set when the post could NOT actually be uploaded (browser preview has no
  // account) — the confirmation must never imply an upload that did not happen.
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<{ message: string; retryable: boolean } | null>(null)
  const filterCss = AR_FILTERS.find(f => f.id === filterId)?.css ?? 'none'
  const reviewInitialStepRef = useRef(initialStep)

  useEffect(() => onAccountPrivacyChange(setAccountPrivacy), [])

  useEffect(() => () => {
    aiRequestRef.current?.abort()
    aiRequestRef.current = null
  }, [])

  // The upload-flow workbench can jump directly between canonical stages.
  // Sync only when its requested stage PROP changes; watching `step` here
  // would race the composer's own Next buttons and snap them backwards before
  // the workbench had time to update its route.
  useEffect(() => {
    if (!reviewMode || !initialStep || reviewInitialStepRef.current === initialStep) return
    reviewInitialStepRef.current = initialStep
    setStep(initialStep)
  }, [initialStep, reviewMode])

  useEffect(() => {
    if (!reviewMode || target?.radiusKm === undefined) return
    setRadiusKm(clampClaimRadiusKm(target.radiusKm, claimRadiusMaxKm))
  }, [claimRadiusMaxKm, reviewMode, target?.radiusKm])

  // The account total arrives from Firestore after this composer can already
  // be open. Clamping alone used to be unsafe here, because a picker that
  // opened before the total landed opened at zero and clamping only lowers.
  // The limit now floors at the discovery seed, so there is nothing to rescue.
  useEffect(() => {
    setRadiusKm(current => clampClaimRadiusKm(current, claimRadiusMaxKm))
  }, [claimRadiusMaxKm])

  // The cube's back: one screen at a time, closing from the first. Matches
  // the Escape key exactly.
  // The preview had `autoPlay loop muted playsInline` and still came up frozen
  // on a black frame. Those attributes only make autoplay ALLOWED, not
  // guaranteed: WKWebView routinely declines the automatic start for a source
  // that is still arriving (a fresh MediaRecorder blob is exactly that), and a
  // declined autoplay is silent — no error, no event, just a video that never
  // moves. Asking explicitly once the data is there is what actually starts it.
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  // A capture-only decoder for exactly the gap above: whenever the governor
  // has not (yet, or ever, this visit) allowed the looping preview to play,
  // this hidden element still loads the same source just far enough to hand
  // stillFromVideo a real frame — one decode, never played, released the
  // moment the still lands. Without it there is no path to a still at all
  // and the preview renders nothing.
  const captureVideoRef = useRef<HTMLVideoElement | null>(null)
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

  const goToStep = React.useCallback((next: PostComposerStep) => {
    // Pause/detach the current owner inside the gesture, before React commits a
    // VFX/AI/channel child that may acquire the same clip on its next effect.
    retirePreview()
    setStep(next)
    onStepChange?.(next)
  }, [onStepChange, retirePreview])

  const parkDraftForLocation = React.useCallback((
    selectedMedia: ComposerMedia = media,
    selectedUsedAI = usedAIRef.current,
  ) => {
    retirePreview()
    setPendingMapPost({
      media: selectedMedia,
      originalMedia: baselineMedia,
      messageCard: draft?.messageCard,
      newsMessage: draft?.newsMessage,
      caption,
      photoViewSeconds: media.kind === 'photo' ? photoSeconds : null,
      channelId,
      filterId,
      effectId,
      effectTiming,
      effectAsset: effectAsset ?? undefined,
      usedAI: selectedUsedAI,
      rightsAttested,
      aiPrompt,
      pinColor,
      // What the lens read, carried to the map so its shortlist can weigh the
      // capture's own content and not only the channel it was filed under.
      sceneTerms: getLastSceneTerms(),
    })
    // CustomEvent, NOT postMessage: HomeTwin's message handler accepts only
    // messages from the map iframe. This same-document signal deliberately
    // starts the one location-picker detour for the parked draft.
    window.dispatchEvent(new CustomEvent('poplur-pick-spot'))
    onClose()
  }, [aiPrompt, baselineMedia, caption, channelId, effectAsset, effectId, effectTiming, filterId, media, onClose, photoSeconds, pinColor, retirePreview, rightsAttested, draft?.messageCard, draft?.newsMessage])

  const continueAfterFinish = React.useCallback((
    selectedMedia: ComposerMedia = media,
    selectedUsedAI = usedAIRef.current,
  ) => {
    // Camera-first must choose ground before the final form. Previously it
    // entered `channel` once without a target, left for the map, then mounted
    // the same form a second time after the return.
    if (!target && !reviewMode) {
      parkDraftForLocation(selectedMedia, selectedUsedAI)
      return
    }
    goToStep('channel')
  }, [goToStep, media, parkDraftForLocation, reviewMode, target])

  const requestLocation = React.useCallback(() => {
    if (reviewMode && onRequestLocation) {
      onRequestLocation()
      return
    }
    parkDraftForLocation()
  }, [onRequestLocation, parkDraftForLocation, reviewMode])

  useEffect(() => {
    const finishAIHandoff = (event: Event) => {
      const generated = (event as CustomEvent<{ media?: ComposerMedia }>).detail?.media
      if (generated?.kind === 'photo' && /^https:\/\//i.test(generated.src)) {
        setAiGenerating(true)
        setAiError(null)
        setAiStatus('Preparing your AI version for upload…')
        void materializeAIGeneratedImage(generated.src).then(src => {
          const selectedMedia: ComposerMedia = { kind: 'photo', src }
          setSelectedAIMedia(selectedMedia)
          usedAIRef.current = true
          setUsedAI(true)
          setAiStatus(null)
          continueAfterFinish(selectedMedia, true)
        }).catch(error => {
          setAiStatus(null)
          setAiError(error instanceof Error ? error.message : 'That AI image could not be prepared for upload.')
        }).finally(() => setAiGenerating(false))
        return
      }
      if (generated?.kind === 'photo' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(generated.src)) {
        setSelectedAIMedia(generated)
        usedAIRef.current = true
        setUsedAI(true)
        continueAfterFinish(generated, true)
        return
      }
      setAiStatus(null)
      setAiError('Poplur AI did not return an uploadable image. Your original is still safe.')
    }
    window.addEventListener('poplur-ai-compose-finished', finishAIHandoff)
    return () => window.removeEventListener('poplur-ai-compose-finished', finishAIHandoff)
  }, [continueAfterFinish])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      retirePreview()
      if (step === 'channel' && target?.resume && !reviewMode) {
        parkDraftForLocation()
        return
      }
      const previous = previousComposerStep(step)
      if (previous === null) onClose()
      else {
        setStep(previous)
        onStepChange?.(previous)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStepChange, parkDraftForLocation, retirePreview, reviewMode, step, target?.resume])

  useEffect(() => {
    setPreviewStill(null)
  }, [baselineMedia.kind, baselineMedia.src])

  // Tell the shell when an actual editing step is up (Filters, VFX Studio) so
  // the cube can wear the director board while you work — the same
  // window-event route ProfileTwin and MailScreen use for their own screen
  // state, since PostComposer has no prop channel to the cube either. Finish
  // and publish are past the editing phase, so they don't claim it.
  useEffect(() => {
    const editing = step === 'edit' || step === 'effects'
    window.dispatchEvent(new CustomEvent('poplur-composer-editing', { detail: editing }))
    return () => {
      if (editing) window.dispatchEvent(new CustomEvent('poplur-composer-editing', { detail: false }))
    }
  }, [step])

  const basePreviewOwnsMedia = !editorOpen && !publishing && !posted && step === 'edit'

  // A captured video loops for as long as the base preview owns it — no play
  // button, no timed lease (product call, 16 Aug 2026). The performance
  // governor stays the guard: leave the foreground, lose the video-texture
  // allowance, or hand the clip to a child step and the decoder is released
  // (freezing to the captured still); when the conditions come back, the loop
  // resumes on its own. User transitions still call goToStep above, which
  // retires synchronously inside the gesture before a VFX/AI/channel child
  // can acquire the same clip.
  useEffect(() => {
    if (media.kind !== 'video') return
    const sync = () => {
      const snapshot = PoplurPerformanceManager.snapshot
      const allowed = basePreviewOwnsMedia
        && !document.hidden
        && snapshot.isForeground
        && snapshot.expensiveVideoBackedTexturesAllowed
      if (allowed) setPreviewPlaying(true)
      else retirePreview()
    }
    sync()
    const unsubscribe = PoplurPerformanceManager.subscribe(sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [basePreviewOwnsMedia, media.kind, media.src, retirePreview])

  useEffect(() => {
    const v = previewVideoRef.current
    if (!v || media.kind !== 'video' || !previewPlaying || !basePreviewOwnsMedia) return
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
    window.addEventListener('pagehide', retirePreview)
    return () => {
      cancelled = true
      v.removeEventListener('loadeddata', kick)
      v.removeEventListener('canplay', kick)
      window.removeEventListener('pagehide', retirePreview)
      releasePreviewVideo(v)
    }
  }, [basePreviewOwnsMedia, media.kind, media.src, previewPlaying, retirePreview])

  // Releases the capture-only decoder as soon as it has done its one job, or
  // on unmount if the still never lands (screen closed mid-decode).
  useEffect(() => {
    if (previewStill || media.kind !== 'video') return
    return () => {
      const v = captureVideoRef.current
      if (v) releasePreviewVideo(v)
    }
  }, [previewStill, media.kind])

  const backRef = useRef({ step, onClose })
  backRef.current = { step, onClose }
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      if (publishingRef.current) return
      const { step: current, onClose: close } = backRef.current
      if (current === 'channel' && target?.resume && !reviewMode) {
        parkDraftForLocation()
        return
      }
      const previous = previousComposerStep(current)
      retirePreview()
      if (previous === null) close()
      else {
        setStep(previous)
        onStepChange?.(previous)
      }
    })
    return () => bindBack(null)
  }, [bindBack, onStepChange, parkDraftForLocation, retirePreview, reviewMode, target?.resume])

  /** Bake the chosen filter into the pixels so the post carries what you saw.
   *  Photos are re-drawn through the CSS filter here; video keeps its filter id
   *  so the shell can apply it during export (the browser cannot re-encode a
   *  clip cheaply, and native already has PostCaptureMediaProcessor for it). */
  const bakeCapture = (source: ComposerMedia = media): Promise<string> => new Promise(resolve => {
    if (source.kind !== 'photo' || filterCss === 'none') return resolve(source.src)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(source.src)
      ctx.filter = filterCss
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => resolve(source.src)
    img.src = source.src
  })

  /** What actually gets uploaded: the capture, with its filter baked in.
   *  Until 5 Sep 2026 the live-simulation switch swapped this for a creative
   *  drawn from the demo pool, so a test run would "fill the board with product
   *  content" — and the poster's own profile then showed a stock ad where the
   *  photo they had just taken should have been, which the poster read as
   *  "the post is different from what I posted". What you post is what you
   *  posted, whatever switch is on; test content comes from the synthetic
   *  cohort, never from rewriting a real person's upload. */
  const renderForUpload = (source?: ComposerMedia): Promise<string> => bakeCapture(source)

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
      if (stepRef.current === 'channel') {
        setChannelId(current => {
          const i = channelChoices.findIndex(c => c.id === current)
          return channelChoices[((i + dir) % channelChoices.length + channelChoices.length) % channelChoices.length].id
        })
        return
      }
      if (stepRef.current !== 'edit') return
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
    if (publishingRef.current || posted) return
    if (draft?.newsMessage && !caption.trim()) {
      setPublishError({ message: 'Write a message before posting.', retryable: false })
      return
    }
    playPop()
    const privacyError = validatePublishPrivacy({
      audience: 'public',
      locationVisibility,
      rightsAttested,
    })
    if (privacyError) {
      setPublishError({ message: privacyError, retryable: false })
      return
    }
    setPublishError(null)
    publishingRef.current = true
    retirePreview()
    setPublishing(true)
    setUploadProgress(null)
    setUploadPhaseState('preparing')
    const destination = caption.trim() ? 'feed' as const : 'tv' as const
    const audience = 'public' as const
    // Re-check at the publish boundary. A stale draft or bridge message cannot
    // bypass a limit that changed while the composer was open.
    const publishedRadiusKm = clampClaimRadiusKm(radiusKm, claimRadiusMaxKm)
    const post: PublishedPost = {
      media,
      filterId,
      effectId,
      effectTiming,
      effectAsset: effectAsset ?? undefined,
      channelId,
      caption,
      photoViewSeconds: media.kind === 'photo' ? photoSeconds : null,
      usedAI,
      // A hidden-origin post remains visible in the feed/profile, but it must
      // not paint a public claim or hand its chosen map point to another UI.
      target: target && locationVisibility === 'approximate'
        ? { ...target, radiusKm: publishedRadiusKm }
        : undefined,
      destination,
      postId: postIdRef.current,
      audience,
      locationVisibility,
      pinColor,
    }
    try {
      // The app shell owns the account, Firebase Storage and the posts write
      // (UploadPostToCoordinate / UploadImageToCurrentCoordinate). Hand it the
      // finished post rather than re-implementing auth inside this bundle.
      if (isNativeShell()) {
        const slides = carouselSlides(media, items)
        // The cover is baked and transferred exactly as it always was, so the
        // legacy `data` field is unchanged for every post that has ever worked.
        const baked = await renderForUpload(slides[0])
        const data = await asTransferable(baked)
        // Extras only exist for a real carousel. One publishPost carries all of
        // them: never loop this call — two messages once produced two Storage
        // objects and two documents for 24 days.
        const mediaItems = slides.length < 2 ? undefined : await Promise.all(
          slides.map(async (slide, index) => ({
            index,
            kind: slide.kind,
            data: index === 0 ? data : await asTransferable(await renderForUpload(slide)),
          })),
        )
        const requestId = `${postIdRef.current}-try-${Date.now().toString(36)}`
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
          postId: postIdRef.current,
          schemaVersion: POST_SCHEMA_VERSION,
          kind: media.kind,
          photoViewSeconds: media.kind === 'photo' ? photoSeconds : null,
          data,
          // Absent, not empty, for a single-media post. mediaItems[0].data is
          // `data` above, character for character — that identity is what lets
          // an old shell ignore this array and still upload a valid post.
          mediaItems,
          mediaCount: mediaItems?.length,
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
          contentType: draft?.newsMessage ? 'message' : 'post',
          messageCard: draft?.newsMessage === true && draft?.messageCard === true,
          // Exact targets cross only this owner-authenticated native bridge and
          // are written to users/{uid}/postLocations. Public post fields below
          // are either a verifiable coarse cell or absent altogether.
          targetLatitude: target?.lat,
          targetLongitude: target?.lng,
          latitude: target && locationVisibility === 'approximate'
            ? publicCoordinate(target.lat)
            : undefined,
          longitude: target && locationVisibility === 'approximate'
            ? publicCoordinate(target.lng)
            : undefined,
          latitudeCell: target && locationVisibility === 'approximate'
            ? publicCoordinateCell(target.lat)
            : undefined,
          longitudeCell: target && locationVisibility === 'approximate'
            ? publicCoordinateCell(target.lng)
            : undefined,
          // Always send an explicit value. Omitting radius on a camera-first
          // post used to trigger positive native defaults, turning a valid
          // zero-entitlement account into a claimed area off screen.
          radiusKm: publishedRadiusKm,
          audience,
          locationVisibility,
          privateAccount: accountPrivacy.privateAccount,
          ghostMode: accountPrivacy.ghostMode,
          rightsAttested: true,
          rightsAttestationVersion: POST_RIGHTS_VERSION,
          destination,
          pinColor: pinColor ?? undefined,
        })
        await uploadResult
        if (caption.trim() && target && locationVisibility === 'approximate') {
          const attachment: NewsMediaAttachment = {
            kind: media.kind,
            src: media.src,
            poster: media.kind === 'video' ? (previewStill ?? undefined) : undefined,
          }
          dropNewsMessage({
            body: caption.trim(),
            lat: publicCoordinate(target.lat),
            lng: publicCoordinate(target.lng),
            radiusKm: publishedRadiusKm,
            media: draft?.messageCard ? undefined : [attachment],
          })
        }
        onPosted?.(post)
        setPosted(true)
        // A real upload just completed. Shape only — never the caption, the
        // coordinates, the media, the channel or the post id.
        track('pop_published', {
          kind: media.kind,
          destination,
          radius_km: publishedRadiusKm,
          used_ai: usedAI,
          has_caption: Boolean(caption.trim()),
        })
        closeTimerRef.current = window.setTimeout(onClose, 4200)
      } else {
        setUploadNote('Posting needs your Poplur account, so it uploads from the app — nothing was sent from this browser preview.')
        // This is a local confirmation only. `onPosted` drives the verified
        // cube, owned-post registration and map claims, so firing it without a
        // completed native upload made the preview look like a real post.
        setPosted(true)
        closeTimerRef.current = window.setTimeout(onClose, 5200)
      }
    } catch (error) {
      setPublishError({
        message: error instanceof Error
          ? error.message
          : 'That post could not be prepared for upload. Your capture is still in the camera roll.',
        retryable: !(error instanceof NativeUploadError) || error.retryable,
      })
    } finally {
      publishingRef.current = false
      setPublishing(false)
    }
  }

  const uploadPhaseLabel = uploadPhaseState === 'preparing'
    ? 'Preparing your pop'
    : uploadPhaseState === 'saving'
      ? 'Finishing your pop'
      : 'Uploading your pop'
  const composerStepLabel = step === 'edit'
    ? 'FILTER'
    : step === 'effects'
      ? 'VFX STUDIO'
      : step === 'finish'
        ? 'FINISH CREATION'
        : target
          ? 'READY TO POST'
          : 'CHANNEL'
  const filterPreviewSrc = media.kind === 'photo' ? media.src : previewStill
  const visibleAICandidate = aiCandidate ?? selectedAIMedia?.src ?? null
  const videoAIFrameReady = baselineMedia.kind !== 'video' || Boolean(previewStill)

  const preview = (
    <div className={styles.preview}>
      {media.kind === 'video' ? (
        <>
          {previewPlaying && basePreviewOwnsMedia ? (
            <video
              key={media.src}
              ref={previewVideoRef}
              className={styles.media}
              src={media.src}
              style={{ filter: filterCss === 'none' ? undefined : filterCss }}
              autoPlay muted playsInline loop preload="metadata"
              onLoadedData={event => {
                if (previewStill) return
                const still = stillFromVideo(event.currentTarget)
                if (still) setPreviewStill(still)
              }}
            />
          ) : previewStill ? (
            <img
              className={styles.media}
              src={previewStill}
              alt="Your video preview"
              style={{ filter: filterCss === 'none' ? undefined : filterCss }}
            />
          ) : (
            <video
              key={media.src}
              ref={captureVideoRef}
              src={media.src}
              muted
              playsInline
              preload="auto"
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              aria-hidden="true"
              onLoadedData={event => {
                const still = stillFromVideo(event.currentTarget)
                if (still) setPreviewStill(still)
              }}
            />
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

  if (publishing || posted) {
    const status = (
      <div className={styles.uploadStage} role="dialog" aria-modal="true" aria-label={posted ? 'Posted' : 'Uploading your pop'} aria-busy={publishing}>
        <UploadStatusView
          complete={posted}
          flow={target?.resume ? 'camera' : target ? 'map' : 'camera'}
          radius={radiusKm}
          phaseLabel={uploadPhaseLabel}
          progress={uploadProgress}
          note={uploadNote}
          onReset={posted ? onClose : undefined}
        />
      </div>
    )
    return reviewMode ? status : <ShellOverlayPortal>{status}</ShellOverlayPortal>
  }

  return (
    <div className={`${styles.stage}${reviewMode ? ` ${styles.reviewStage}` : ''}`} role="dialog" aria-modal="true" aria-label="Post composer" aria-busy={publishing}>
      {/* No header, no ‹, no ✕ — the cube is the back button here, like every
          subscreen. The capture IS the screen. */}
      {preview}

      {!editorOpen && !publishing && (step === 'edit' || step === 'effects') && (
        <div className={styles.composerChrome} aria-hidden="true">
          <img src="logo_icon.png" alt="" />
          <span>{composerStepLabel}</span>
        </div>
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
            setBaselineMedia({
              kind: 'video',
              src: edit.src,
              length: `0:${String(seconds).padStart(2, '0')}`,
            })
            setSelectedAIMedia(null)
            usedAIRef.current = false
            setUsedAI(false)
            setEditorOpen(false)
            if (edit.unbaked) {
              setUploadNote('This device could not render the edit, so the original clip was kept.')
            }
          }}
        />
      )}

      {!editorOpen && step === 'edit' && (
        <>
          {/* Trimming and scoring is a WORKBENCH, not another rail on top of
              the viewfinder — it needs the whole screen for a filmstrip you can
              actually hit with a thumb. Video only: there is nothing to trim on
              a still, and a button that opened an empty timeline would be a
              worse answer than no button. */}
          {media.kind === 'video' && (
            <button
              className={styles.editFab}
              onClick={() => { playPop(); retirePreview(); setEditorOpen(true) }}
              aria-label="Trim and add music"
            >✂ TRIM &amp; MUSIC</button>
          )}
          <button
            className={styles.nextFab}
            onClick={() => { playCubeNavigationPop(); goToStep('finish') }}
            aria-label="Return to choose your version"
            title="Next"
          ><span aria-hidden="true">›</span></button>
          <button
            type="button"
            className={styles.effectsFab}
            onClick={() => { playPop(); goToStep('effects') }}
          >VFX</button>
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
          poster={previewStill}
          value={effectId}
          timing={effectTiming}
          customAsset={effectAsset}
          onChange={effect => { playPop(); setEffectId(effect) }}
          onTimingChange={setEffectTiming}
          onCustomAssetChange={setEffectAsset}
          onContinue={() => { playCubeNavigationPop(); goToStep('finish') }}
        />
      )}

      {/* ── Choose a version. This is the default screen after capture; manual
             filters, trim and VFX are an optional detour rather than gates. ── */}
      {step === 'finish' && (
        <ComposerAIChat
          media={baselineMedia}
          poster={previewStill}
          mediaFilter={filterCss === 'none' ? undefined : filterCss}
          prompt={aiPrompt}
          status={aiStatus}
          error={aiError}
          candidate={visibleAICandidate}
          aiSourceReady={videoAIFrameReady}
          generating={aiGenerating}
          onPromptChange={setAiPrompt}
          onGenerate={() => {
            if (!videoAIFrameReady) {
              setAiStatus('Preparing a frame from your recording…')
              return
            }
            playPop()
            const controller = new AbortController()
            aiRequestRef.current?.abort()
            aiRequestRef.current = controller
            setAiCandidate(null)
            setAiError(null)
            setAiGenerating(true)
            setAiStatus(baselineMedia.kind === 'photo'
              ? 'Preparing your capture for AI editing…'
              : 'Preparing a frame from your recording for AI editing…')
            const sourceAsset = baselineMedia.kind === 'photo' ? baselineMedia.src : previewStill
            const source = sourceAsset
              ? prepareAIImageSource(sourceAsset)
              : Promise.resolve(undefined)
            void source.then(sourceImage => generateWithPoplurAI({
              prompt: aiPrompt || 'Create an original Poplur social post with an energetic editorial mood.',
              channelId,
              sourceImage,
              metadata: { surface: 'post_composer', requestedFrom: baselineMedia.kind },
              signal: controller.signal,
            })).then(result => {
              if (result.status !== 'completed' || (!result.inlineAsset && !result.outputUrl)) {
                setAiStatus(null)
                setAiError('Your AI preview is still processing. Keep the original or try again shortly.')
                return
              }
              setAiStatus('Preparing your AI preview for upload…')
              const transferable = result.inlineAsset
                ? Promise.resolve(aiImageSourceDataURL(result.inlineAsset))
                : materializeAIGeneratedImage(result.outputUrl as string)
              return transferable.then(candidate => {
                setAiCandidate(candidate)
                setAiStatus('Your AI version is ready. Compare and choose.')
              })
            }).catch(error => {
              if (controller.signal.aborted) return
              setAiStatus(null)
              setAiError(error instanceof Error ? error.message : 'Poplur AI could not generate that right now.')
            }).finally(() => {
              if (aiRequestRef.current !== controller) return
              aiRequestRef.current = null
              setAiGenerating(false)
            })
          }}
          onUseOriginal={() => {
            playPop()
            setAiCandidate(null)
            setAiError(null)
            setAiStatus(null)
            usedAIRef.current = false
            setUsedAI(false)
            setSelectedAIMedia(null)
            continueAfterFinish(baselineMedia, false)
          }}
          onUseCandidate={() => {
            if (!visibleAICandidate) return
            playPop()
            const selectedMedia: ComposerMedia = { kind: 'photo', src: visibleAICandidate }
            setSelectedAIMedia(selectedMedia)
            setAiCandidate(null)
            usedAIRef.current = true
            setUsedAI(true)
            setAiError(null)
            setAiStatus(null)
            continueAfterFinish(selectedMedia, true)
          }}
          onEditTools={() => {
            playCubeNavigationPop()
            goToStep('edit')
          }}
        />
      )}

      {/* ── 4. review and publish (+ radius at a coordinate) ───────────────── */}
      {step === 'channel' && (
        <div className={`${styles.panel} ${styles.channelPanel}`}>
          <header className={styles.publishHeader}>
            <img src="logo_icon.png" alt="" />
            <span><b>READY TO POST</b><strong>{draft?.newsMessage ? 'Review your Pop Message' : 'One last check'}</strong><small>{usedAI ? 'AI version selected' : 'Original version selected'}</small></span>
          </header>

          <section className={`${styles.fieldLabel} ${styles.viewTiming}`} aria-label="Media view time">
            <span>VIEW TIME</span>
            {media.kind === 'photo' ? <>
              <div className={styles.viewTimeOptions} role="group" aria-label="Photo view time">
                <button type="button" aria-pressed={photoSeconds === null}
                  onClick={() => setPhotoSeconds(null)}>Unlimited</button>
                <button type="button" aria-pressed={photoSeconds !== null}
                  onClick={() => setPhotoSeconds(seconds => seconds ?? 10)}>Timed view</button>
              </div>
              {photoSeconds !== null && <div className={styles.viewTimeDuration}>
                <span>Advance after <strong>{photoSeconds} seconds</strong></span>
                <input aria-label="Photo view seconds" type="range" min="1" max="60" step="1"
                  value={photoSeconds} onChange={event => setPhotoSeconds(photoViewSeconds(Number(event.target.value)))} />
                <div className={styles.viewTimeRangeLabels}><small>1 second</small><small>60 seconds</small></div>
              </div>}
            </> : <small>Counts down the video's playback time, then advances by radius.</small>}
          </section>

          <label className={styles.fieldLabel}>
            <span>{draft?.newsMessage ? 'MESSAGE' : <>CAPTION <small>OPTIONAL</small></>}</span>
            <textarea
              className={styles.caption}
              value={caption}
              rows={2}
              maxLength={500}
              placeholder="Say something about this pop…"
              onChange={e => setCaption(e.target.value)}
            />
          </label>

          <section className={styles.postSummary} aria-label="Post summary">
            <button
              type="button"
              className={styles.summaryRow}
              aria-expanded={channelPickerOpen}
              onClick={() => { playPop(.16); setChannelPickerOpen(open => !open) }}
            >
              <img src={channelUrl(`${CHANNELS.find(c => c.id === channelId)?.icon ?? CHANNELS[0]?.icon}.png`)} alt="" />
              <span><b>CHANNEL</b><strong>CH {CHANNELS.find(c => c.id === channelId)?.number} · {CHANNELS.find(c => c.id === channelId)?.name}</strong></span>
              <em>{channelPickerOpen ? 'Done' : 'Change'}</em>
            </button>
            {channelPickerOpen && (
              <div className={styles.channels} aria-label="Choose a channel">
                {channelChoices.map(c => (
                  <button
                    type="button"
                    key={c.id}
                    className={c.id === channelId ? `${styles.chan} ${styles.chanOn}` : styles.chan}
                    onClick={() => { playPop(); setChannelId(c.id); setChannelPickerOpen(false) }}
                    aria-pressed={c.id === channelId}
                  >
                    <img className={styles.chanIcon} src={channelUrl(`${c.icon}.png`)} alt="" />
                    <span><b>CH {c.number}</b><small>{c.name}</small></span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className={styles.summaryRow}
              onClick={() => { playPop(); requestLocation() }}
            >
              <img src="sprites/poplur_pin_lite_y0_p0_s256.png" alt="" />
              <span>
                <b>LOCATION</b>
                <strong>{target ? `Selected spot · ${formatClaimRadiusKm(radiusKm)} km` : 'Choose a map spot'}</strong>
                {target && claimRadiusMaxKm === CLAIM_RADIUS_SEED_KM
                  && <small>{formatClaimRadiusKm(CLAIM_RADIUS_SEED_KM)} km discovery seed; engagement earns more.</small>}
              </span>
              <em>{target ? 'Change' : 'Choose'}</em>
            </button>

            <div className={styles.summaryRow} aria-label="Pin colour">
              <span className={styles.summaryGlyph} aria-hidden="true">📍</span>
              <span>
                <b>PIN COLOUR</b>
                <span className={styles.pinSwatches} role="radiogroup" aria-label="Choose a pin colour">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pinColor === null}
                    aria-label="Pink (original)"
                    className={pinColor === null ? `${styles.pinSwatch} ${styles.pinSwatchOn}` : styles.pinSwatch}
                    style={{ background: '#FF4BA1' }}
                    onClick={() => { playPop(.16); setPinColor(null) }}
                  />
                  {PIN_COLOR_IDS.map(id => (
                    <button
                      type="button"
                      role="radio"
                      key={id}
                      aria-checked={pinColor === id}
                      aria-label={id}
                      className={pinColor === id ? `${styles.pinSwatch} ${styles.pinSwatchOn}` : styles.pinSwatch}
                      style={{ background: PIN_COLOR_SWATCH[id] }}
                      onClick={() => { playPop(.16); setPinColor(id) }}
                    />
                  ))}
                </span>
                <small>The clay pin your post stands up on the map.</small>
              </span>
            </div>

            <div className={styles.summaryRow} aria-label="Post visibility">
              <span className={styles.summaryGlyph} aria-hidden="true">◉</span>
              <span>
                <b>VISIBLE TO EVERYONE</b>
                <strong>{locationVisibility === 'hidden' ? 'Map origin hidden' : 'Approximate map area'}</strong>
                <small>{accountPrivacy.privateAccount || accountPrivacy.ghostMode
                  ? 'Your account setting hides where this post came from.'
                  : 'Your exact chosen point is never shown.'}</small>
              </span>
            </div>
          </section>

          <label className={styles.rightsRow}>
            <input
              type="checkbox"
              checked={rightsAttested}
              onChange={event => {
                setRightsAttested(event.target.checked)
                if (event.target.checked) setPublishError(null)
              }}
            />
            <span><b>I can share this</b><small>I have permission for this media and any music.</small></span>
          </label>

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
            // A pop is a picture or a message. Neither is not a pop, so the
            // button will not publish one — the same rule the map applies to
            // rows that arrive without either.
            disabled={publishing || !rightsAttested || !target || (draft?.newsMessage && !caption.trim()) || (!media && !caption.trim())}
          >
            {publishing
              ? 'Uploading…'
              : publishError?.retryable
                ? 'Retry upload'
                : !media && !caption.trim() ? 'Add a photo or write a message' : target ? draft?.newsMessage ? locationVisibility === 'approximate' ? 'Post message to map' : 'Post message' : `Post to ${caption.trim() ? 'News Feed' : 'TV'}` : 'Choose a spot to post'}
          </button>
          {publishError && !publishing && (
            <div className={styles.publishError} role="alert">
              <b>{publishError.retryable ? 'Upload not finished' : 'Before you post'}</b>
              <span>{publishError.message}</span>
              {publishError.retryable && <small>Your edit and the same post ID are kept for a safe retry.</small>}
            </div>
          )}
          {!target && !publishing && (
            <p className={styles.needSpot}>Choose a location before posting.</p>
          )}
          {!rightsAttested && !publishing && target && (
            <p className={styles.needSpot}>Confirm media rights before posting.</p>
          )}
        </div>
      )}
    </div>
  )
}
