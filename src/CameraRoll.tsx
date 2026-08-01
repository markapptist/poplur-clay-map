import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import styles from './ViewHarness.module.css'
import { playPop } from './pop'
import { listCaptures, onCameraStore, isSelected, toggleSelected, selectedCount } from './cameraStore'
import PermissionAlert from './PermissionAlert'

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
  /** set on this session's own captures, which are selectable */
  id?: string
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

export default function CameraRoll({ onDeny, lite = false, onPick }: {
  onDeny?: () => void
  lite?: boolean
  /** picking a capture sends it into the post composer, like the native roll */
  onPick?: (media: { kind: 'photo' | 'video'; src: string; length?: string }) => void
} = {}) {
  // Native shell: the REAL device photo library replaces the mock grid. The
  // app answers requestCameraRoll with recent photo thumbnails (data URIs) via
  // window.poplurCameraRoll; a denied OS permission flips back to the camera.
  const [nativeRoll, setNativeRoll] = useState<RollItem[] | null>(null)
  useEffect(() => {
    if (!isNativeShell()) return
    const w = window as unknown as { poplurCameraRoll?: (payload: unknown) => void }
    w.poplurCameraRoll = payload => {
      if (Array.isArray(payload)) {
        setNativeRoll(payload.filter((it): it is RollItem =>
          !!it && typeof (it as RollItem).src === 'string'))
      } else if (payload && typeof payload === 'object' && (payload as { denied?: boolean }).denied) {
        onDeny?.()
      }
    }
    return () => { delete w.poplurCameraRoll }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // First-open permission alert, in the Poplur clay alert style (twin of the
  // pre-login camera/location permission cards). Only a GRANT persists;
  // denying flips back to the live camera and the alert returns next time.
  // ?permission=1 forces the alert visible (the GCL board card uses it).
  const forceAlert = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('permission') === '1'
  const [granted, setGranted] = useState(() => {
    if (forceAlert) return false
    try { return window.localStorage.getItem('poplur.rollPermission') === 'granted' } catch { return false }
  })
  const allow = () => {
    try { window.localStorage.setItem('poplur.rollPermission', 'granted') } catch { /* embedded */ }
    setGranted(true)
    if (isNativeShell()) postNativeEvent({ type: 'requestCameraRoll' })
  }
  const deny = () => { onDeny?.() }
  // Re-request on every open once granted, so the roll stays fresh.
  useEffect(() => {
    if (granted && isNativeShell()) postNativeEvent({ type: 'requestCameraRoll' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted])

  // What the camera shot this session sits at the FRONT of the roll, newest
  // first — and only those tiles are selectable, because only they belong to
  // this device's session.
  const captures = useSyncExternalStore(onCameraStore, listCaptures, listCaptures)
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)
  const shot: RollItem[] = captures.map(c => ({ kind: c.kind, src: c.src, length: c.length, id: c.id }))
  const items = [...shot, ...(nativeRoll ?? ROLL)]

  return (
    <section className={styles.cameraRoll} aria-label="Camera roll">
      <header className={styles.rollHeader}>
        <img className={styles.rollLogo} src="logo_icon.png" alt="" draggable={false} />
        <h1 className={styles.rollTitle}>Camera Roll</h1>
        <span className={styles.rollCount}>
          {picked ? `${picked} selected` : `${items.length} captures`}
        </span>
      </header>

      <div className={styles.rollGrid}>
        {items.map((item, index) => (
          <figure
            key={item.id ?? index}
            className={item.id && isSelected(item.id) ? `${styles.rollTile} ${styles.rollTileOn}` : styles.rollTile}
            // Picking a capture opens the composer (filter → original/AI → post).
            // Every tile is pickable, not just ones the store gave an id: the
            // seeded roll has no ids, and a roll where most tiles do nothing when
            // tapped is the bug, not the design. Selection stays the no-composer
            // fallback, and it still needs an id.
            onClick={onPick
              ? () => { playPop(); onPick({ kind: item.kind, src: item.src, length: item.length }) }
              : item.id
                ? () => { playPop(); toggleSelected(item.id!) }
                : undefined}
          >
            {item.kind === 'photo' ? (
              <img className={styles.rollMedia} src={item.src} alt="" loading="lazy" draggable={false} />
            ) : lite ? (
              // Lite clone (the pager's wrap panel, visible only mid-slide):
              // no <video> decoders, just the badge on a dark tile.
              <span className={styles.rollBadge}>▶ {item.length}</span>
            ) : (
              <>
                {/* #t=0.1 forces the browser to decode and paint a real first
                    frame under preload=metadata (plain metadata stays blank) */}
                <video className={styles.rollMedia} src={`${item.src}#t=0.1`} preload="metadata" muted playsInline />
                <span className={styles.rollBadge}>▶ {item.length}</span>
              </>
            )}
            {item.id && isSelected(item.id) && <span className={styles.rollTick} aria-hidden="true">✓</span>}
          </figure>
        ))}
      </div>

      {!granted && !lite && (
        <PermissionAlert
          icon="photos"
          label="Camera roll permission"
          title={'Allow "Poplur" to access your camera roll?'}
          copy="Show your captures here so you can post photos and videos from inside your radius."
          choices={[
            { label: "Don't Allow", onPick: deny },
            { label: 'Allow', grants: true, onPick: allow },
          ]}
        />
      )}
    </section>
  )
}
