import React, { useEffect, useRef, useState } from 'react'
import styles from './ProfileTwin.module.css'
import { playPop } from './pop'

// Browser twin of the iOS Profile screen (ProfileView.swift). Light ground with
// the animated 3D Mark head in a cyan→magenta gradient squircle, a notification
// bell to its left, USERNAME, a cyan speaking equaliser, and the
// Media / Messages / Saved switcher. Kept per the user: the poplur wordmark and
// the channel-number tiles, plus pull-to-refresh on the grid.
//
// The head's idle animation mirrors MarkHeadView.swift: a slow vertical bob
// (±0.007 over 1.6s) and a yaw sway (±0.07 rad over 2.4s each way). The bob is
// CSS; the sway cross-fades five pre-rendered yaw frames (−12°…+12°).

const HEAD_FRAMES = [0, 1, 2, 3, 4] // mark_head0..4 = yaw −12, −6, 0, +6, +12

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
  const frameRefs = useRef<(HTMLImageElement | null)[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const pullRef = useRef<HTMLDivElement>(null)
  const spinnerRef = useRef<HTMLDivElement>(null)

  // Yaw sway: cross-fade the five head frames along a slow sine (4.8s cycle).
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const t = (now - start) / 1000
      const f = 2 + 2 * Math.sin((2 * Math.PI * t) / 4.8) // 0..4, centred
      const i0 = Math.min(3, Math.floor(f))
      const frac = f - i0
      frameRefs.current.forEach((img, i) => {
        if (!img) return
        img.style.opacity = i === i0 ? String(1 - frac) : i === i0 + 1 ? String(frac) : '0'
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Pull-to-refresh on the grid, like the app's PoplurRefreshHeader.
  useEffect(() => {
    const content = contentRef.current
    const inner = pullRef.current
    const spinner = spinnerRef.current
    if (!content || !inner || !spinner) return

    let pulling = false
    let startY = 0
    let pull = 0
    let refreshing = false

    const apply = () => {
      inner.style.transform = `translateY(${pull}px)`
      spinner.style.opacity = String(Math.min(1, pull / 48))
      if (!refreshing) spinner.style.transform = `translateX(-50%) rotate(${pull * 6}deg)`
    }

    const onDown = (e: PointerEvent) => {
      if (refreshing) return
      pulling = true
      startY = e.clientY
    }
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

  const grid = mode === 'saved' ? SAVED : MEDIA

  return (
    <section className={styles.profile}>
      <button type="button" className={styles.bell} onClick={() => playPop()} aria-label="Notifications">
        🔔
        <span className={styles.bellDot} />
      </button>

      <div className={styles.header}>
        <div className={styles.avatarWrap} onClick={() => playPop()}>
          <div className={styles.avatarFrame} />
          <div className={styles.headStack}>
            {HEAD_FRAMES.map(i => (
              <img
                key={i}
                ref={el => { frameRefs.current[i] = el }}
                className={styles.headFrame}
                style={{ opacity: i === 2 ? 1 : 0 }}
                src={`mark_head${i}.png`}
                alt=""
                draggable="false"
              />
            ))}
          </div>
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
    </section>
  )
}
