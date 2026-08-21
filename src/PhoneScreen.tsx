import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './PhoneScreen.module.css'
import { OTHER_POPS } from './data'
import { reachBetween } from './reach'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { packBase } from './assetPacks'
import { playPop } from './pop'
import { PROFILE_THEME_CHANGE_EVENT } from './profileThemes'
import { postNativeEvent } from './nativeBridge'
import { placeCall, hangup as hangupCall, subscribeCall, toggleMute, type CallSnapshot } from './webCall'
import { startRingtone, stopRingtone, previewRingtone, getRingtone, setRingtone, RINGTONES, type RingtoneId } from './phoneRingtones'
import ClayChannelArrows from './ClayChannelArrows'

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

/** Left%, top%, width%, height% — the artwork's own key positions (see the
 *  git history on this array for the raw x/y pixel measurements) run through
 *  this stage's crop (object-fit:cover on .rest, ~359x788 against the
 *  1024x1536 source): vertical is untouched since the crop is width-only,
 *  horizontal is remapped through the same crop .lcd uses. Drifts on a stage
 *  with a meaningfully different aspect ratio, same as .lcd. */
const KEYS: Array<[key: string, left: number, top: number, w: number, h: number]> = [
  ['1', 9.6, 61.2, 24.4, 5.8], ['2', 37.1, 61.2, 24.4, 5.8], ['3', 64.8, 61.2, 24.4, 5.8],
  ['4', 9.6, 67.6, 24.4, 6.0], ['5', 37.1, 67.6, 24.4, 6.0], ['6', 64.8, 67.6, 24.4, 6.0],
  ['7', 9.6, 74.1, 24.4, 6.0], ['8', 37.1, 74.1, 24.4, 6.0], ['9', 64.8, 74.1, 24.4, 6.0],
  ['*', 9.6, 80.7, 24.4, 5.5], ['0', 37.1, 80.7, 24.4, 5.5], ['#', 64.8, 80.7, 24.4, 5.5],
  // The centre of the navigation cluster, above the keypad — select.
  ['5', 31.0, 50.5, 38.0, 8.5],
]

interface NativeContact {
  id: string
  name: string
  favourite: boolean
  hasDM: boolean
  inReach: boolean
  distanceKm: number | null
  detail: string
}

interface Contact {
  id: string
  handle: string
  detail: string
  favourite: boolean
  callable: boolean
  distanceKm: number | null
}

function km(value: number): string {
  return value >= 100 ? `${Math.round(value)}KM` : `${value.toFixed(1)}KM`
}

/** The web preview has no native bridge, so `requestPhoneContacts` never gets
 *  an answer. Rather than leave the handset empty and uncallable there, fall
 *  back to the world board — the same pops the map shows — run through the real
 *  reach model against your radius, so the web phone is browsable and you can
 *  place a call from it exactly as on device. Native never uses this: once the
 *  bridge answers even once, its list wins for the life of the screen. */
function fillerContacts(reachKm: number): Contact[] {
  return OTHER_POPS.map(pop => {
    const reach = reachBetween(pop.coords as [number, number], pop.radiusKm, reachKm)
    return {
      id: pop.id,
      handle: pop.user,
      detail: reach.youCanCall ? `${km(reach.distanceKm)} away · in your radius`
        : reach.theyCanCall ? `${km(reach.distanceKm)} away · can reach you`
        : `${km(reach.distanceKm)} away · out of reach`,
      favourite: false,
      callable: reach.youCanCall,
      distanceKm: reach.distanceKm,
    }
  }).sort((a, b) => {
    if (a.callable !== b.callable) return a.callable ? -1 : 1
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
  })
}

/** Real Firestore people when the browser tab is signed in (dial-able uids),
 *  else the world-board filler. Firebase is imported lazily so it never loads
 *  inside the native app, where the bridge answers and this is never reached. */
async function webOrFillerContacts(reachKm: number): Promise<Contact[]> {
  try {
    const fb = await import('./webFirebase')
    if (fb.currentUid()) {
      const { fetchWebContacts } = await import('./webContacts')
      const real = await fetchWebContacts()
      if (real.length > 0) {
        return real.map(c => ({
          id: c.id,
          handle: c.handle,
          detail: c.detail,
          favourite: false,
          callable: c.callable,
          distanceKm: null,
        }))
      }
    }
  } catch { /* fall through to the world board */ }
  return fillerContacts(reachKm)
}

export interface IncomingCall {
  callId: string
  callerId: string
  callerName: string
}

export default function PhoneScreen({ onClose, incomingCall, onAcceptCall, onDeclineCall, autoCall }: {
  onClose?: () => void
  incomingCall?: IncomingCall | null
  onAcceptCall?: (call: IncomingCall) => void
  onDeclineCall?: (call: IncomingCall) => void
  autoCall?: { id: string; name: string } | null
}) {
  const [reachKm, setReachKm] = useState(() => radiusKm())
  const [contacts, setContacts] = useState<Contact[]>([])
  const [index, setIndex] = useState(0)
  const [colorIndex, setColorIndex] = useState(0)
  const [calling, setCalling] = useState<Contact | null>(null)
  const [booting, setBooting] = useState(true)
  const [bootFrame, setBootFrame] = useState(0)
  const [themeRebooting, setThemeRebooting] = useState(false)
  const [liveCall, setLiveCall] = useState<CallSnapshot | null>(null)
  const [callNow, setCallNow] = useState(() => Date.now())
  const [showSettings, setShowSettings] = useState(false)
  const [selectedRingtone, setSelectedRingtone] = useState<RingtoneId>(() => getRingtone())
  const bootTimer = useRef<number | null>(null)
  const everNativeRef = useRef(false)

  useEffect(() => {
    const sync = () => setReachKm(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  useEffect(() => {
    const onCallEnd = (event: MessageEvent) => {
      if (event.data?.type === 'poplurCallEnded') setCalling(null)
    }
    window.addEventListener('message', onCallEnd)
    return () => window.removeEventListener('message', onCallEnd)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'poplurPhoneContacts') return
      // The bridge answered — its list owns the phone from here on, even when
      // it is empty (nobody in reach), which is a real answer, not a gap.
      everNativeRef.current = true
      const raw = data.contacts as NativeContact[] | undefined
      if (!Array.isArray(raw)) return
      setContacts(raw.map(c => ({
        id: c.id,
        handle: c.name,
        detail: c.detail ?? (c.inReach && c.distanceKm != null ? `${km(c.distanceKm)} away` : 'on Poplur'),
        favourite: c.favourite,
        callable: c.inReach || c.hasDM || c.favourite,
        distanceKm: c.distanceKm,
      })))
    }
    window.addEventListener('message', onMessage)
    postNativeEvent({ type: 'requestPhoneContacts', radiusKm: reachKm })
    // No bridge (web preview) means no answer ever comes. On the signed-in web
    // pull REAL people from Firestore (real uids you can actually dial);
    // otherwise fall back to the world board so the phone stays browsable.
    let cancelled = false
    const fallback = window.setTimeout(() => {
      if (everNativeRef.current) return
      void webOrFillerContacts(reachKm).then(list => {
        if (!cancelled && !everNativeRef.current) setContacts(list)
      })
    }, 600)
    return () => {
      cancelled = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(fallback)
    }
  }, [reachKm])

  // When the browser tab signs in, swap the world-board filler for real,
  // dial-able Firestore contacts without waiting for a remount.
  useEffect(() => {
    if (everNativeRef.current) return
    let cancelled = false
    let unsub: (() => void) | undefined
    void import('./webFirebase').then(fb => {
      if (cancelled) return
      unsub = fb.onUser(() => {
        void webOrFillerContacts(reachKm).then(list => {
          if (!cancelled && !everNativeRef.current) setContacts(list)
        })
      })
    })
    return () => { cancelled = true; unsub?.() }
  }, [reachKm])

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

  // The app theme changing reboots the handset with a blue "loading" screen
  // and buzzes the phone.
  useEffect(() => {
    const sync = () => {
      try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
      postNativeEvent({ type: 'phoneThemeEffects' })
      setThemeRebooting(true)
      runBoot()
    }
    window.addEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
  }, [runBoot])

  useEffect(() => {
    if (!booting && themeRebooting) setThemeRebooting(false)
  }, [booting, themeRebooting])

  useEffect(() => subscribeCall(snap => {
    setLiveCall(snap.phase === 'idle' ? null : snap)
    if (snap.phase === 'idle' || snap.phase === 'ended') setCalling(null)
  }), [])

  useEffect(() => {
    if (!liveCall) return
    if (liveCall.phase === 'calling' && liveCall.outgoing) startRingtone()
    else if (liveCall.phase === 'connected' || liveCall.phase === 'ended' || liveCall.phase === 'idle') stopRingtone()
    return () => stopRingtone()
  }, [liveCall?.phase, liveCall?.outgoing])

  useEffect(() => {
    if (incomingCall) startRingtone()
    else stopRingtone()
    return () => stopRingtone()
  }, [incomingCall])

  useEffect(() => {
    if (liveCall?.phase !== 'connected') return
    const id = window.setInterval(() => setCallNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [liveCall?.phase])

  const current = contacts[Math.min(index, contacts.length - 1)]

  const autoCallDone = useRef(false)
  useEffect(() => {
    if (!autoCall || autoCallDone.current || booting || !contacts.length) return
    autoCallDone.current = true
    const target = contacts.find(c => c.id === autoCall.id || c.handle === autoCall.name)
    if (target) {
      const idx = contacts.indexOf(target)
      setIndex(idx)
      setCalling(target)
      void placeCall(target.id, target.handle)
    } else {
      const synth: Contact = { id: autoCall.id, handle: autoCall.name, detail: 'POPLUR MAIL', favourite: false, callable: true, distanceKm: null }
      setCalling(synth)
      void placeCall(autoCall.id, autoCall.name)
    }
  }, [autoCall, booting, contacts])

  // Changing the handset's colourway IS changing its theme, so it buzzes the
  // same way an app-theme change does — the vibration that went missing when
  // this became the live phone. Native haptics ride the same phoneThemeEffects
  // event the theme-change effect uses; navigator.vibrate covers the web.
  const cycleColorway = useCallback((delta: 1 | -1) => {
    playPop()
    try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
    postNativeEvent({ type: 'phoneThemeEffects' })
    setColorIndex(i => (i + delta + COLORWAYS.length) % COLORWAYS.length)
  }, [])

  const step = useCallback((delta: 1 | -1) => {
    playPop()
    setIndex(i => (i + delta + contacts.length) % contacts.length)
  }, [contacts.length])

  const select = useCallback(() => {
    if (!current) return
    if (!current.callable) { playPop(); return }
    playPop()
    setCalling(current)
    // Open the media call (mic + peer connection); the LCD shows CALLING until
    // the InCallBar takes over on connect.
    void placeCall(current.id, current.handle)
  }, [current])

  const back = useCallback(() => {
    playPop()
    if (showSettings) { setShowSettings(false); return }
    if (liveCall && liveCall.phase !== 'idle' && liveCall.phase !== 'ended') {
      hangupCall()
      setCalling(null)
      return
    }
    if (calling) {
      hangupCall()
      setCalling(null)
      return
    }
    if (incomingCall) {
      onDeclineCall?.(incomingCall)
      return
    }
    onClose?.()
  }, [calling, incomingCall, liveCall, onClose, onDeclineCall, showSettings])

  const press = useCallback((key: string) => {
    if (incomingCall) {
      if (key === '5') { playPop(); onAcceptCall?.(incomingCall) }
      else if (key === '*') { playPop(); onDeclineCall?.(incomingCall) }
      else playPop()
      return
    }
    if (showSettings) {
      if (key === '2') {
        playPop()
        const idx = RINGTONES.findIndex(r => r.id === selectedRingtone)
        const prev = RINGTONES[(idx - 1 + RINGTONES.length) % RINGTONES.length]
        setSelectedRingtone(prev.id)
        previewRingtone(prev.id)
      } else if (key === '8') {
        playPop()
        const idx = RINGTONES.findIndex(r => r.id === selectedRingtone)
        const next = RINGTONES[(idx + 1) % RINGTONES.length]
        setSelectedRingtone(next.id)
        previewRingtone(next.id)
      } else if (key === '5') {
        playPop()
        setRingtone(selectedRingtone)
        setShowSettings(false)
      } else if (key === '*') {
        back()
      } else {
        playPop()
      }
      return
    }
    if (liveCall?.phase === 'connected') {
      if (key === '5') { playPop(); hangupCall() }
      else if (key === '1') { playPop(); toggleMute() }
      else if (key === '*') { back() }
      else playPop()
      return
    }
    if (key === '2') step(-1)
    else if (key === '8') step(1)
    else if (key === '5') select()
    else if (key === '#') { playPop(); setShowSettings(true) }
    else if (key === '*') back()
    else playPop()
  }, [back, incomingCall, liveCall?.phase, onAcceptCall, onDeclineCall, select, selectedRingtone, showSettings, step])

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

        <div className={themeRebooting ? `${styles.lcd} ${styles.lcdBlue}` : styles.lcd} aria-live="polite">
          <div className={styles.topline} aria-hidden="true">
            <span>▮▮▮ ⋮</span><span>▮▮</span>
          </div>

          {themeRebooting ? (
            <div className={styles.callStatus}>
              <strong>POPLUR</strong>
              <span className={styles.incoming}><strong>LOADING...</strong></span>
            </div>
          ) : incomingCall ? (
            <>
              <div className={`${styles.callStatus} ${styles.incoming}`}>
                <strong>INCOMING</strong>
                <span>{incomingCall.callerName.replace(/^@/, '').toUpperCase()}</span>
              </div>
              <div className={styles.softkeys}>5 ACCEPT&nbsp;&nbsp;* DECLINE</div>
            </>
          ) : liveCall?.phase === 'connected' ? (
            <>
              <div className={styles.callStatus}>
                <strong>ON CALL</strong>
                <span>{(liveCall.peerName || 'CONTACT').replace(/^@/, '').toUpperCase()}</span>
                <span className={styles.callTimer}>
                  {(() => {
                    const ms = callNow - (liveCall.connectedAt ?? callNow)
                    const total = Math.max(0, Math.floor(ms / 1000))
                    const m = Math.floor(total / 60)
                    const s = total % 60
                    return `${m}:${s.toString().padStart(2, '0')}`
                  })()}
                </span>
                <span>{liveCall.muted ? '(MUTED)' : ''}</span>
              </div>
              <div className={styles.softkeys}>1 MUTE&nbsp;&nbsp;5 END&nbsp;&nbsp;* BACK</div>
            </>
          ) : calling ? (
            <>
              <div className={`${styles.callStatus} ${styles.callRinging}`}>
                <strong>CALLING</strong>
                <span>{calling.handle.replace(/^@/, '').toUpperCase()}</span>
                <span>
                  {calling.favourite ? 'FAVOURITE' : calling.detail.toUpperCase()}
                </span>
              </div>
              <div className={styles.softkeys}>5 HANG UP&nbsp;&nbsp;* BACK</div>
            </>
          ) : showSettings ? (
            <>
              <div className={styles.titleRow}>
                <strong>RINGTONE</strong>
              </div>
              <div className={styles.list}>
                {RINGTONES.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className={r.id === selectedRingtone ? `${styles.row} ${styles.rowOn}` : styles.row}
                    onClick={() => { setSelectedRingtone(r.id); previewRingtone(r.id) }}
                    aria-label={r.name}
                  >
                    <b className={styles.rowGlyph}>{r.id === getRingtone() ? '★' : '·'}</b>
                    <span className={styles.rowText}>
                      <strong className={styles.rowTitle}>{r.name}</strong>
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.softkeys}>2/8 SCROLL  5 SET  * BACK</div>
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
                      aria-label={`${contact.handle}, ${contact.detail}`}
                    >
                      <b className={styles.rowGlyph}>{contact.favourite ? '★' : contact.callable ? '→' : '·'}</b>
                      <span className={styles.rowText}>
                        <strong className={styles.rowTitle}>{contact.handle.replace(/^@/, '').toUpperCase()}</strong>
                        <em className={styles.rowDetail}>
                          {contact.detail.toUpperCase()}
                        </em>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className={styles.softkeys}>
                {current?.callable ? '2/8 SCROLL  5 CALL  # SET  * BACK' : '2/8 SCROLL  # SET  * BACK'}
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

        <div className={`${styles.swipe} ${styles.swipeLeft}`}>
          <ClayChannelArrows
            number={0}
            onUp={() => cycleColorway(-1)}
            onDown={() => {}}
            upLabel="Previous phone colorway"
            downLabel=""
            size={88}
            orientation="horizontal"
            single="up"
          />
        </div>
        <div className={`${styles.swipe} ${styles.swipeRight}`}>
          <ClayChannelArrows
            number={0}
            onUp={() => {}}
            onDown={() => cycleColorway(1)}
            upLabel=""
            downLabel="Next phone colorway"
            size={88}
            orientation="horizontal"
            single="down"
          />
        </div>
      </div>
    </div>
  )
}
