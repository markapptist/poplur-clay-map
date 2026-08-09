import React, { useEffect, useRef, useState } from 'react'
import styles from './PostComposer.module.css'
import { AR_FILTERS } from './ARFilters'
import { CHANNELS } from './FeedTwin'
import { playPop } from './pop'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { setPendingAICompose, setPendingMapPost, type PendingMapPost } from './cameraStore'
import VideoEditor from './VideoEditor'

// Web twin of PostCaptureComposerOverlay.swift — the one composer every capture
// route ends in, with the same step machine the app ships:
//
//   edit (filter + trim) → choice (post original | add Poplur AI) → [ai] → channel
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
  channelId: string
  caption: string
  usedAI: boolean
  target?: ComposerTarget
}

type Step = 'edit' | 'choice' | 'ai' | 'channel'

type NativeUploadResult = {
  requestId?: string
  ok?: boolean
  error?: string
}

const NATIVE_UPLOAD_TIMEOUT_MS = 90_000

/**
 * A native shell owns Firebase auth, Storage and the Firestore write. The web
 * composer must wait for that side to report the result; otherwise it can show
 * a green "Posted" state while the device has not uploaded anything yet.
 */
function awaitNativeUpload(requestId: string): Promise<void> {
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

    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('poplur-upload-result', onResult)
    }

    window.addEventListener('poplur-upload-result', onResult)
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
}) {
  const [step, setStep] = useState<Step>(draft ? 'channel' : 'edit')
  const [filterId, setFilterId] = useState(draft?.filterId ?? 'none')
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
  // Set when the post could NOT actually be uploaded (browser preview has no
  // account) — the confirmation must never imply an upload that did not happen.
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const filterCss = AR_FILTERS.find(f => f.id === filterId)?.css ?? 'none'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (step === 'edit') onClose()
      else setStep(step === 'channel' ? 'choice' : 'edit')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The cube's back: one screen at a time, closing from the first. Matches
  // the Escape key exactly.
  // The preview had `autoPlay loop muted playsInline` and still came up frozen
  // on a black frame. Those attributes only make autoplay ALLOWED, not
  // guaranteed: WKWebView routinely declines the automatic start for a source
  // that is still arriving (a fresh MediaRecorder blob is exactly that), and a
  // declined autoplay is silent — no error, no event, just a video that never
  // moves. Asking explicitly once the data is there is what actually starts it.
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const v = previewVideoRef.current
    if (!v || media.kind !== 'video') return
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
    return () => {
      cancelled = true
      v.removeEventListener('loadeddata', kick)
      v.removeEventListener('canplay', kick)
    }
  }, [media.kind, media.src])

  const backRef = useRef({ step, onClose })
  backRef.current = { step, onClose }
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      const { step: current, onClose: close } = backRef.current
      if (current === 'edit') close()
      else setStep(current === 'channel' ? 'choice' : 'edit')
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

  const publish = async () => {
    playPop()
    setPublishing(true)
    const post: PublishedPost = { media, filterId, channelId, caption, usedAI, target: target && { ...target, radiusKm } }
    try {
      // The app shell owns the account, Firebase Storage and the posts write
      // (UploadPostToCoordinate / UploadImageToCurrentCoordinate). Hand it the
      // finished post rather than re-implementing auth inside this bundle.
      if (isNativeShell()) {
        const baked = await renderForUpload()
        const data = await asTransferable(baked)
        const requestId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        postNativeEvent({
          type: 'publishPost',
          requestId,
          kind: media.kind,
          data,
          caption,
          channelId,
          filterId,
          usedAI,
          latitude: target?.lat,
          longitude: target?.lng,
          radiusKm: target ? radiusKm : undefined,
        })
        await awaitNativeUpload(requestId)
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

  const preview = (
    <div className={styles.preview}>
      {media.kind === 'video' ? (
        <video
          ref={previewVideoRef}
          className={styles.media}
          src={media.src}
          style={{ filter: filterCss === 'none' ? undefined : filterCss }}
          autoPlay loop muted playsInline preload="auto"
        />
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
          <span className={styles.doneTick}>{uploadNote ? '↑' : '✓'}</span>
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
    <div className={styles.stage} role="dialog" aria-label="Post composer">
      {/* No header, no ‹, no ✕ — the cube is the back button here, like every
          subscreen. The capture IS the screen. */}
      {preview}

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
            onClick={() => { playPop(); setStep('choice') }}
            aria-label="Continue to post"
          >NEXT ›</button>
          <span
            key={filterId}
            className={`${styles.filterName} ${styles.filterNameShader}`}
            aria-live="polite"
          >
            {AR_FILTERS.find(f => f.id === filterId)?.label ?? 'ORIGINAL'}
          </span>
        </>
      )}

      {/* ── 2. choice: post original, or hand it to Poplur AI ──────────────── */}
      {step === 'choice' && (
        <div className={`${styles.panel} ${styles.panelCentered}`}>
          <h3 className={styles.choiceHead}>Post original or add Poplur AI?</h3>
          <button
            className={styles.primary}
            onClick={() => { playPop(); setUsedAI(false); setStep('channel') }}
          >Post Original</button>
          <button
            className={styles.secondary}
            onClick={() => { playPop(); setStep('ai') }}
          >✨ Add Poplur AI</button>
        </div>
      )}

      {/* ── 3. ai: the real generation runs server-side behind an account ──── */}
      {step === 'ai' && (
        <div className={styles.panel}>
          <span className={styles.panelLabel}>TELL POPLUR AI WHAT TO MAKE</span>
          <textarea
            className={styles.prompt}
            value={aiPrompt}
            maxLength={500}
            placeholder="e.g. turn this into a neon poster for the shop"
            onChange={e => setAiPrompt(e.target.value)}
          />
          {isNativeShell() ? (
            <button
              className={styles.primary}
              onClick={() => {
                playPop()
                // The real generator is PoplurAIChatView → poplurAiApi (Google AI
                // Studio) behind the signed-in account; hand it the prompt.
                //
                // And hand it the CAPTURE. This used to navigate and nothing
                // more, so the chat opened empty and the shot you were asking
                // it to work on stayed behind in a composer that had just
                // closed — you arrived at "what shall I make?" with nothing to
                // make it from. The media is stashed module-side (it outlives
                // this unmount) and the chat picks it up on open.
                setPendingAICompose({ media, prompt: aiPrompt, caption, channelId, filterId })
                // Same-document listeners hear this; the native shell gets the
                // navigate below. Both paths land on the same chat.
                window.dispatchEvent(new CustomEvent('poplur-ai-compose'))
                postNativeEvent({ type: 'holdMenuNavigate', action: 'create' })
                onClose()
              }}
            >Generate in Poplur AI</button>
          ) : (
            <p className={styles.aiNote}>
              Poplur AI generation runs on your account (Google AI Studio through the
              Poplur backend), so it happens in the app — this browser twin can’t sign
              in. You can still post the original.
            </p>
          )}
          <button className={styles.secondary} onClick={() => { playPop(); setUsedAI(false); setStep('channel') }}>
            Post original instead
          </button>
        </div>
      )}

      {/* ── 4. channel (+ radius when posting to a coordinate) ─────────────── */}
      {step === 'channel' && (
        <div className={styles.panel}>
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
                <span className={styles.chanEmoji}>{c.emoji}</span>
                <span className={styles.chanNum}>CH {c.number}</span>
                <span className={styles.chanName}>{c.name}</span>
              </button>
            ))}
          </div>
          {!target && (
            /* Camera→map: the May '26 CaptureFlow direction the web home lost.
               The draft (media + choices) is stashed module-side, the map tab
               opens, and the spot the user taps comes back as a normal
               poplur-post-here target — the composer then resumes right here
               with everything kept. */
            <button
              className={styles.secondary}
              onClick={() => {
                playPop()
                setPendingMapPost({ media, caption, channelId, filterId, usedAI })
                // CustomEvent, NOT postMessage: HomeTwin's message handler
                // opens with `event.source !== mapIframe → return`, so a
                // same-document postMessage is silently dropped. Same-document
                // signals here travel as CustomEvents (see poplur-engagement).
                window.dispatchEvent(new CustomEvent('poplur-pick-spot'))
                onClose()
              }}
            >
              📍 Pick a spot on the map
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
              Every pop holds ground. Choose where this one lands before posting it.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
