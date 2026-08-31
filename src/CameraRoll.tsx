import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import styles from './ViewHarness.module.css'
import { playPop } from './pop'
import { feedUrl } from './assetPacks'
import { listCaptures, onCameraStore, isSelected, toggleSelected, selectedCount, setLibraryNewest } from './cameraStore'
import PermissionAlert from './PermissionAlert'
import { cameraRollDisplayItems } from './cameraRollPolicy'

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
  /** bundled first frame for a clip — a thumbnail never needs a decoder */
  poster?: string
  /** set on this session's own captures, which are selectable */
  id?: string
  /** Native Photos identifier. The grid receives only a thumbnail; selection
   *  resolves this asset separately so the composer never stretches the tile. */
  assetId?: string
  /** Native shells that can register an original-resolution local route may
   *  return it with the thumbnail. It is never assigned to the grid image. */
  fullSrc?: string
}

interface NativeRollAssetResult {
  requestId?: string
  assetId?: string
  kind?: 'photo' | 'video'
  src?: string
  fullSrc?: string
  pixelWidth?: number
  pixelHeight?: number
  error?: string
}

interface NativeRollSelection {
  kind?: 'photo' | 'video'
  src?: string
  length?: string
}

const MAX_ROLL_ASSET_EDGE = 3840
const ROLL_ASSET_TIMEOUT_MS = 30_000

// A grid tile is a STILL. Every seeded clip already ships a first-frame jpg
// (the feed uses the same files as its video posters), so the roll draws those
// instead of mounting eleven <video> elements that each decoded a 1280x720
// frame and then sat holding it — eleven live decoders for eleven thumbnails.
const posterFor = (src: string): string | undefined => {
  const clip = /feed\/([\w.-]+)\.mp4$/.exec(src)
  return clip ? feedUrl(`posters/${clip[1]}.jpg`) : undefined
}

const ROLL: RollItem[] = [
  { kind: 'video', src: feedUrl('ad-food.mp4'), length: '0:31' },
  { kind: 'photo', src: 'clay_buildings.png' },
  { kind: 'photo', src: 'clay_cube.png' },
  { kind: 'video', src: feedUrl('ad-music.mp4'), length: '0:24' },
  { kind: 'photo', src: 'clay_tv.png' },
  { kind: 'photo', src: 'clay_pin.png' },
  { kind: 'video', src: feedUrl('ad-sports.mp4'), length: '0:18' },
  { kind: 'photo', src: 'clay_stars.png' },
  { kind: 'photo', src: 'cam_object.png' },
  { kind: 'video', src: feedUrl('ad-kids.mp4'), length: '0:27' },
  { kind: 'photo', src: 'mark_talk2.png' },
  { kind: 'video', src: feedUrl('ad-comedy.mp4'), length: '0:21' },
  { kind: 'video', src: feedUrl('ad-french.mp4'), length: '0:19' },
  { kind: 'photo', src: 'clay_pin_small.png' },
  { kind: 'video', src: feedUrl('ad-spanish-1.mp4'), length: '0:22' },
  { kind: 'photo', src: 'clay_stars.png' },
  { kind: 'video', src: feedUrl('ad-shopping.mp4'), length: '0:14' },
  { kind: 'photo', src: 'clay_cube.png' },
  { kind: 'video', src: feedUrl('ad-spanish-2.mp4'), length: '0:16' },
  { kind: 'photo', src: 'clay_tv.png' },
  { kind: 'video', src: feedUrl('ad-cartoon.mp4'), length: '0:29' },
  { kind: 'photo', src: 'clay_buildings.png' },
  { kind: 'video', src: feedUrl('ad-spanish-3.mp4'), length: '0:25' },
  { kind: 'photo', src: 'clay_pin.png' },
]

export default function CameraRoll({
  onDeny,
  lite = false,
  active = true,
  onPick,
  photoOnly = false,
  videoOnly = false,
  hideHeader = false,
  nativeRequestType = 'requestCameraRoll',
}: {
  onDeny?: () => void
  lite?: boolean
  /**
   * Is this roll the page the user is actually looking at? The camera pager
   * keeps the roll's slot, header, tile count and scroll position mounted at
   * all times so the layout and the slide never move — but off the visible
   * page it holds no media at all: no image loads, no decoders, and no
   * permission alert running behind a screen nobody can see.
   */
  active?: boolean
  /** picking a capture sends it into the post composer, like the native roll */
  onPick?: (media: { kind: 'photo' | 'video'; src: string; length?: string }) => void
  /** Profile pictures only accept stills; the normal posting roll keeps videos. */
  photoOnly?: boolean
  /** Profile selfie clips only accept videos; photo pickers keep their existing flow. */
  videoOnly?: boolean
  /** Profile capture supplies its own chrome above the shared grid. */
  hideHeader?: boolean
  /** Explicit profile selection may ask iOS for Photos access from this gesture. */
  nativeRequestType?: 'requestCameraRoll' | 'requestProfileCameraRoll'
} = {}) {
  // Native shell: the REAL device photo library replaces the mock grid. The
  // list remains thumbnail-only so opening it does not marshal 24 full-size
  // photos into JavaScript. A picked asset is resolved separately at up to 4K.
  const [nativeRoll, setNativeRoll] = useState<RollItem[] | null>(null)
  const [resolvingAssetId, setResolvingAssetId] = useState<string | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const photoOnlyRef = useRef(photoOnly)
  photoOnlyRef.current = photoOnly
  const videoOnlyRef = useRef(videoOnly)
  videoOnlyRef.current = videoOnly
  const pendingAssetRequests = useRef(new Map<string, {
    assetId: string
    fallback: () => void
    resolve: (src: string, kind: 'photo' | 'video') => void
    timer: number
  }>())
  useEffect(() => {
    // The vertical pager can briefly mount a lightweight wrap clone. Only the
    // real roll may own native callbacks, or the clone can steal a 4K result.
    if (lite || !isNativeShell()) return
    const w = window as unknown as {
      poplurCameraRoll?: (payload: unknown) => void
      poplurCameraRollAsset?: (payload: unknown) => void
    }
    w.poplurCameraRoll = payload => {
      if (Array.isArray(payload)) {
        const items = payload.filter((it): it is RollItem =>
          !!it && typeof (it as RollItem).src === 'string')
        setNativeRoll(items)
        // The shell sends newest-first. Hand the top item to the store so the
        // camera's roll button can show the last thing actually taken, even
        // before this session has captured anything of its own.
        const newest = items.find(it => it.kind === 'photo' || it.kind === 'video')
        setLibraryNewest(newest ? { kind: newest.kind as 'photo' | 'video', src: newest.src } : null)
      } else if (payload && typeof payload === 'object' && (payload as { denied?: boolean }).denied) {
        onDeny?.()
      }
    }
    w.poplurCameraRollAsset = payload => {
      if (!payload || typeof payload !== 'object') return
      const result = payload as NativeRollAssetResult
      if (!result.requestId) return
      const pending = pendingAssetRequests.current.get(result.requestId)
      if (!pending || result.assetId !== pending.assetId) return
      window.clearTimeout(pending.timer)
      pendingAssetRequests.current.delete(result.requestId)
      setResolvingAssetId(current => current === pending.assetId ? null : current)
      // The roll remains mounted off-page to preserve its grid position. A
      // late iCloud response must not open the composer over the live lens.
      if (!activeRef.current) return
      const resolvedSrc = result.fullSrc || result.src
      if (typeof resolvedSrc === 'string' && resolvedSrc.length > 0) {
        pending.resolve(resolvedSrc, result.kind === 'video' ? 'video' : 'photo')
      } else {
        pending.fallback()
      }
    }
    const receiveNativeSelection = (event: Event) => {
      if (!activeRef.current || !onPickRef.current) return
      const detail = (event as CustomEvent<NativeRollSelection>).detail
      if (!detail || typeof detail.src !== 'string') return
      const kind = detail.kind === 'video' ? 'video' : 'photo'
      if ((photoOnlyRef.current && kind !== 'photo') || (videoOnlyRef.current && kind !== 'video')) return
      onPickRef.current({ kind, src: detail.src, length: detail.length })
    }
    window.addEventListener('poplur-native-camera-roll-selection', receiveNativeSelection)
    return () => {
      window.removeEventListener('poplur-native-camera-roll-selection', receiveNativeSelection)
      delete w.poplurCameraRoll
      delete w.poplurCameraRollAsset
      for (const request of pendingAssetRequests.current.values()) {
        window.clearTimeout(request.timer)
      }
      pendingAssetRequests.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lite])
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
  const requestedMediaKind = videoOnly ? 'video' : photoOnly ? 'photo' : 'all'
  const allow = () => {
    try { window.localStorage.setItem('poplur.rollPermission', 'granted') } catch { /* embedded */ }
    setGranted(true)
    if (isNativeShell()) postNativeEvent({ type: nativeRequestType, mediaKind: requestedMediaKind })
  }
  const deny = () => { onDeny?.() }
  // Re-request on every open once granted, so the roll stays fresh. "Open" now
  // means the page is actually on screen — the pager keeps the roll mounted
  // off-page, and asking the device for its photo library while nobody is
  // looking at the roll is exactly the work this screen should not be doing.
  useEffect(() => {
    if (!lite && active && granted && isNativeShell()) {
      postNativeEvent({ type: nativeRequestType, mediaKind: requestedMediaKind })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted, active, lite, nativeRequestType, requestedMediaKind])

  useEffect(() => {
    if (active) return
    for (const request of pendingAssetRequests.current.values()) {
      window.clearTimeout(request.timer)
    }
    pendingAssetRequests.current.clear()
    setResolvingAssetId(null)
  }, [active])

  // What the camera shot this session sits at the FRONT of the roll, newest
  // first — and only those tiles are selectable, because only they belong to
  // this device's session.
  const captures = useSyncExternalStore(onCameraStore, listCaptures, listCaptures)
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)
  const shot: RollItem[] = captures.map(c => ({ kind: c.kind, src: c.src, length: c.length, id: c.id }))
  const rollItems = cameraRollDisplayItems(nativeRoll, ROLL, isNativeShell())
  const items = [...shot, ...rollItems]
    .filter(item => (!photoOnly || item.kind === 'photo') && (!videoOnly || item.kind === 'video'))

  const pickItem = (item: RollItem) => {
    playPop()
    if (!onPick) {
      if (item.id) toggleSelected(item.id)
      return
    }
    const fallback = () => onPick({
      kind: item.kind,
      src: item.fullSrc || item.src,
      length: item.length,
    })
    if (!isNativeShell() || !item.assetId) {
      fallback()
      return
    }
    if (resolvingAssetId) return

    const requestId = `roll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    setResolvingAssetId(item.assetId)
    const finishFallback = () => {
      const pending = pendingAssetRequests.current.get(requestId)
      if (!pending) return
      pendingAssetRequests.current.delete(requestId)
      setResolvingAssetId(current => current === item.assetId ? null : current)
      fallback()
    }
    const timer = window.setTimeout(finishFallback, ROLL_ASSET_TIMEOUT_MS)
    pendingAssetRequests.current.set(requestId, {
      assetId: item.assetId,
      timer,
      fallback,
      resolve: (src, kind) => onPick({ kind, src, length: item.length }),
    })
    if (!postNativeEvent({
      type: 'requestCameraRollAsset',
      requestId,
      assetId: item.assetId,
      maxPixelSize: MAX_ROLL_ASSET_EDGE,
    })) {
      window.clearTimeout(timer)
      finishFallback()
    }
  }

  return (
    <section className={styles.cameraRoll} aria-label="Camera roll">
      {!hideHeader && (
        <header className={styles.rollHeader}>
          <img className={styles.rollLogo} src="logo_icon.png" alt="" draggable={false} />
          <h1 className={styles.rollTitle}>Camera Roll</h1>
          <span className={styles.rollCount}>
            {picked ? `${picked} selected` : `${items.length} captures`}
          </span>
        </header>
      )}

      <div className={styles.rollGrid}>
        {items.map((item, index) => {
          const poster = item.poster ?? posterFor(item.src)
          return (
            <figure
              key={item.id ?? index}
              className={item.id && isSelected(item.id) ? `${styles.rollTile} ${styles.rollTileOn}` : styles.rollTile}
              aria-busy={Boolean(item.assetId && resolvingAssetId === item.assetId)}
              // Picking a capture opens the composer (filter → original/AI → post).
              // Every tile is pickable, not just ones the store gave an id: the
              // seeded roll has no ids, and a roll where most tiles do nothing when
              // tapped is the bug, not the design. Selection stays the no-composer
              // fallback, and it still needs an id.
              onClick={(onPick || item.id) ? () => pickItem(item) : undefined}
            >
              {!active ? (
                // Off the visible page: the tile keeps its shape and its badge
                // so the grid, the count and the scroll position are unchanged,
                // and carries no media element at all — nothing to fetch, and
                // nothing to decode, until you are looking at it.
                item.kind === 'video' ? <span className={styles.rollBadge}>▶ {item.length}</span> : null
              ) : item.kind === 'photo' ? (
                <img className={styles.rollMedia} src={item.src} alt="" loading="lazy" draggable={false} />
              ) : poster ? (
                // A bundled first frame — the same still the feed uses as this
                // clip's poster. Identical picture, no decoder.
                <>
                  <img className={styles.rollMedia} src={poster} alt="" loading="lazy" draggable={false} />
                  <span className={styles.rollBadge}>▶ {item.length}</span>
                </>
              ) : lite ? (
                // Lite clone (the pager's wrap panel, visible only mid-slide):
                // no <video> decoders, just the badge on a dark tile.
                <span className={styles.rollBadge}>▶ {item.length}</span>
              ) : (
                <>
                  {/* This session's own recordings have no bundled still, so
                      they still decode a frame. #t=0.1 forces the browser to
                      paint a real first frame under preload=metadata (plain
                      metadata stays blank). preload=none would leave the tile
                      empty, so metadata is the floor here. */}
                  <video className={styles.rollMedia} src={`${item.src}#t=0.1`} preload="metadata" muted playsInline />
                  <span className={styles.rollBadge}>▶ {item.length}</span>
                </>
              )}
              {item.id && isSelected(item.id) && <span className={styles.rollTick} aria-hidden="true">✓</span>}
            </figure>
          )
        })}
      </div>

      {!granted && !lite && active && (
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
