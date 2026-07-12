import React, { useEffect, useRef, useState } from 'react'
import styles from './ProfileTwin.module.css'
import { playPop } from './pop'

// Browser twin of the iOS Profile screen (ProfileView.swift). Light ground with
// the animated *talking* 3D Mark head in a cyan→magenta gradient squircle, a
// notification bell and a 3D camera flanking it (both centred on the square),
// USERNAME, and the Media / Messages / Saved switcher. Kept per the user: the
// poplur wordmark, the channel-number tiles, and pull-to-refresh on the grid.
//
// The head is the talking rig: eight viseme frames (rendered from
// MarkHead_TalkingRig.glb) cycle in a speech rhythm, over a CSS bob + slow yaw
// sway. Pressing the camera opens a capture flow to shoot a new profile photo.

const TALK_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7]
// A lively, non-sequential mouth pattern; index 5 is the blink/′I′ frame.
const TALK_PATTERN = [1, 3, 2, 4, 6, 7, 2, 1, 5, 4, 3, 6, 2, 0, 1, 4, 7, 0]

const MEDIA = ['CH 24', 'CH 83', 'CH 12', 'CH 07', 'CH 51', 'CH 09']
const SAVED = ['CH 31', 'CH 58', 'CH 44', 'CH 66', 'CH 19', 'CH 72']

const MESSAGES = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m' },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m' },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h' },
]

type Mode = 'media' | 'messages' | 'saved'

export default function ProfileTwin() {
  const [mode, setMode] = useState<Mode>('media')
  const [capturing, setCapturing] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [camError, setCamError] = useState(false)
  const [flash, setFlash] = useState(false)

  const frameRefs = useRef<(HTMLImageElement | null)[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const pullRef = useRef<HTMLDivElement>(null)
  const spinnerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Talking mouth: step through the viseme pattern in a speech rhythm.
  useEffect(() => {
    if (photo) return
    let i = 0
    const show = (f: number) =>
      frameRefs.current.forEach((img, idx) => { if (img) img.style.opacity = idx === f ? '1' : '0' })
    const id = window.setInterval(() => {
      show(TALK_PATTERN[i % TALK_PATTERN.length])
      i++
    }, 110)
    return () => window.clearInterval(id)
  }, [photo])

  // Pull-to-refresh on the grid, like the app's PoplurRefreshHeader.
  useEffect(() => {
    const content = contentRef.current
    const inner = pullRef.current
    const spinner = spinnerRef.current
    if (!content || !inner || !spinner) return
    let pulling = false, startY = 0, pull = 0, refreshing = false
    const apply = () => {
      inner.style.transform = `translateY(${pull}px)`
      spinner.style.opacity = String(Math.min(1, pull / 48))
      if (!refreshing) spinner.style.transform = `translateX(-50%) rotate(${pull * 6}deg)`
    }
    const onDown = (e: PointerEvent) => { if (!refreshing) { pulling = true; startY = e.clientY } }
    const onMove = (e: PointerEvent) => {
      if (!pulling) return
      const dy = e.clientY - startY
      pull = dy > 0 ? Math.min(72, dy * 0.5) : 0
      apply()
    }
    const onUp = () => {
      if (!pulling) return
      pulling = false
      if (pull > 46) {
        refreshing = true
        spinner.classList.add(styles.spin)
        playPop()
        window.setTimeout(() => {
          refreshing = false
          spinner.classList.remove(styles.spin)
          pull = 0
          inner.style.transition = 'transform 0.3s ease'
          apply()
          window.setTimeout(() => { inner.style.transition = '' }, 320)
        }, 900)
      } else {
        pull = 0
        inner.style.transition = 'transform 0.24s ease'
        apply()
        window.setTimeout(() => { inner.style.transition = '' }, 260)
      }
    }
    content.addEventListener('pointerdown', onDown)
    content.addEventListener('pointermove', onMove)
    content.addEventListener('pointerup', onUp)
    content.addEventListener('pointercancel', onUp)
    return () => {
      content.removeEventListener('pointerdown', onDown)
      content.removeEventListener('pointermove', onMove)
      content.removeEventListener('pointerup', onUp)
      content.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // Camera capture: request the webcam when the sheet opens; tidy up on close.
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  useEffect(() => {
    if (!capturing) { stopStream(); return }
    let cancelled = false
    setCamError(false)
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
      .catch(() => { if (!cancelled) setCamError(true) })
    return () => { cancelled = true; stopStream() }
  }, [capturing])

  const shoot = () => {
    playPop()
    setFlash(true)
    window.setTimeout(() => setFlash(false), 380)
    const video = videoRef.current
    if (video && streamRef.current && video.videoWidth) {
      const size = 320
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const g = canvas.getContext('2d')!
      const s = Math.min(video.videoWidth, video.videoHeight)
      const sx = (video.videoWidth - s) / 2
      const sy = (video.videoHeight - s) / 2
      g.save()
      g.translate(size, 0) // mirror the selfie
      g.scale(-1, 1)
      g.drawImage(video, sx, sy, s, s, 0, 0, size, size)
      g.restore()
      setPhoto(canvas.toDataURL('image/png'))
    }
    window.setTimeout(() => setCapturing(false), 260)
  }

  const grid = mode === 'saved' ? SAVED : MEDIA

  return (
    <section className={styles.profile}>
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          <button className={styles.bell} onClick={() => playPop()} aria-label="Notifications">
            🔔<span className={styles.bellDot} />
          </button>

          <div className={styles.avatarFrame} />

          {photo ? (
            <img className={styles.photo} src={photo} alt="" draggable="false" onClick={() => playPop()} />
          ) : (
            <div className={styles.headStack} onClick={() => playPop()}>
              <div className={styles.headTilt}>
                {TALK_FRAMES.map(i => (
                  <img
                    key={i}
                    ref={el => { frameRefs.current[i] = el }}
                    className={styles.headFrame}
                    style={{ opacity: i === 0 ? 1 : 0 }}
                    src={`mark_talk${i}.png`}
                    alt=""
                    draggable="false"
                  />
                ))}
              </div>
            </div>
          )}

          <button className={styles.camBtn} onClick={() => setCapturing(true)} aria-label="Take profile photo">
            <img src="cam_object.png" alt="" draggable="false" />
          </button>
        </div>

        <div className={styles.speaking} aria-hidden="true">
          <span /><span /><span /><span /><span />
        </div>

        <h1 className={styles.username}>USERNAME</h1>

        <div className={styles.modeSwitch}>
          {(['media', 'messages', 'saved'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              className={mode === m ? styles.modeOn : styles.mode}
              onClick={() => setMode(m)}
            >
              {m[0].toUpperCase() + m.slice(1)}
              <i />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.content} ref={contentRef}>
        <div className={styles.refresh} ref={spinnerRef} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M20 12a8 8 0 1 1-2.3-5.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className={styles.pullInner} ref={pullRef}>
          {mode === 'messages' ? (
            <div className={styles.messages}>
              {MESSAGES.map(m => (
                <div key={m.who} className={styles.msgRow}>
                  <div className={styles.msgAvatar}>{m.who[0].toUpperCase()}</div>
                  <div className={styles.msgBody}>
                    <div className={styles.msgTop}>
                      <strong>{m.who}</strong>
                      <span>{m.when}</span>
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.grid}>
              {grid.map(ch => (
                <span key={ch} className={styles.tile}>{ch}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {capturing && (
        <div className={styles.capture}>
          <div className={styles.captureHead}>Take profile photo</div>
          <div className={styles.viewfinder}>
            {camError ? (
              <div className={styles.camFallback}>
                <span>📷</span>
                <p>Camera unavailable here.<br />This is where you’d frame your shot.</p>
              </div>
            ) : (
              <video ref={videoRef} className={styles.video} playsInline muted />
            )}
            <div className={styles.vfRing} />
          </div>
          <div className={styles.captureBar}>
            <button className={styles.cancelBtn} onClick={() => setCapturing(false)}>Cancel</button>
            <button className={styles.shutter} onClick={shoot} aria-label="Capture"><span /></button>
            <div className={styles.captureSpacer} />
          </div>
        </div>
      )}

      {flash && <div className={styles.flash} />}
    </section>
  )
}
