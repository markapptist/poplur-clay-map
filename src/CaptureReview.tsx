import { useEffect, useRef } from 'react'
import composer from './PostComposer.module.css'
import SideControlIconButton from './SideControlIcon'
import TabControlRail from './TabControlRail'
import { useControlSide } from './controlPlacement'
import { playPop } from './pop'
import styles from './CaptureReview.module.css'
import type { ComposerMedia } from './PostComposer'

/**
 * The beat between capturing and composing: the shot the shutter or the
 * recorder just produced, with one decision — keep it and move on to the
 * composer, or retake and go straight back to the live camera.
 *
 * It is the FIRST screen of the upload pipeline, so it is built from the
 * composer's own parts — the same fixed full-bleed stage, the same
 * edge-to-edge preview. The controls float over the shot and use the same
 * bubbly buttons as the map dialogs. Accepting hands
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
  onKeep,
}: {
  media: ComposerMedia
  onAccept: () => void
  onRetake: () => void
  /** Keep the shot in the roll and go back to the lens — the exit for someone
   *  who is collecting shots now and will choose one to post later. Absent on
   *  routes where the capture is not the roll's to keep. */
  onKeep?: () => void
}) {
  const controlSide = useControlSide()
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
      <div className={styles.caption} aria-hidden="true">
        <span>{isVideo ? 'REVIEW VIDEO' : 'REVIEW PHOTO'}</span>
      </div>

      {/* The three exits, on the rail rather than as words across the middle
          of the shot you are trying to judge. Every other screen in Poplur puts
          its actions on a rail under the thumb; this one sat them over the
          photograph.

          They are three genuinely different answers, which is why the middle
          one is worth having: RETAKE throws this shot away and goes back to the
          lens, SAVE keeps it in the roll and goes back to the lens (shoot a
          series now, choose later), USE takes it on to the composer to post. */}
      <TabControlRail side={controlSide} label="Review controls">
        <SideControlIconButton
          icon="camera.kodak"
          aria-label={isVideo ? 'Discard and record again' : 'Discard and take another'}
          onActivate={() => { playPop(); onRetake() }}
        />
        {onKeep && (
          <SideControlIconButton
            icon="camera.camera_roll"
            aria-label={isVideo ? 'Keep this recording in the roll' : 'Keep this photo in the roll'}
            onActivate={() => { playPop(); onKeep() }}
          />
        )}
        <SideControlIconButton
          icon="profile.select"
          aria-label={isVideo ? 'Use this recording' : 'Use this photo'}
          onActivate={() => { playPop(); onAccept() }}
        />
      </TabControlRail>

      <div className={styles.panel}>
        <p className={styles.copy}>
          {isVideo
            ? <>Your recording{media.length ? <> · <strong>{media.length}</strong></> : null}. Keep it, save it, or record another.</>
            : <>Your photo. Keep it, save it, or take another.</>}
        </p>
      </div>
    </div>
  )
}
