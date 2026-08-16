import React, { useEffect, useState } from 'react'
import styles from './SettingsScreen.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import {
  readCameraAiVoice,
  readCameraDetectDefault,
  writeCameraAiVoice,
  writeCameraDetectDefault,
} from './cameraPreferences'
import {
  WORLD_RADIUS_HOURS,
  formatRemaining,
  grantWorldRadius,
  isWorldRadiusActive,
  onReferralChange,
  referralCode,
  referralLink,
  worldRadiusRemainingMs,
} from './referral'
import { readRadioScope, setRadioScope, type RadioScope } from './mapRadio'
import { readControlSide, setControlSide, type ControlSide } from './controlPlacement'
import {
  PROFILE_THEMES,
  onProfileThemeChange,
  readSelectedProfileTheme,
  selectProfileTheme,
  type ProfileTheme,
} from './profileThemes'

// Settings, and the one thing in it that is a feature rather than a switch:
// REFER A FRIEND. Radius is earned slowly and decays; a referral hands you the
// entire planet for a day, which is the only place in the app where reach is
// given outright. See referral.ts for the mechanic and the live-service wire.

// Settings is an index of screens, not one long control panel: the root is a
// list, and each row opens the screen that owns those controls. It grew past a
// single page once Camera, Radio and Controls all landed in it, and a flat page
// put the last rows under the home chrome where they could not be tapped.
// One row per page of the app, so a setting is looked up where you met it:
// what the camera says lives under Camera, how far the station follows you
// lives under Radio. Pages with nothing to set yet still get a row — a gap in
// the list would read as "this page has no settings screen", which is a
// different claim from "there is nothing to set here yet".
type Page = 'home' | 'map' | 'feed' | 'camera' | 'radio' | 'profile'

const PAGE_TITLE: Record<Page, string> = {
  home: 'HOME',
  map: 'MAP',
  feed: 'FEED',
  camera: 'CAMERA',
  radio: 'RADIO',
  profile: 'PROFILE',
}

const RADIO_LABEL: Record<RadioScope, string> = {
  screen: 'Radio screen',
  app: 'Across Poplur',
  outside: 'Outside app',
}

const SIDE_LABEL: Record<ControlSide, string> = {
  left: 'Left side',
  right: 'Right side',
}

// No onClose prop: with DONE gone, the cube is the only way out of this screen,
// and the cube is the shell's own handler — nothing here needs to call it.
export default function SettingsScreen() {
  const code = referralCode()
  const link = referralLink(code)
  const [active, setActive] = useState(isWorldRadiusActive)
  const [remaining, setRemaining] = useState(worldRadiusRemainingMs)
  const [note, setNote] = useState<string | null>(null)
  // Latched so a second tap cannot fire a second signOut while the shell is
  // already tearing the session down and swapping surfaces.
  const [signingOut, setSigningOut] = useState(false)
  // Camera switches. Read once on open — nothing else writes them while this
  // screen is up, and re-reading storage on every render would be a lie about
  // where the truth lives.
  const [aiVoice, setAiVoice] = useState(readCameraAiVoice)
  const [detectDefault, setDetectDefault] = useState(readCameraDetectDefault)
  const [radioScope, setRadioScopeState] = useState<RadioScope>(readRadioScope)
  const [controlSide, setControlSideState] = useState<ControlSide>(readControlSide)
  const [profileTheme, setProfileThemeState] = useState<ProfileTheme>(readSelectedProfileTheme)
  // null is the root list. The cube still closes Settings outright, so this only
  // ever has to walk back one level.
  const [page, setPage] = useState<Page | null>(null)

  // The native side owns both behaviours — CameraAIAnnouncer does the talking
  // and the capture session decides what runs at start — so a switch here has
  // to reach across the bridge, not just into localStorage.
  const setVoice = (on: boolean) => {
    playPop()
    setAiVoice(writeCameraAiVoice(on))
    postNativeEvent({ type: 'cameraAiVoice', enabled: on })
  }
  const setDetect = (on: boolean) => {
    playPop()
    setDetectDefault(writeCameraDetectDefault(on))
    postNativeEvent({ type: 'cameraDetectDefault', enabled: on })
  }
  const chooseRadioScope = (scope: RadioScope) => {
    playPop()
    setRadioScope(scope)
    setRadioScopeState(scope)
    postNativeEvent({ type: 'radioScope', scope })
    if (window.parent !== window) window.parent.postMessage({ poplurRadioScope: scope }, '*')
  }
  const chooseControlSide = (side: ControlSide) => {
    playPop()
    setControlSideState(setControlSide(side))
  }
  const chooseProfileTheme = (theme: ProfileTheme) => {
    playPop()
    setProfileThemeState(selectProfileTheme(theme.id))
    say(`${theme.displayName} profile applied.`)
  }

  const openPage = (next: Page) => { playPop(); setPage(next) }
  const backToList = () => { playPop(); setPage(null) }

  // The countdown, and only while this screen is open. Half a minute is fine
  // for a readout in hours and minutes — a per-second tick would be a timer
  // running under an idle screen for the sake of a digit nobody is watching,
  // which is exactly what the thermal budget exists to stop.
  useEffect(() => {
    const sync = () => { setActive(isWorldRadiusActive()); setRemaining(worldRadiusRemainingMs()) }
    sync()
    const off = onReferralChange(sync)
    const timer = window.setInterval(sync, 30_000)
    return () => { off(); window.clearInterval(timer) }
  }, [])

  useEffect(() => onProfileThemeChange(setProfileThemeState), [])

  const say = (message: string) => {
    setNote(message)
    window.setTimeout(() => setNote(current => (current === message ? null : current)), 3_200)
  }

  /**
   * Send the invitation. The OS sheet where there is one, the app's own share
   * where the shell owns it, the clipboard where there is neither.
   *
   * The grant lands on ACCEPTANCE, not on sending — an invite shouted into the
   * void must not pay. With no referral service yet, a completed share is
   * treated as the acceptance; that single line is what the live service takes
   * over (referral.ts, `poplur-referral-accepted`).
   */
  const invite = async () => {
    playPop()
    const payload = {
      title: 'Poplur',
      text: `Join me on Poplur — use my code ${code} and we both get the whole map.`,
      url: link,
    }
    let sent = false
    try {
      if (isNativeShell()) {
        postNativeEvent({ type: 'shareReferral', code, link })
        sent = true
      } else if (navigator.share) {
        await navigator.share(payload)
        sent = true
      } else {
        await navigator.clipboard?.writeText(link)
        sent = true
        say('Invite link copied.')
      }
    } catch {
      // A cancelled share sheet is not a failure and must not pay out.
      return
    }
    if (!sent) return
    const until = grantWorldRadius()
    setActive(true)
    setRemaining(until - Date.now())
    say(`Worldwide radius on for ${WORLD_RADIUS_HOURS} hours.`)
  }

  const copyCode = async () => {
    playPop()
    try {
      await navigator.clipboard.writeText(code)
      say('Code copied.')
    } catch {
      say(code)
    }
  }

  return (
    <section className={styles.screen} aria-label="Settings" data-clay-scroll>
      <div className={styles.body}>
        {page === null && (
          <>
            <div className={styles.list}>
              <button type="button" className={styles.row} onClick={() => openPage('home')}>
                <span className={styles.rowText}>
                  <b>Home</b>
                  <i>Which thumb the action rails sit under.</i>
                </span>
                <span className={styles.rowValue}>{SIDE_LABEL[controlSide]}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('map')}>
                <span className={styles.rowText}>
                  <b>Map</b>
                  <i>Your radius, and what the map narrates.</i>
                </span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('feed')}>
                <span className={styles.rowText}>
                  <b>Feed</b>
                  <i>Captions, comments and what autoplays.</i>
                </span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('camera')}>
                <span className={styles.rowText}>
                  <b>Camera</b>
                  <i>What the lens says and when it looks.</i>
                </span>
                <span className={styles.rowValue}>{aiVoice ? 'Voice on' : 'Voice off'}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('radio')}>
                <span className={styles.rowText}>
                  <b>Radio</b>
                  <i>How far the station follows you.</i>
                </span>
                <span className={styles.rowValue}>{RADIO_LABEL[radioScope]}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('profile')}>
                <span className={styles.rowText}>
                  <b>Profile</b>
                  <i>Your account and this session on this device.</i>
                </span>
                <span className={styles.rowValue}>{profileTheme.displayName}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>
            </div>
            {/* No DONE: every control here commits the moment you touch it, so
                there is nothing to confirm. The cube closes the screen. */}
          </>
        )}

        {page !== null && (
          <div className={styles.navBar}>
            <button type="button" className={styles.back} onClick={backToList}>
              <span aria-hidden="true">‹</span> SETTINGS
            </button>
            <h2 className={styles.pageTitle}>{PAGE_TITLE[page]}</h2>
          </div>
        )}

        {/* Map and Feed have a screen but no switches yet: both pages still take
            their choices from their own hold menus (radius, narration, captions,
            comments). The screen says so rather than the list hiding the page. */}
        {(page === 'map' || page === 'feed') && (
          <article className={styles.group}>
            <p className={styles.empty}>
              {page === 'map'
                ? 'Radius and map narration are still set from the map’s own hold menu. Nothing to change here yet.'
                : 'Captions and comments are still set from the feed’s own hold menu. Nothing to change here yet.'}
            </p>
          </article>
        )}

        {/* The referral sits where DONE used to, at the foot of the index: it is
            the one thing here you DO rather than set, and it is worth meeting
            without opening a page first. Nothing names it up here, so the card
            carries its own title. */}
        {page === null && (
        <article className={active ? `${styles.refer} ${styles.referOn}` : styles.refer}>
          <div className={styles.referTop}>
            <span className={styles.referKicker}>REFER A FRIEND</span>
            <span className={styles.referPrize}>
              {active ? `${formatRemaining(remaining)} LEFT` : `${WORLD_RADIUS_HOURS}H WORLDWIDE`}
            </span>
          </div>

          <p className={styles.referLine}>
            {active
              ? 'Your radius covers the whole world right now. Refer another friend to add a day.'
              : 'Bring someone in and your radius covers the entire world for 24 hours.'}
          </p>

          <button type="button" className={styles.code} onClick={copyCode} aria-label={`Copy your code, ${code.split('').join(' ')}`}>
            <span className={styles.codeLabel}>YOUR CODE</span>
            <span className={styles.codeValue}>{code}</span>
            <span className={styles.codeHint}>tap to copy</span>
          </button>

          <button type="button" className={styles.invite} onClick={() => { void invite() }}>
            INVITE A FRIEND
          </button>

          {/* The globe fills as the day runs down — the reward, made visible. */}
          <div
            className={styles.meter}
            role="img"
            aria-label={active ? `Worldwide radius, ${formatRemaining(remaining)} remaining` : 'Worldwide radius inactive'}
          >
            <i style={{ width: active ? `${Math.max(2, Math.min(100, (remaining / (WORLD_RADIUS_HOURS * 3_600_000)) * 100))}%` : '0%' }} />
          </div>
        </article>
        )}

        {page === 'camera' && (
        <article className={styles.group} aria-label="Camera">
          <button
            type="button"
            className={styles.switchRow}
            role="switch"
            aria-checked={aiVoice}
            onClick={() => setVoice(!aiVoice)}
          >
            <span className={styles.switchText}>
              <b>AI voice</b>
              <i>Poplur says what it sees through the lens.</i>
            </span>
            <span className={aiVoice ? `${styles.switchTrack} ${styles.switchOn}` : styles.switchTrack}>
              <em />
            </span>
          </button>

          <button
            type="button"
            className={styles.switchRow}
            role="switch"
            aria-checked={detectDefault}
            onClick={() => setDetect(!detectDefault)}
          >
            <span className={styles.switchText}>
              <b>Detect on open</b>
              <i>Start scanning as soon as the camera opens.</i>
            </span>
            <span className={detectDefault ? `${styles.switchTrack} ${styles.switchOn}` : styles.switchTrack}>
              <em />
            </span>
          </button>
        </article>
        )}

        {page === 'radio' && (
        <article className={styles.group} aria-label="Radio playback">
          <div className={styles.radioScope} role="radiogroup" aria-label="Where radio keeps playing">
            {(Object.entries(RADIO_LABEL) as Array<[RadioScope, string]>).map(([scope, label]) => (
              <button
                type="button"
                key={scope}
                role="radio"
                aria-checked={radioScope === scope}
                className={radioScope === scope ? styles.radioScopeOn : undefined}
                onClick={() => chooseRadioScope(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={styles.radioScopeNote}>
            {radioScope === 'screen' && 'Stops when you leave the Radio screen.'}
            {radioScope === 'app' && 'Keeps playing while you browse Poplur.'}
            {radioScope === 'outside' && 'Keeps the station playing when Poplur is in the background.'}
          </p>
        </article>
        )}

        {page === 'home' && (
        <article className={styles.group} aria-label="Control position">
          <div className={styles.radioScope} role="radiogroup" aria-label="Side for camera and map controls">
            {(Object.entries(SIDE_LABEL) as Array<[ControlSide, string]>).map(([side, label]) => (
              <button
                type="button"
                key={side}
                role="radio"
                aria-checked={controlSide === side}
                className={controlSide === side ? styles.radioScopeOn : undefined}
                onClick={() => chooseControlSide(side)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={styles.radioScopeNote}>Moves the Camera and Map action rails to your preferred thumb side.</p>
        </article>
        )}

        {page === 'profile' && (
          <article className={styles.themeGroup} aria-label="Profile theme">
            <div className={styles.themeHeading}>
              <div>
                <b>Profile background</b>
                <span>Preview and apply instantly. Your posts stay untouched.</span>
              </div>
              <strong>{profileTheme.displayName}</strong>
            </div>
            <div className={styles.themeGrid} role="radiogroup" aria-label="Choose a profile background">
              {PROFILE_THEMES.map(theme => {
                const selected = profileTheme.id === theme.id
                return (
                  <button
                    type="button"
                    key={theme.id}
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${theme.displayName}${selected ? ', selected' : ''}`}
                    className={selected ? `${styles.themeTile} ${styles.themeTileSelected}` : styles.themeTile}
                    onClick={() => chooseProfileTheme(theme)}
                  >
                    <span
                      className={theme.thumbnailSrc ? styles.themePreview : `${styles.themePreview} ${styles.themePreviewDefault}`}
                      style={theme.thumbnailSrc ? { backgroundImage: `url("${theme.thumbnailSrc}")` } : undefined}
                      aria-hidden="true"
                    >
                      {selected && <i>✓</i>}
                    </span>
                    <span className={styles.themeName}>{theme.displayName}</span>
                  </button>
                )
              })}
            </div>
            <p className={styles.themeFootnote}>Stored on this device. Premium entitlement checks can be added without changing your saved theme ID.</p>
          </article>
        )}

        {note && <p className={styles.note} role="status">{note}</p>}

        {/* SIGN OUT — the app had no way out of a session at all.
            Phase 3 replaced native Home with this web surface, which left
            AppSettingsView (and the only sign-out button in the product)
            mounted under a ProfileView that no longer appears. The practical
            effect was that a signed-in build could never reach pre-login
            again without deleting the app, so nothing before login could be
            tested on a real device.
            Native shells only: in the plain browser preview there is no
            session to end, and a dead button is worse than no button. */}
        {page === 'profile' && isNativeShell() && (
          <article className={styles.card}>
            <button
              type="button"
              className={styles.invite}
              onClick={() => {
                if (signingOut) return
                setSigningOut(true)
                // The shell owns the session; it signs out of Firebase and
                // swaps back to the pre-login surface itself.
                const sent = postNativeEvent({ type: 'signOut' })
                if (!sent) setSigningOut(false)
              }}
            >
              {signingOut ? 'SIGNING OUT…' : 'SIGN OUT'}
            </button>
          </article>
        )}

      </div>
    </section>
  )
}
