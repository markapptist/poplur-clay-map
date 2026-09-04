import { useEffect, useRef } from 'react'
import styles from './CaptureReview.module.css'
import type { ComposerMedia } from './PostComposer'

/**
 * The beat between capturing and composing: a full-screen preview of exactly
 * what the shutter or the recorder just produced, with one decision — keep it
 * and move on to "Create your pop", or retake and go straight back to the
 * live camera. It sits ABOVE the camera HUD and the home chrome, so the raw
 * shot is the only thing on screen while you decide.
 *
 * Roll picks skip this (choosing a saved photo is already a decision); only a
 * fresh capture is reviewed.
 */
export default function CaptureReview({
  media,
  onAccept,
  onRetake,
}: {
  media: ComposerMedia
  onAccept: () => void
  onRetake: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Loop the recording quietly so the preview shows motion, not a frozen
  // first frame — muted, because sound belongs to the posted pop, not the
  // review.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = true
    void el.play().catch(() => {})
  }, [media.src])

  return (
    <section className={styles.review} role="dialog" aria-modal="true" aria-label="Review your capture">
      <div className={styles.stage}>
        {media.kind === 'video' ? (
          <video
            ref={videoRef}
            className={styles.media}
            src={media.src}
            playsInline
            loop
            muted
            autoPlay
          />
        ) : (
          <img className={styles.media} src={media.src} alt="Your capture" draggable={false} />
        )}
        <span className={styles.eyebrow}>
          {media.kind === 'video' ? 'Your recording' : 'Your photo'}
          {media.length ? ` · ${media.length}` : ''}
        </span>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.retake} onClick={onRetake}>
          Retake
        </button>
        <button type="button" className={styles.accept} onClick={onAccept} autoFocus>
          Use this <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}
