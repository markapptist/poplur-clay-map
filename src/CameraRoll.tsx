import React from 'react'
import styles from './ViewHarness.module.css'

// Camera Roll — the camera's upper page (channel-up pushes the whole camera
// up here; channel-down returns to the live viewfinder). A clay-dark grid of
// the user's recent captures, built ONLY from bundled, user-supplied assets:
// clay stills stand in for photos, the channel ad creatives for videos (their
// first frame + a duration badge, like iOS Photos).

interface RollItem {
  kind: 'photo' | 'video'
  src: string
  /** mm:ss badge for videos */
  length?: string
}

const ROLL: RollItem[] = [
  { kind: 'video', src: 'feed/ad-food.mp4', length: '0:31' },
  { kind: 'photo', src: 'clay_buildings.png' },
  { kind: 'photo', src: 'clay_cube.png' },
  { kind: 'video', src: 'feed/ad-music.mp4', length: '0:24' },
  { kind: 'photo', src: 'clay_tv.png' },
  { kind: 'photo', src: 'clay_pin.png' },
  { kind: 'video', src: 'feed/ad-sports.mp4', length: '0:18' },
  { kind: 'photo', src: 'clay_stars.png' },
  { kind: 'photo', src: 'cam_object.png' },
  { kind: 'video', src: 'feed/ad-kids.mp4', length: '0:27' },
  { kind: 'photo', src: 'mark_talk2.png' },
  { kind: 'video', src: 'feed/ad-comedy.mp4', length: '0:21' },
  { kind: 'video', src: 'feed/ad-french.mp4', length: '0:19' },
  { kind: 'photo', src: 'clay_pin_small.png' },
  { kind: 'video', src: 'feed/ad-spanish-1.mp4', length: '0:22' },
  { kind: 'photo', src: 'clay_stars.png' },
  { kind: 'video', src: 'feed/ad-shopping.mp4', length: '0:14' },
  { kind: 'photo', src: 'clay_cube.png' },
  { kind: 'video', src: 'feed/ad-spanish-2.mp4', length: '0:16' },
  { kind: 'photo', src: 'clay_tv.png' },
  { kind: 'video', src: 'feed/ad-cartoon.mp4', length: '0:29' },
  { kind: 'photo', src: 'clay_buildings.png' },
  { kind: 'video', src: 'feed/ad-spanish-3.mp4', length: '0:25' },
  { kind: 'photo', src: 'clay_pin.png' },
]

export default function CameraRoll() {
  return (
    <section className={styles.cameraRoll} aria-label="Camera roll">
      <header className={styles.rollHeader}>
        <img className={styles.rollLogo} src="logo_icon.png" alt="" draggable={false} />
        <h1 className={styles.rollTitle}>Camera Roll</h1>
        <span className={styles.rollCount}>{ROLL.length} captures</span>
      </header>

      <div className={styles.rollGrid}>
        {ROLL.map((item, index) => (
          <figure key={index} className={styles.rollTile}>
            {item.kind === 'photo' ? (
              <img className={styles.rollMedia} src={item.src} alt="" loading="lazy" draggable={false} />
            ) : (
              <>
                {/* #t=0.1 forces the browser to decode and paint a real first
                    frame under preload=metadata (plain metadata stays blank) */}
                <video className={styles.rollMedia} src={`${item.src}#t=0.1`} preload="metadata" muted playsInline />
                <span className={styles.rollBadge}>▶ {item.length}</span>
              </>
            )}
          </figure>
        ))}
      </div>

      <p className={styles.rollHint}>▲ ▼ flips back to the camera</p>
    </section>
  )
}
