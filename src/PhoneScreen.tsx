import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import styles from './PhoneScreen.module.css'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { packBase } from './assetPacks'
import { playPop } from './pop'
import { PROFILE_THEME_CHANGE_EVENT } from './profileThemes'
import { postNativeEvent } from './nativeBridge'
import { placeCall, hangup as hangupCall, subscribeCall, toggleMute, type CallSnapshot } from './webCall'
import { startRingtone, stopRingtone, previewRingtone, getRingtone, setRingtone, onRingtoneChange, RINGTONES, type RingtoneId } from './phoneRingtones'
import ClayChannelArrows from './ClayChannelArrows'
import { cyclePhoneTheme, phoneThemeForId, readSelectedPhoneTheme, saveSelectedPhoneTheme } from './phoneThemes'
import {
  INITIAL_DM_PHONE_RETURN_STATE,
  advanceDMPhoneReturn,
  resolveDMAutoCallPeer,
  type DMPhoneReturnState,
} from './dmCallNavigation'
import { accountSnapshot, onAccountChange } from './accountStore'
import { useNearbyLocation } from './nearbyLocation'
import { nativeFeedPostsSnapshot, onNativeFeedPosts } from './nativeFeedPosts'
import { contactsFromRealtimePosts } from './webContacts'

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

/** Left%, top%, width%, height% in the 1024x1536 handset artwork. The device
 *  now keeps that 2:3 ratio, so hit zones and the LCD stay registered at every
 *  shell size. */
const KEYS: Array<[key: string, left: number, top: number, w: number, h: number]> = [
  ['1', 20.5, 62.2, 17.0, 6.0], ['2', 41.5, 62.2, 17.0, 6.0], ['3', 62.5, 62.2, 17.0, 6.0],
  ['4', 20.5, 69.4, 17.0, 6.0], ['5', 41.5, 69.4, 17.0, 6.0], ['6', 62.5, 69.4, 17.0, 6.0],
  ['7', 20.5, 76.7, 17.0, 6.0], ['8', 41.5, 76.7, 17.0, 6.0], ['9', 62.5, 76.7, 17.0, 6.0],
  ['*', 20.5, 84.0, 17.0, 6.0], ['0', 41.5, 84.0, 17.0, 6.0], ['#', 62.5, 84.0, 17.0, 6.0],
  // The centre of the navigation cluster, above the keypad — select.
  ['5', 39.5, 50.9, 21.0, 7.0],
]

interface Contact {
  id: string
  handle: string
  detail: string
  favourite: boolean
  callable: boolean
  distanceKm: number | null
}

type PhoneMenuPage = 'main' | 'contacts' | 'calls' | 'messages' | 'camera' | 'gallery' | 'radio' | 'games' | 'settings' | 'about'

const PHONE_MENU_ITEMS: Array<{ id: Exclude<PhoneMenuPage, 'main'> | 'exit'; title: string; detail: string; glyph: string }> = [
  { id: 'messages', title: 'Messages', detail: 'Poplur Mail inbox', glyph: '01' },
  { id: 'contacts', title: 'Contacts', detail: 'people in your radius', glyph: '02' },
  { id: 'calls', title: 'Call log', detail: 'recent and missed calls', glyph: '03' },
  { id: 'camera', title: 'Camera', detail: 'capture a new pop', glyph: '04' },
  { id: 'gallery', title: 'Gallery', detail: 'your saved pops', glyph: '05' },
  { id: 'radio', title: 'Radio', detail: 'live Poplur channels', glyph: '06' },
  { id: 'games', title: 'Games', detail: 'Snake and extras', glyph: '07' },
  { id: 'settings', title: 'Settings', detail: 'ringtone and display', glyph: '08' },
  { id: 'about', title: 'About Poplur', detail: 'phone information', glyph: '09' },
  { id: 'exit', title: 'Exit', detail: 'close phone', glyph: '00' },
]

function km(value: number): string {
  return value >= 100 ? `${Math.round(value)}KM` : `${value.toFixed(1)}KM`
}

export interface IncomingCall {
  callId: string
  callerId: string
  callerName: string
}

export default function PhoneScreen({
  onClose,
  incomingCall,
  onAcceptCall,
  onDeclineCall,
  autoCall,
  bindBack,
  onDMCallReturn,
}: {
  /** `navigationSoundOwned` is true when Home's persistent cube will play the
      close pop after this synchronous back handler returns. */
  onClose?: (navigationSoundOwned?: boolean) => void
  incomingCall?: IncomingCall | null
  onAcceptCall?: (call: IncomingCall) => void
  onDeclineCall?: (call: IncomingCall) => void
  autoCall?: { id: string; name: string } | null
  /** Lets Home's persistent cube operate the Phone's own back key. */
  bindBack?: (fn: (() => boolean) | null) => void
  /** Only supplied when this Phone instance was opened from one exact DM. */
  onDMCallReturn?: (navigationSoundOwned?: boolean) => void
}) {
  const [reachKm, setReachKm] = useState(() => radiusKm())
  const [ownUid, setOwnUid] = useState(() => accountSnapshot().uid)
  const location = useNearbyLocation()
  const livePosts = useSyncExternalStore(
    onNativeFeedPosts,
    nativeFeedPostsSnapshot,
    nativeFeedPostsSnapshot,
  )
  const contacts = useMemo<Contact[]>(() => {
    if (location?.source !== 'device') return []
    return contactsFromRealtimePosts(livePosts, ownUid, location, reachKm).map(contact => ({
      ...contact,
      favourite: false,
    }))
  }, [livePosts, location, ownUid, reachKm])
  const [index, setIndex] = useState(0)
  const [phoneThemeId, setPhoneThemeId] = useState(() => readSelectedPhoneTheme().id)
  const phoneThemeIdRef = useRef(phoneThemeId)
  const [calling, setCalling] = useState<Contact | null>(null)
  const [booting, setBooting] = useState(true)
  const [bootFrame, setBootFrame] = useState(0)
  const [themeRebooting, setThemeRebooting] = useState(false)
  const [themeChangeLabel, setThemeChangeLabel] = useState('CHANGED')
  const [menuPage, setMenuPage] = useState<PhoneMenuPage>('main')
  const [menuIndex, setMenuIndex] = useState(0)
  const [liveCall, setLiveCall] = useState<CallSnapshot | null>(null)
  const [callNow, setCallNow] = useState(() => Date.now())
  const [selectedRingtone, setSelectedRingtone] = useState<RingtoneId>(() => getRingtone())

  // The Settings screen sets the same ringtone, so a change made there has to
  // land here too — the ★ below reads getRingtone() inline, which React has no
  // reason to re-run on its own, and the cursor would otherwise sit on whatever
  // was chosen the last time this screen was opened. Moving the cursor with it
  // means opening the handset's list always starts on the tone actually in use,
  // wherever it was picked.
  useEffect(() => onRingtoneChange(() => setSelectedRingtone(getRingtone())), [])
  const bootTimer = useRef<number | null>(null)
  const themeTimer = useRef<number | null>(null)
  const autoCallRef = useRef(autoCall)
  autoCallRef.current = autoCall
  const onDMCallReturnRef = useRef(onDMCallReturn)
  onDMCallReturnRef.current = onDMCallReturn
  const dmReturnNavigationSoundRef = useRef(false)
  const dmReturnStateRef = useRef<DMPhoneReturnState>(INITIAL_DM_PHONE_RETURN_STATE)
  useEffect(() => {
    dmReturnNavigationSoundRef.current = false
  }, [autoCall?.id])

  useEffect(() => {
    const sync = () => setReachKm(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  useEffect(() => onAccountChange(account => setOwnUid(account.uid)), [])

  useEffect(() => {
    const onCallEnd = (event: MessageEvent) => {
      if (event.data?.type === 'poplurCallEnded') setCalling(null)
    }
    window.addEventListener('message', onCallEnd)
    return () => window.removeEventListener('message', onCallEnd)
  }, [])

  // Wake sequence: 16 frames of the colourway's own spritesheet, one every
  // 112ms — about 1.8s, the same beat the map iPod boots to. Theme changes use
  // their own shorter blue LCD transition so the new theme is unmistakable.
  const runBoot = useCallback((withEffects = true) => {
    if (bootTimer.current !== null) window.clearInterval(bootTimer.current)
    // The boot buzz, which never fired on device. Native already implements it
    // — WebHomeCameraLayer's `phoneBootEffects` runs a six-beat impact sequence
    // and pulses the torch — and the only thing missing was anybody sending the
    // event. HomeTwin does relay it, but only from a `postMessage`, which was
    // right when the handset was an IFRAME and became dead code the moment it
    // became this in-document React screen: nothing has posted that message
    // since. Post it from the boot itself, where the boot actually happens.
    //
    // `navigator.vibrate` is NOT a substitute and never was: pop.ts says so
    // outright ("iOS Safari ignores this, hence the native bridge"), so on the
    // phone the existing call was always a no-op pretending to be a haptic.
    // Kept only for Android/Chrome, where it is the real thing.
    if (withEffects) {
      try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
      postNativeEvent({ type: 'phoneBootEffects' })
    }
    setBooting(true)
    setBootFrame(0)
    let frame = 0
    bootTimer.current = window.setInterval(() => {
      frame += 1
      if (frame >= BOOT_FRAMES) {
        if (bootTimer.current !== null) window.clearInterval(bootTimer.current)
        bootTimer.current = null
        setBooting(false)
        setMenuPage('main')
        setMenuIndex(0)
        return
      }
      setBootFrame(frame)
    }, BOOT_FRAME_MS)
  }, [])

  const showThemeChange = useCallback((label = 'CHANGED') => {
    if (bootTimer.current !== null) window.clearInterval(bootTimer.current)
    bootTimer.current = null
    if (themeTimer.current !== null) window.clearTimeout(themeTimer.current)
    setBooting(false)
    setThemeChangeLabel(label)
    setThemeRebooting(true)
    themeTimer.current = window.setTimeout(() => {
      themeTimer.current = null
      setThemeRebooting(false)
    }, 1280)
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
      // Theme, not cold boot: same haptic sequence natively but no boot sound.
      postNativeEvent({ type: 'phoneThemeEffects' })
      showThemeChange('CHANGED')
    }
    window.addEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PROFILE_THEME_CHANGE_EVENT, sync)
  }, [showThemeChange])

  useEffect(() => () => {
    if (themeTimer.current !== null) window.clearTimeout(themeTimer.current)
  }, [])

  useEffect(() => subscribeCall(snap => {
    setLiveCall(snap.phase === 'idle' ? null : snap)
    if (snap.phase === 'idle' || snap.phase === 'ended') setCalling(null)

    // A Phone opened from Mail is a temporary call mode, not a navigation
    // away from the conversation. Wait until its call genuinely begins, then
    // return exactly once when either side ends it. The initial idle snapshot
    // emitted by subscribeCall must never bounce the person straight back.
    if (!autoCallRef.current) return
    const transition = advanceDMPhoneReturn(dmReturnStateRef.current, snap.phase)
    dmReturnStateRef.current = transition.state
    if (transition.shouldReturn) {
      const navigationSoundOwned = dmReturnNavigationSoundRef.current
      dmReturnNavigationSoundRef.current = false
      onDMCallReturnRef.current?.(navigationSoundOwned)
    }
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
    if (!autoCall || autoCallDone.current || booting) return
    autoCallDone.current = true
    const peer = resolveDMAutoCallPeer(autoCall, contacts)
    const target = peer.contactIndex >= 0 ? contacts[peer.contactIndex] : null
    if (target) {
      setIndex(peer.contactIndex)
      setCalling(target)
      void placeCall(peer.id, peer.handle)
    } else {
      const synth: Contact = { id: peer.id, handle: peer.handle, detail: 'POPLUR MAIL', favourite: false, callable: true, distanceKm: null }
      setCalling(synth)
      void placeCall(peer.id, peer.handle)
    }
  }, [autoCall, booting, contacts])

  // Changing the handset's colourway IS changing its theme, so it buzzes the
  // same way an app-theme change does — the vibration that went missing when
  // this became the live phone. Native haptics ride the same phoneThemeEffects
  // event the theme-change effect uses; navigator.vibrate covers the web. The
  // surrounding clay arrow owns the tap's single audible pop.
  const cycleColorway = useCallback((delta: 1 | -1) => {
    try { navigator.vibrate?.([52, 34, 52, 34, 82]) } catch { /* unsupported */ }
    postNativeEvent({ type: 'phoneThemeEffects' })
    const next = cyclePhoneTheme(phoneThemeIdRef.current, delta)
    phoneThemeIdRef.current = next.id
    saveSelectedPhoneTheme(next.id)
    postNativeEvent({ type: 'phoneThemeChanged', themeId: next.id })
    setPhoneThemeId(next.id)
    showThemeChange(next.name.toUpperCase())
  }, [showThemeChange])

  const step = useCallback((delta: 1 | -1) => {
    playPop()
    if (!contacts.length) return
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

  const back = useCallback((withSound = true) => {
    const closesPhone = !liveCall || liveCall.phase === 'idle' || liveCall.phase === 'ended'
      ? !calling && !incomingCall && menuPage === 'main'
      : false
    if (closesPhone) {
      // A visible Phone control delegates the one pop to HoldMenu. A persistent
      // cube back already has its pop waiting in Home, so only mark ownership.
      onClose?.(!withSound)
      return
    }
    if (incomingCall) {
      // Home owns both the sound and ringing-cube transition for a decline.
      onDeclineCall?.(incomingCall)
      return
    }
    if (withSound) playPop()
    if (liveCall && liveCall.phase !== 'idle' && liveCall.phase !== 'ended') {
      dmReturnNavigationSoundRef.current = true
      hangupCall()
      setCalling(null)
      return
    }
    if (calling) {
      dmReturnNavigationSoundRef.current = true
      hangupCall()
      setCalling(null)
      return
    }
    if (menuPage !== 'main') {
      setMenuPage('main')
      setMenuIndex(0)
      return
    }
  }, [calling, incomingCall, liveCall, menuPage, onClose, onDeclineCall])

  useEffect(() => {
    if (!bindBack) return
    // Home plays the cube pop after a native back handler reports success, so
    // do not play a second copy inside Phone's keypad handler.
    bindBack(() => { back(false); return true })
    return () => bindBack(null)
  }, [back, bindBack])

  const activateMenuItem = useCallback(() => {
    const item = PHONE_MENU_ITEMS[menuIndex]
    if (!item) return
    if (item.id === 'exit') {
      onClose?.(false)
      return
    }
    playPop()
    setMenuPage(item.id)
    setMenuIndex(0)
  }, [menuIndex, onClose])

  const press = useCallback((key: string) => {
    if (incomingCall) {
      // Home owns accept/decline and the ringing-cube handoff. Playing here as
      // well made keypad 5/* emit once in Phone and once again in Home.
      if (key === '5') onAcceptCall?.(incomingCall)
      else if (key === '*') onDeclineCall?.(incomingCall)
      else playPop()
      return
    }
    if (menuPage === 'settings') {
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
        setMenuPage('main')
        setMenuIndex(0)
      } else if (key === '*') {
        back()
      } else {
        playPop()
      }
      return
    }
    if (liveCall?.phase === 'connected') {
      if (key === '5') {
        playPop()
        dmReturnNavigationSoundRef.current = true
        hangupCall()
      }
      else if (key === '1') { playPop(); toggleMute() }
      else if (key === '*') { back() }
      else playPop()
      return
    }
    if (liveCall?.phase === 'calling' || liveCall?.phase === 'connecting') {
      if (key === '5') {
        playPop()
        dmReturnNavigationSoundRef.current = true
        hangupCall()
        setCalling(null)
      }
      else if (key === '*') back()
      else playPop()
      return
    }
    if (menuPage === 'main') {
      if (key === '2') {
        playPop()
        setMenuIndex(i => (i - 1 + PHONE_MENU_ITEMS.length) % PHONE_MENU_ITEMS.length)
      } else if (key === '8') {
        playPop()
        setMenuIndex(i => (i + 1) % PHONE_MENU_ITEMS.length)
      } else if (key === '5' || key === '#') {
        activateMenuItem()
      } else if (key === '*') back()
      else playPop()
      return
    }
    if (menuPage === 'contacts' || menuPage === 'calls') {
      if (key === '2') step(-1)
      else if (key === '8') step(1)
      else if (key === '5') select()
      else if (key === '#') { playPop(); setMenuPage('main'); setMenuIndex(0) }
      else if (key === '*') back()
      else playPop()
      return
    }
    if (key === '*') back()
    else if (key === '5' || key === '#') playPop()
    else playPop()
  }, [activateMenuItem, back, incomingCall, liveCall?.phase, menuPage, onAcceptCall, onDeclineCall, select, selectedRingtone, step])

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
  const start = Math.max(0, Math.min(index, Math.max(0, contacts.length - 2)))
  const visible = contacts.slice(start, start + 2)
  const phoneTheme = phoneThemeForId(phoneThemeId)
  const mainStart = Math.max(0, Math.min(menuIndex - 1, Math.max(0, PHONE_MENU_ITEMS.length - 3)))
  const visibleMain = PHONE_MENU_ITEMS.slice(mainStart, mainStart + 3)
  const infoPage = menuPage !== 'main' && menuPage !== 'contacts' && menuPage !== 'calls' && menuPage !== 'settings'
  const pageTitle = menuPage === 'messages' ? 'MESSAGES'
    : menuPage === 'camera' ? 'CAMERA'
      : menuPage === 'gallery' ? 'GALLERY'
        : menuPage === 'radio' ? 'RADIO'
          : menuPage === 'games' ? 'GAMES'
            : menuPage === 'about' ? 'ABOUT POPLUR'
              : ''

  return (
    <div
      className={styles.screen}
      data-poplur-screen="profile-phone"
      data-phone-theme={phoneTheme.id}
      aria-label={`Poplur phone, ${phoneTheme.name}`}
    >
      <div className={booting ? `${styles.device} ${styles.deviceBooting}` : styles.device}>
        <img className={styles.rest} src={restUrl(phoneTheme.assetSet)} alt={`Poplur phone, ${phoneTheme.name}`} draggable={false} />

        {booting && (
          <div
            className={styles.boot}
            aria-hidden="true"
            style={{
              backgroundImage: `url(${bootUrl(phoneTheme.assetSet)})`,
              backgroundPosition: `${(bootFrame % 4) / 3 * 100}% ${Math.floor(bootFrame / 4) / 3 * 100}%`,
            }}
          />
        )}

        <div className={themeRebooting ? `${styles.lcd} ${styles.lcdBlue}` : styles.lcd} aria-live="polite">
          <div className={styles.topline} aria-hidden="true">
            <span>PT&amp;T WIRELESS</span><span>▮▮▮</span>
          </div>

          {themeRebooting ? (
            <div className={styles.callStatus}>
              <strong>THEME</strong>
              <span className={styles.incoming}><strong>{themeChangeLabel}</strong></span>
              <span>APPLIED</span>
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
          ) : menuPage === 'settings' ? (
            <>
              <div className={styles.titleRow}>
                <strong>RINGTONE</strong>
              </div>
              <div className={styles.list}>
                {(() => {
                  const selIdx = RINGTONES.findIndex(r => r.id === selectedRingtone)
                  const rStart = Math.max(0, Math.min(selIdx, RINGTONES.length - 3))
                  return RINGTONES.slice(rStart, rStart + 3).map(r => (
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
                  ))
                })()}
              </div>
              <div className={styles.softkeys}>2/8 SCROLL  5 SET  * BACK</div>
            </>
          ) : menuPage === 'main' ? (
            <>
              <div className={styles.titleRow}>
                <strong>POPLUR MENU</strong>
                <em>{menuIndex + 1}/{PHONE_MENU_ITEMS.length}</em>
              </div>
              <div className={styles.list}>
                {visibleMain.map((item, offset) => {
                  const at = mainStart + offset
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={at === menuIndex ? `${styles.row} ${styles.rowOn}` : styles.row}
                      onClick={() => { setMenuIndex(at); if (at === menuIndex) activateMenuItem() }}
                      aria-label={`Open ${item.title}`}
                    >
                      <b className={styles.rowGlyph}>{item.glyph}</b>
                      <span className={styles.rowText}>
                        <strong className={styles.rowTitle}>{item.title.toUpperCase()}</strong>
                        <em className={styles.rowDetail}>{item.detail.toUpperCase()}</em>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className={styles.softkeys}>2/8 SCROLL  5 OPEN  * EXIT</div>
            </>
          ) : menuPage === 'contacts' || menuPage === 'calls' ? (
            <>
              <div className={styles.titleRow}>
                <strong>{menuPage === 'calls' ? 'CALL LOG' : `CONTACTS ${km(reachKm)}`}</strong>
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
                {current?.callable ? '2/8 SCROLL  5 CALL  # MENU  * BACK' : '2/8 SCROLL  # MENU  * BACK'}
              </div>
            </>
          ) : infoPage ? (
            <>
              <div className={styles.titleRow}><strong>{pageTitle}</strong><em>1/1</em></div>
              <div className={styles.callStatus}>
                <strong>{menuPage === 'games' ? 'SNAKE READY' : 'POPLUR'}</strong>
                <span>{menuPage === 'messages' ? 'OPEN MAIL FROM PROFILE' : menuPage === 'camera' ? 'USE THE CAMERA TAB TO CAPTURE' : menuPage === 'gallery' ? 'YOUR SAVED POPS LIVE HERE' : menuPage === 'radio' ? 'LIVE CHANNELS ON THE MAP' : menuPage === 'about' ? 'POPLUR PHONE 1.0' : 'COMING SOON'}</span>
              </div>
              <div className={styles.softkeys}>5 OK  * BACK</div>
            </>
          ) : null}
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
  )
}
