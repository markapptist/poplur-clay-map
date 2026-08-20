import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './PhoneScreen.module.css'
import { OTHER_POPS } from './data'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { reachBetween, reachState, type Reach, type ReachState } from './reach'
import { packBase } from './assetPacks'
import { playPop } from './pop'
import { PROFILE_THEME_CHANGE_EVENT } from './profileThemes'
import { postNativeEvent } from './nativeBridge'

// The Poplur phone.
//
// Who you can call is a radius question with TWO answers, because everyone
// carries their own radius:
//
//   you can call them   distance <= YOUR radius
//   they can call you   distance <= THEIR radius
//
// Those are independent — a pop with a 320km reach can ring you from another
// city while your own reach falls a long way short of them — and the phone's
// first screen is exactly that list.
//
// It is shown INSIDE the handset, on the LCD, in the LCD's own font. The
// device art, the panel's geometry and colours, the topline/title/softkey
// layout and the keypad hit zones all follow the phone twin
// (poplur-subscreen-twins), so this is that phone with something real on its
// screen rather than a second phone that resembles it.

/** Device art, from the subscreens pack — the same files the twin loads. */
const COLORWAYS = [
  ['Silver', 'poplur_bling_phone_01_silver_diamond'],
  ['Gold', 'poplur_bling_phone_02_champagne_gold'],
  ['Rose', 'poplur_bling_phone_03_rose_gold_pink'],
  ['Ruby', 'poplur_bling_phone_04_ruby_red'],
  ['Blue', 'poplur_bling_phone_05_sapphire_blue'],
  ['Green', 'poplur_bling_phone_06_emerald_green'],
  ['Purple', 'poplur_bling_phone_07_amethyst_purple'],
  ['Onyx', 'poplur_bling_phone_08_jet_black_onyx'],
  ['Aqua', 'poplur_bling_phone_09_icy_aqua_turquoise'],
  ['Holo', 'poplur_bling_phone_10_holographic_iridescent'],
] as const

/** `${assets}/<set>.imageset/<file>` — the twin's own `ios()` path shape. */
function restUrl(set: string): string {
  return `${packBase('subscreens', 'subscreens')}/assets/${set}.imageset/${set}.png`
}

/** Each colourway's 4x4 wake spritesheet — same set, boot naming. */
function bootUrl(set: string): string {
  const slug = set.replace(/^poplur_bling_phone_\d+_/, '')
  return `${packBase('subscreens', 'subscreens')}/assets/poplur_phone_bootup_${slug}.imageset/poplur_${slug}_boot_spritesheet_4x4.png`
}

const BOOT_FRAMES = 16
const BOOT_FRAME_MS = 112

/** Left%, top%, width%, height% — recalibrated for the cropped (object-fit:
 *  cover) case art. Row tops are compressed slightly off their raw geometric
 *  conversion (which pushed the bottom row past the frame edge) so all four
 *  rows stay fully on-screen and non-overlapping; still ordered top-to-bottom
 *  matching the physical keys. */
const KEYS: Array<[key: string, left: number, top: number, w: number, h: number]> = [
  ['1', 6.8, 67.9, 24.9, 7], ['2', 37.6, 67.9, 24.9, 7], ['3', 68.3, 67.9, 24.9, 7],
  ['4', 6.8, 75.9, 24.9, 7], ['5', 37.6, 75.9, 24.9, 7], ['6', 68.3, 75.9, 24.9, 7],
  ['7', 6.8, 84.0, 24.9, 7], ['8', 37.6, 84.0, 24.9, 7], ['9', 68.3, 84.0, 24.9, 7],
  ['*', 6.8, 92.0, 24.9, 7], ['0', 37.6, 92.0, 24.9, 7], ['#', 68.3, 92.0, 24.9, 7],
  ['5', 34.6, 51.3, 30.7, 10.2],
]

interface Contact {
  id: string
  handle: string
  place: string
  theirRadiusKm: number
  reach: Reach
  state: ReachState
}

/** Most open line first; closest first inside a group. */
const GROUP_ORDER: ReachState[] = ['both', 'outgoing', 'incoming', 'none']

/** Two marks per row, in the LCD's own character vocabulary: the top arrow is
 *  you reaching out, the bottom is them reaching you. */
const GLYPH: Record<ReachState, string> = {
  both: '⇄',
  outgoing: '→',
  incoming: '←',
  none: '·',
}

const STATE_WORD: Record<ReachState, string> = {
  both: 'BOTH WAYS',
  outgoing: 'YOU CAN CALL',
  incoming: 'THEY CAN CALL',
  none: 'OUT OF REACH',
}

function km(value: number): string {
  return value >= 100 ? `${Math.round(value)}KM` : `${value.toFixed(1)}KM`
}

export default function PhoneScreen({ onClose }: { onClose?: () => void }) {
  const [reachKm, setReachKm] = useState(() => radiusKm())
  const [index, setIndex] = useState(0)
  const [colorIndex, setColorIndex] = useState(0)
  const [calling, setCalling] = useState<Contact | null>(null)
  const [booting, setBooting] = useState(true)
  const [bootFrame, setBootFrame] = useState(0)
  const bootTimer = useRef<number | null>(null)

  useEffect(() => {
    const sync = () => setReachKm(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  // Wake sequence: 16 frames of the colourway's own spritesheet, one every
  // 112ms — about 1.8s, the same beat the map iPod boots to. Reused for a
  // theme change too: the handset reboots rather than just repainting.
  const runBoot = useCallback(() => {
    if (bootTimer.current !== null) window.clearInterval(bootTimer.current)
    setBooting(true)
    setBootFrame(0)
    let frame = 0
    bootTimer.current = window.setInterval(() => {
      frame += 1
      if (frame >= BOOT_FRAMES) {
        if (bootTimer.current !== null) window.clearInterval(bootTimer.current)
        bootTimer.current = null
        setBooting(false)
        return
      }
      setBootFrame(frame)
    }, BOOT_FRAME_MS)
  }, [])

  useEffect(() => {
    runBoot()
    return () => {
      if (bootTimer.current !== null) window.clearInterval(bootTimer.current)
    }
  }, [runBoot])

  // The app theme changing reboots the handset and buzzes the phone, the same
  // reaction the map iPod now gives it.
  useEffect(() => {
    const sync = () => {
      try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
      postNativeEvent({ type: 'phoneThemeEffects' })
      runBoot()
    }
    window.addEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
  }, [runBoot])

  const contacts = useMemo<Contact[]>(() => {
    return OTHER_POPS.map(pop => {
      const reach = reachBetween(pop.coords, pop.radiusKm, reachKm)
      return {
        id: pop.id,
        handle: pop.user,
        place: pop.name,
        theirRadiusKm: pop.radiusKm,
        reach,
        state: reachState(reach),
      }
    }).sort((a, b) => {
      const group = GROUP_ORDER.indexOf(a.state) - GROUP_ORDER.indexOf(b.state)
      return group !== 0 ? group : a.reach.distanceKm - b.reach.distanceKm
    })
  }, [reachKm])

  const current = contacts[Math.min(index, contacts.length - 1)]

  const step = useCallback((delta: 1 | -1) => {
    playPop()
    setIndex(i => (i + delta + contacts.length) % contacts.length)
  }, [contacts.length])

  const select = useCallback(() => {
    if (!current) return
    // Only the outgoing direction dials. Someone who can reach YOU is not
    // someone you can reach, and the LCD says so instead of pretending.
    if (!current.reach.youCanCall) { playPop(); return }
    playPop()
    setCalling(current)
  }, [current])

  const back = useCallback(() => {
    playPop()
    if (calling) { setCalling(null); return }
    onClose?.()
  }, [calling, onClose])

  const press = useCallback((key: string) => {
    if (key === '2') step(-1)
    else if (key === '8') step(1)
    else if (key === '5') select()
    else if (key === '*') back()
    else playPop()
  }, [back, select, step])

  // Keyboard twin of the keypad, so the phone is drivable without a finger.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const map: Record<string, string> = {
        ArrowUp: '2', ArrowDown: '8', Enter: '5', Escape: '*',
      }
      const key = map[event.key] ?? (/^[0-9*#]$/.test(event.key) ? event.key : null)
      if (!key) return
      event.preventDefault()
      press(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  // Three rows, windowed on the cursor — the twin's own menu behaviour.
  const start = Math.max(0, Math.min(index - 1, Math.max(0, contacts.length - 3)))
  const visible = contacts.slice(start, start + 3)
  const colorway = COLORWAYS[colorIndex % COLORWAYS.length]

  return (
    <div className={styles.screen} data-poplur-screen="profile-phone" aria-label="Poplur phone">
      <div className={booting ? `${styles.device} ${styles.deviceBooting}` : styles.device}>
        <img className={styles.rest} src={restUrl(colorway[1])} alt={`Poplur phone, ${colorway[0]}`} draggable={false} />

        {booting && (
          <div
            className={styles.boot}
            aria-hidden="true"
            style={{
              backgroundImage: `url(${bootUrl(colorway[1])})`,
              backgroundPosition: `${(bootFrame % 4) / 3 * 100}% ${Math.floor(bootFrame / 4) / 3 * 100}%`,
            }}
          />
        )}

        <div className={styles.lcd} aria-live="polite">
          <div className={styles.topline} aria-hidden="true">
            <span>▮▮▮ ⋮</span><span>▮▮</span>
          </div>

          {calling ? (
            <>
              <div className={styles.callStatus}>
                <strong>CALLING</strong>
                <span>{calling.handle.replace(/^@/, '').toUpperCase()}</span>
                <span>
                  {calling.reach.theyCanCall ? 'LINE OPEN BOTH WAYS' : 'ONE WAY · THEY CANNOT'}
                </span>
              </div>
              <div className={styles.softkeys}>5 HANG UP&nbsp;&nbsp;* BACK</div>
            </>
          ) : (
            <>
              <div className={styles.titleRow}>
                <strong>CALLS {km(reachKm)}</strong>
                <em>{contacts.length ? index + 1 : 0}/{contacts.length}</em>
              </div>
              <div className={styles.list}>
                {visible.map((contact, offset) => {
                  const at = start + offset
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      className={at === index ? `${styles.row} ${styles.rowOn}` : styles.row}
                      onClick={() => { setIndex(at); if (at === index) select() }}
                      aria-label={`${contact.handle}, ${STATE_WORD[contact.state]}`}
                    >
                      <b className={styles.rowGlyph}>{GLYPH[contact.state]}</b>
                      <span className={styles.rowText}>
                        <strong className={styles.rowTitle}>{contact.handle.replace(/^@/, '').toUpperCase()}</strong>
                        <em className={styles.rowDetail}>
                          {km(contact.reach.distanceKm)} · {STATE_WORD[contact.state]}
                        </em>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className={styles.softkeys}>
                {current?.reach.youCanCall ? '2/8 SCROLL  5 CALL  * BACK' : '2/8 SCROLL  * BACK'}
              </div>
            </>
          )}
        </div>

        <div className={styles.keys} aria-label="Poplur phone keypad">
          {KEYS.map(([key, left, top, w, h], i) => (
            <button
              key={`${key}-${i}`}
              type="button"
              className={styles.key}
              style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
              onClick={() => press(key)}
              aria-label={i === KEYS.length - 1 ? 'Center select' : key}
            />
          ))}
        </div>

        <button
          type="button"
          className={`${styles.swipe} ${styles.swipeLeft}`}
          onClick={() => { playPop(); setColorIndex(i => (i - 1 + COLORWAYS.length) % COLORWAYS.length) }}
          aria-label="Previous phone colorway"
        >‹</button>
        <button
          type="button"
          className={`${styles.swipe} ${styles.swipeRight}`}
          onClick={() => { playPop(); setColorIndex(i => (i + 1) % COLORWAYS.length) }}
          aria-label="Next phone colorway"
        >›</button>
      </div>
    </div>
  )
}
