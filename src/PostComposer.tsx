import React, { useEffect, useRef, useState } from 'react'
import styles from './PostComposer.module.css'
import { AR_FILTERS } from './ARFilters'
import { CHANNELS } from './FeedTwin'
import { playPop } from './pop'
import { isNativeShell, postNativeEvent } from './nativeBridge'

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
  media,
  target,
  onClose,
  onPosted,
  bindArrows,
}: {
  media: ComposerMedia
  /** set when the post is bound to a map coordinate */
  target?: ComposerTarget
  onClose: () => void
  onPosted?: (post: PublishedPost) => void
  /** Hands the clay channel arrows a job while the composer is open: stepping
   *  the filter over the capture (and the channel on the channel step). */
  bindArrows?: (fn: ((dir: 1 | -1) => void) | null) => void
}) {
  const [step, setStep] = useState<Step>('edit')
  const [filterId, setFilterId] = useState('none')
  const [caption, setCaption] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [usedAI, setUsedAI] = useState(false)
  const [channelId, setChannelId] = useState(CHANNELS[0]?.id ?? 'food')
  const [radiusKm, setRadiusKm] = useState(target?.radiusKm ?? 3)
  const [posted, setPosted] = useState(false)
  const [publishing, setPublishing] = useState(false)
  // Set when the post could NOT actually be uploaded (browser preview has no
  // account) — the confirmation must never imply an upload that did not happen.
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const filterCss = AR_FILTERS.find(f => f.id === filterId)?.css ?? 'none'
  const railRef = useRef<HTMLDivElement>(null)

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
          className={styles.media}
          src={media.src}
          style={{ filter: filterCss === 'none' ? undefined : filterCss }}
          autoPlay loop muted playsInline
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
      <header className={styles.bar}>
        <button
          className={styles.barBtn}
          onClick={() => { playPop(); step === 'edit' ? onClose() : setStep(step === 'channel' ? 'choice' : 'edit') }}
          aria-label="Back"
        >‹</button>
        <span className={styles.barTitle}>
          {step === 'edit' ? 'Edit capture' : step === 'choice' ? 'Finish post' : step === 'ai' ? 'Poplur AI' : 'Choose channel'}
        </span>
        <button className={styles.barBtn} onClick={() => { playPop(); onClose() }} aria-label="Close composer">✕</button>
      </header>

      {preview}

      {/* ── 1. edit: the filter rail, the same AR set the camera uses ──────── */}
      {step === 'edit' && (
        <div className={styles.panel}>
          <span className={styles.panelLabel}>FILTER</span>
          <div className={styles.filterRail} ref={railRef}>
            {AR_FILTERS.map(f => (
              <button
                key={f.id}
                className={f.id === filterId ? `${styles.swatchBtn} ${styles.swatchOn}` : styles.swatchBtn}
                onClick={() => { playPop(); setFilterId(f.id) }}
                aria-pressed={f.id === filterId}
              >
                <span
                  className={styles.swatch}
                  style={{
                    backgroundImage: `url(${media.kind === 'photo' ? media.src : 'clay_cube.png'})`,
                    filter: f.css === 'none' ? undefined : f.css,
                  }}
                />
                <span className={styles.swatchLabel}>{f.label}</span>
              </button>
            ))}
          </div>
          <button className={styles.primary} onClick={() => { playPop(); setStep('choice') }}>Continue</button>
        </div>
      )}

      {/* ── 2. choice: post original, or hand it to Poplur AI ──────────────── */}
      {step === 'choice' && (
        <div className={styles.panel}>
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
          <button className={styles.primary} onClick={() => { void publish() }} disabled={publishing}>
            {publishing ? 'Uploading…' : target ? 'Post to this spot' : 'Post to Channel'}
          </button>
        </div>
      )}
    </div>
  )
}
