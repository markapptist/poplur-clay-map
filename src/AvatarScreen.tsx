import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './AvatarScreen.module.css'
import { playPop } from './pop'
import { markCubeNavigationPop, playCubeNavigationPop } from './cubeNavigationSound'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import {
  AVATAR_CUBE_COST,
  canAfford,
  creditBalance,
  onCreditsChange,
  refreshCredits,
} from './poplurCredits'
import {
  avatarCubes,
  deleteAvatarCube,
  onAvatarCubeChange,
  readCubeBlob,
  saveAvatarCube,
  wearAvatarCube,
  wornCubeId,
  type AvatarCube,
} from './avatarCube'
import {
  MeshyUnavailable,
  bakeLogoCube,
  generateMeshyCube,
  isMeshyConfigured,
  type MeshyStyle,
} from './meshy'

// AVATAR — Profile's cube shop.
//
// Everywhere else in Poplur the cube is the app's object: the mark, the globe,
// the TV. On your own profile it is YOU, and for a business it should be their
// logo. So this screen takes a picture you supply and gives back a cube you can
// wear as the navigator on Profile.
//
// Two ways to make one, both driven by YOUR image and nothing else (meshy.ts):
//   • Meshy sculpts real geometry from the photo. It costs Poplur money per
//     task, so it costs Poplur credits — that is the whole reason credits exist
//     on this screen.
//   • The local bake presses the image onto the faces of the house clay cube,
//     on the device, for nothing. For a flat logo this is often the RIGHT
//     answer, not the consolation prize, so it is offered as a peer.
//
// THE PREVIEW IS THE NAVIGATOR. There is no second 3D canvas here: a new cube
// is announced to the shell (`poplur-avatar-preview`) and the cube in your hand
// becomes it, live, while you decide. A second WebGL context is exactly what
// the phone cannot afford — see the note that killed ClayPhonePop in HomeTwin.

type Stage = 'shelf' | 'style' | 'working' | 'done'

const STYLES: Array<{ id: MeshyStyle; name: string; sub: string }> = [
  { id: 'clay', name: 'Clay', sub: 'Matches Poplur' },
  { id: 'realistic', name: 'Realistic', sub: 'True to the photo' },
  { id: 'cartoon', name: 'Cartoon', sub: 'Bold and chunky' },
]

/** ProfileTwin owns this key; read-only here so AVATAR can offer the picture
    you already set instead of asking for it twice. */
const PROFILE_PHOTO_KEY = 'poplur.profile.photo'

function profilePhoto(): string | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_PHOTO_KEY)
    return raw && (raw.startsWith('data:image/') || /^https:\/\//i.test(raw)) ? raw : null
  } catch { return null }
}

/** Read a picked file as a data URI. Cubes are made from it and the thumbnail
    is stored as it, so the gallery has something to show without keeping the
    model decoded. */
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read'))
    reader.readAsDataURL(file)
  })
}

/** Shrink the source down to a thumbnail before it goes in localStorage. A
    12MP phone photo as a data URI is several MB and would evict the profile
    picture, which shares that budget. */
async function thumbnail(source: string, px = 220): Promise<string> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.crossOrigin = 'anonymous'
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('unreadable'))
      element.src = source
    })
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, px / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return source
  }
}

const sizeKb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

/** Tell the shell which model the navigator should be holding — null hands it
    back. The cube in your hand is this screen's only 3D preview. */
function previewCube(url: string | null) {
  window.dispatchEvent(new CustomEvent('poplur-avatar-preview', { detail: url }))
}

// No onClose prop is used to dismiss: the cube is the universal back control
// for every hold-menu subscreen. It stays in the signature for hosts that
// raise this screen themselves.
export default function AvatarScreen({ onClose: _onClose, bindBack }: {
  onClose: () => void
  /** The cube's back button, lent down from the hold menu. The screen has
      STAGES, so it hands its step-back-to-the-shelf up rather than printing a
      "‹ BACK" of its own. See HoldMenuTwin's nativeBackRef. */
  bindBack?: (fn: (() => boolean) | null) => void
}) {
  const stepBackRef = useRef<() => boolean>(() => false)
  const [stage, setStage] = useState<Stage>('shelf')
  const [cubes, setCubes] = useState<AvatarCube[]>(() => avatarCubes())
  const [worn, setWorn] = useState<string | null>(() => wornCubeId())
  const [credits, setCredits] = useState(() => creditBalance())
  const [source, setSource] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [style, setStyle] = useState<MeshyStyle>('clay')
  const [progress, setProgress] = useState(0)
  const [progressNote, setProgressNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [made, setMade] = useState<AvatarCube | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The blob URL behind the live preview. Held so it can be revoked — a screen
  // that mints one per attempt and never releases them leaks whole models.
  const previewUrlRef = useRef<string | null>(null)

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    previewCube(null)
  }, [])

  useEffect(() => onCreditsChange(() => setCredits(creditBalance())), [])
  // The balance is the account's, on the server.
  useEffect(() => { void refreshCredits().catch(() => { /* the last known balance stays up */ }) }, [])
  useEffect(() => onAvatarCubeChange(() => {
    setCubes(avatarCubes())
    setWorn(wornCubeId())
  }), [])
  // Leaving the screen hands the navigator back and cancels anything in flight.
  useEffect(() => () => {
    abortRef.current?.abort()
    releasePreview()
  }, [releasePreview])

  const say = (message: string) => {
    setNote(message)
    window.setTimeout(() => setNote(current => (current === message ? null : current)), 3_000)
  }

  /** Show a model on the navigator, replacing whatever was previewed before. */
  const showOnCube = (glb: Blob) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = URL.createObjectURL(glb)
    previewCube(previewUrlRef.current)
  }

  const pickFile = () => {
    playPop()
    fileRef.current?.click()
  }

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so picking the same file twice still fires
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('That has to be an image.'); return }
    try {
      const data = await readFile(file)
      setSource(data)
      setName(current => current || file.name.replace(/\.[^.]+$/, ''))
      setError(null)
      setStage('style')
      playPop()
    } catch {
      setError('That file could not be read.')
    }
  }

  const useProfilePhoto = () => {
    const photo = profilePhoto()
    if (!photo) { say('No profile picture set yet.'); return }
    playPop()
    setSource(photo)
    setName(current => current || 'My face')
    setStage('style')
  }

  /** The free path: your image on the faces of the house cube, made here. */
  const pressLogo = async () => {
    if (!source) return
    playPop()
    setStage('working')
    setError(null)
    setProgress(0.35)
    setProgressNote('Pressing your image into clay')
    try {
      const glb = await bakeLogoCube(source)
      setProgress(0.85)
      setProgressNote('Packing the cube')
      const cube = await saveAvatarCube(glb, {
        name: name || 'My cube',
        source: 'logo',
        thumb: await thumbnail(source),
      })
      playCubeNavigationPop()
      showOnCube(glb)
      setMade(cube)
      setProgress(1)
      setStage('done')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That cube could not be made.')
      setStage('style')
    }
  }

  /** The paid path: Meshy sculpts real geometry, through the Poplur backend. */
  const sculpt = async () => {
    if (!source) return
    if (!isMeshyConfigured()) {
      // Same honesty as the AI composer: say where it runs instead of
      // inventing a model.
      setError(
        isNativeShell()
          ? 'The sculptor is not switched on for this build yet. You can still press your image on for free.'
          : 'Sculpting runs on your Poplur account in the app, so this browser twin can’t call it. Pressing your image on works here.',
      )
      return
    }
    if (!canAfford(AVATAR_CUBE_COST)) { say('Not enough credits.'); return }
    // The server debits the account BEFORE it calls Meshy and refunds a job
    // that fails (meshyModels.ts). Charging on success looks kinder and is
    // worse: a job that succeeds while the phone is asleep would never be
    // billed, and Meshy has already been paid by then.
    playPop()
    setStage('working')
    setError(null)
    setProgress(0.02)
    setProgressNote('Waking the sculptor')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const glb = await generateMeshyCube({
        image: source,
        name: name || 'My cube',
        style,
        signal: controller.signal,
        onProgress: ({ ratio, stage: label }) => { setProgress(ratio); setProgressNote(label) },
      })
      const cube = await saveAvatarCube(glb, {
        name: name || 'My cube',
        source: 'meshy',
        thumb: await thumbnail(source),
      })
      playCubeNavigationPop()
      showOnCube(glb)
      setMade(cube)
      setProgress(1)
      setStage('done')
    } catch (failure) {
      const cancelled = failure instanceof DOMException && failure.name === 'AbortError'
      if (!cancelled) {
        setError(
          failure instanceof MeshyUnavailable
            ? 'The sculptor is not reachable from here.'
            : (failure instanceof Error ? failure.message : 'The sculptor could not finish.'),
        )
      }
      setStage('style')
    } finally {
      abortRef.current = null
      // Show what the server charged, or refunded.
      void refreshCredits().catch(() => { /* the next open shows it */ })
    }
  }

  const cancel = () => {
    playPop()
    abortRef.current?.abort()
    setStage('style')
  }

  const wear = async (cube: AvatarCube) => {
    playCubeNavigationPop()
    wearAvatarCube(cube.id)
    setWorn(cube.id)
    // Hand the navigator back so it picks the worn cube up through the normal
    // route — otherwise the preview would keep holding a URL that is now the
    // shell's job to own.
    releasePreview()
    // Land back on the shelf: the YOUR CUBE card lighting up cyan IS the
    // confirmation, and staying on a page whose one button re-wears what you
    // are already wearing reads as the tap not having taken.
    setSource(null)
    setMade(null)
    setStage('shelf')
    say(`Wearing ${cube.name}.`)
  }

  const takeOff = () => {
    // Avatar's shelf keeps the printer navigator above worn/default state, so
    // taking a cube off does not change the visible model until a later,
    // separately sounded screen close.
    playPop()
    wearAvatarCube(null)
    setWorn(null)
    releasePreview()
    say('Back to the Poplur cube.')
  }

  /** Put a saved cube in your hand without wearing it, so the shelf can be
      browsed in 3D. Reads the blob back out of IndexedDB. */
  const tryOn = async (cube: AvatarCube) => {
    playPop()
    const blob = await readCubeBlob(cube.id)
    if (!blob) { say('That cube’s model is missing.'); return }
    markCubeNavigationPop()
    showOnCube(blob)
    say(`${cube.name} is in your hand — WEAR IT to keep it.`)
    setMade(cube)
    setStage('done')
  }

  const remove = async (cube: AvatarCube) => {
    // The Avatar shelf is holding its printer model, not the worn cube. Even a
    // worn-item delete therefore keeps the current navigator unchanged; the
    // eventual screen close owns the later Profile model handoff.
    playPop()
    await deleteAvatarCube(cube.id)
    say(`Deleted ${cube.name}.`)
  }

  const getCredits = () => {
    playPop()
    if (isNativeShell()) {
      // Billing belongs to the store on the account, not to this screen.
      postNativeEvent({ type: 'purchaseCredits', product: 'poplur-credits' })
      say('Opening credits in the Store.')
      return
    }
    say('Credits are bought in the app, on your account.')
  }

  const startOver = (withSound = true) => {
    if (withSound) playCubeNavigationPop()
    releasePreview()
    setSource(null)
    setMade(null)
    setError(null)
    setStage('shelf')
  }

  // Any stage past the shelf steps back to it; the shelf itself is the root,
  // so the cube falls through there and closes the screen as it always did.
  // 'working' is deliberately NOT a stop: a sculpt in flight has nothing to
  // return to, and startOver would strand the job it is watching.
  stepBackRef.current = () => {
    if (stage === 'shelf' || stage === 'working') return false
    // Home plays the persistent-cube back pop after this handler succeeds.
    startOver(false)
    return true
  }
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => stepBackRef.current())
    return () => bindBack(null)
  }, [bindBack])

  const wornCube = cubes.find(cube => cube.id === worn) ?? null
  const affordable = credits >= AVATAR_CUBE_COST
  // Say it on the button, not after the tap: with no generator endpoint in
  // this build the sculptor CANNOT run, and a lit pink button that "errors"
  // when pressed reads as broken. The tap still answers (the same honest note
  // sculpt() shows), but nobody is invited to a door that will not open.
  const sculptReady = isMeshyConfigured()

  return (
    <div className={styles.screen} data-clay-scroll data-poplur-screen="avatar">
      <div className={styles.body}>

        {/* Credits are the gate on this screen, so the balance is the first
            thing on it rather than a detail found after a failed press. */}
        <div className={styles.wallet}>
          <div className={styles.walletText}>
            <b>◆ {credits}</b>
            <i>Poplur credits</i>
          </div>
          <button className={styles.walletButton} onClick={getCredits}>GET CREDITS</button>
        </div>

        {stage === 'shelf' && (
          <>
            <section className={styles.wearing} data-on={wornCube ? 'true' : undefined}>
              <p className={styles.kicker}>YOUR CUBE</p>
              {wornCube ? (
                <div className={styles.wearingRow}>
                  <img className={styles.wearingArt} src={wornCube.thumb} alt="" draggable={false} />
                  <div className={styles.wearingText}>
                    <b>{wornCube.name}</b>
                    <i>{wornCube.source === 'meshy' ? 'Sculpted by Meshy' : 'Your image on clay'} · {sizeKb(wornCube.bytes)}</i>
                  </div>
                  <button className={styles.ghost} onClick={takeOff}>TAKE OFF</button>
                </div>
              ) : (
                <p className={styles.blurb}>
                  You are wearing the Poplur cube. Make one from a photo — a logo, a
                  face, a product — and it becomes the object in your hand on Profile.
                </p>
              )}
            </section>

            <button className={styles.primary} onClick={pickFile}>MAKE A CUBE</button>
            <button className={styles.secondary} onClick={useProfilePhoto}>
              USE MY PROFILE PICTURE
            </button>

            {cubes.length > 0 && (
              <section className={styles.shelf}>
                <p className={styles.kicker}>MADE BY YOU</p>
                <div className={styles.shelfRow}>
                  {cubes.map(cube => (
                    <div key={cube.id} className={styles.shelfItem} data-worn={cube.id === worn ? 'true' : undefined}>
                      <button className={styles.shelfArt} onClick={() => void tryOn(cube)}>
                        <img src={cube.thumb} alt="" draggable={false} />
                        {cube.id === worn && <span className={styles.shelfWorn}>WORN</span>}
                      </button>
                      <b className={styles.shelfName}>{cube.name}</b>
                      <button className={styles.shelfDelete} onClick={() => void remove(cube)}>DELETE</button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className={styles.footnote}>
              Sculpting sends your picture to Meshy through Poplur and costs{' '}
              {AVATAR_CUBE_COST} credits. Pressing your image onto a clay cube happens
              on this device and is free.
            </p>
          </>
        )}

        {stage === 'style' && source && (
          <>
            <section className={styles.sourceCard}>
              <img className={styles.sourceArt} src={source} alt="" draggable={false} />
              <button className={styles.ghost} onClick={pickFile}>CHANGE</button>
            </section>

            <label className={styles.field}>
              <span>NAME</span>
              <input
                value={name}
                maxLength={28}
                placeholder="My cube"
                onChange={event => setName(event.target.value)}
              />
            </label>

            <p className={styles.kicker}>SCULPT STYLE</p>
            <div className={styles.styles}>
              {STYLES.map(option => (
                <button
                  key={option.id}
                  className={option.id === style ? styles.styleOn : styles.style}
                  onClick={() => { playPop(); setStyle(option.id) }}
                >
                  <b>{option.name}</b>
                  <i>{option.sub}</i>
                </button>
              ))}
            </div>

            {error && <p className={styles.error}>{error}</p>}

            {/* With the sculptor offline, the free bake is the lit primary —
                the working path gets the working button. */}
            <button
              className={!sculptReady ? styles.primaryLocked : affordable ? styles.primary : styles.primaryLocked}
              onClick={!sculptReady ? () => void sculpt() : affordable ? () => void sculpt() : getCredits}
            >
              {!sculptReady
                ? 'SCULPT WITH MESHY · COMING SOON'
                : affordable
                  ? `SCULPT WITH MESHY · ${AVATAR_CUBE_COST} CREDITS`
                  : `NEED ${AVATAR_CUBE_COST - credits} MORE CREDITS`}
            </button>
            <button
              className={sculptReady ? styles.secondary : styles.primary}
              onClick={() => void pressLogo()}
            >
              PRESS IT ON A CLAY CUBE · FREE
            </button>
            {/* No "‹ BACK" — the cube under the screen steps back to the
                shelf, the same control that closes the screen from there. */}

            <p className={styles.footnote}>
              Sculpting builds real geometry from your photo and takes a couple of
              minutes. Pressing it on keeps the clay cube and puts your image on every
              face — for a flat logo that is usually what you want, and it is instant.
            </p>
          </>
        )}

        {stage === 'working' && (
          <section className={styles.working}>
            <p className={styles.kicker}>MAKING YOUR CUBE</p>
            <div className={styles.meter}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className={styles.workingNote}>{progressNote}</p>
            <button className={styles.ghost} onClick={cancel}>CANCEL</button>
          </section>
        )}

        {stage === 'done' && made && (
          <>
            <section className={styles.done}>
              <p className={styles.kicker}>IT’S IN YOUR HAND</p>
              <p className={styles.blurb}>
                Turn the cube below to look at <b>{made.name}</b>. Wear it and it becomes
                your navigator on Profile.
              </p>
              <p className={styles.doneMeta}>
                {made.source === 'meshy' ? 'Sculpted by Meshy' : 'Your image on clay'} · {sizeKb(made.bytes)}
              </p>
            </section>
            <button className={styles.primary} onClick={() => void wear(made)}>WEAR IT</button>
            <button className={styles.secondary} onClick={() => startOver()}>KEEP, DON’T WEAR</button>
          </>
        )}

        {note && <p className={styles.note}>{note}</p>}

        <input
          ref={fileRef}
          className={styles.file}
          type="file"
          accept="image/*"
          onChange={event => void onFile(event)}
        />
      </div>
    </div>
  )
}
