import { useEffect, useRef } from 'react'
import composer from './PostComposer.module.css'
import styles from './CaptureReview.module.css'
import type { ComposerMedia } from './PostComposer'

/**
 * The beat between capturing and composing: the shot the shutter or the
 * recorder just produced, with one decision — keep it and move on to the
 * composer, or retake and go straight back to the live camera.
 *
 * It is the FIRST screen of the upload pipeline, so it is built from the
 * composer's own parts — the same fixed full-bleed stage, the same
 * edge-to-edge preview, the same step chip top-left and the same clay panel
 * and buttons at the base — rather than a look of its own. Accepting hands
 * the exact same media to the composer, and because the geometry is shared
 * the capture does not jump when the next step arrives over it.
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

  // Tell the shell a full-screen capture modal is up, so the home chrome
  // stands down the way it does for the composer. Nothing inside
  // .contentLayer can stack above that chrome on its own; asking is the only
  // route that works from in here.
  useEffect(() => {
    const announce = (open: boolean) => {
      window.dispatchEvent(new CustomEvent('poplur-capture-review', { detail: open }))
    }
    announce(true)
    return () => { announce(false) }
  }, [])

  const isVideo = media.kind === 'video'

  return (
    // The composer's stage: position fixed, one modest z-index above the
    // camera HUD. The first version of this screen was an absolute child of
    // the paged camera track with a z-index near the 32-bit limit, and on the
    // phone the rails, the AR dial and the zoom presets drew straight over the
    // photo — the same trap the composer already escaped by standing here.
    <div className={composer.stage} role="dialog" aria-modal="true" aria-label="Review your capture">
      <div className={composer.preview}>
        {isVideo ? (
          <video
            ref={videoRef}
            className={composer.media}
            src={media.src}
            playsInline
            loop
            muted
            autoPlay
          />
        ) : (
          <img className={composer.media} src={media.src} alt="Your capture" draggable={false} />
        )}
      </div>

      {/* Same chip the edit and VFX steps wear, so the review reads as step
          one of the pipeline it opens, not a screen of its own. */}
      <div className={composer.composerChrome} aria-hidden="true">
        <img src="logo_icon.png" alt="" />
        <span>{isVideo ? 'REVIEW VIDEO' : 'REVIEW PHOTO'}</span>
      </div>

      <div className={composer.panel}>
        <p className={styles.copy}>
          {isVideo
            ? <>Your recording{media.length ? <> · <strong>{media.length}</strong></> : null}. Keep it, or record another.</>
            : <>Your photo. Keep it, or take another.</>}
        </p>
        <div className={styles.actions}>
          <button type="button" className={composer.secondary} onClick={onRetake}>
            Retake
          </button>
          <button type="button" className={composer.primary} onClick={onAccept} autoFocus>
            Use this <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}
