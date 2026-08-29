import React, { useEffect, useRef, useState } from 'react'
import {
  cubeTransition, holdPreviewMode, screenTransition, setCubeTransition,
  setHoldPreviewMode, setScreenTransition,
  type CubeTransition, type HoldPreviewMode, type ScreenTransition,
} from './cubeTransitions'
import styles from './SettingsScreen.module.css'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import {
  RINGTONES, getRingtone, setRingtone, previewRingtone, onRingtoneChange,
  type RingtoneId,
} from './phoneRingtones'
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
import { grantReferralCredits, REFERRAL_CREDIT_REWARD } from './poplurCredits'
import { readRadioScope, setRadioScope, type RadioScope } from './mapRadio'
import { readControlSide, setControlSide, type ControlSide } from './controlPlacement'
import { readProfileGender, writeProfileGender, type ProfileGender } from './profileGender'
import {
  PROFILE_THEMES,
  onProfileThemeChange,
  readSelectedProfileTheme,
  selectProfileTheme,
  type ProfileTheme,
} from './profileThemes'
import {
  APP_ICONS,
  appIconById,
  readSelectedAppIcon,
  rememberSelectedAppIcon,
  type AppIconOption,
} from './appIcons'
import {
  VERIFICATION_CATEGORIES,
  readVerification,
  submitVerificationRequest,
  withdrawVerificationRequest,
  type VerificationCategoryID,
  type VerificationState,
  type VerificationStatus,
} from './profileVerification'
import {
  accountPrivacySnapshot,
  applyNativeAccountPrivacy,
  onAccountPrivacyChange,
  setAccountPrivacySaving,
  setLocalAccountPrivacy,
  type AccountPrivacySnapshot,
} from './accountPrivacy'
import {
  isTestActivityConsentEnabled,
  loadTestActivityConsent,
  onTestActivityConsentChange,
  setTestActivityConsent,
} from './testActivity'



// Settings, and the one thing in it that is a feature rather than a switch:
// REFER A FRIEND. Radius is earned slowly and decays; a referral hands you the
// entire planet for a day, which is the only place in the app where reach is
// given outright. See referral.ts for the mechanic and the live-service wire.

// Settings is an index of screens, not one long control panel: the root is a
// list, and each row opens the screen that owns those controls. It grew past a
// single page once Camera, Audio playback and Controls all landed in it, and a flat page
// put the last rows under the home chrome where they could not be tapped.
// One row per page of the app, so a setting is looked up where you met it:
// what the camera says lives under Camera, how far Radio and iPod follow you
// lives under Audio playback. Pages with nothing to set yet still get a row — a gap in
// the list would read as "this page has no settings screen", which is a
// different claim from "there is nothing to set here yet".
type Page = 'home' | 'map' | 'feed' | 'camera' | 'radio' | 'ringtone' | 'app' | 'privacy' | 'profile' | 'verify'

const PAGE_TITLE: Record<Page, string> = {
  home: 'HOME',
  map: 'MAP',
  feed: 'FEED',
  camera: 'CAMERA',
  radio: 'AUDIO',
  ringtone: 'RINGTONE',
  app: 'APP ICON',
  privacy: 'PRIVACY',
  profile: 'PROFILE',

  verify: 'VERIFICATION',
}

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  unverified: 'Not requested',
  pending: 'Pending',
  verified: 'Verified',
}

const RADIO_LABEL: Record<RadioScope, string> = {
  screen: 'This screen only',
  app: 'Across Poplur',
  outside: 'Radio outside app',
}

const SIDE_LABEL: Record<ControlSide, string> = {
  left: 'Left side',
  right: 'Right side',
}

const GENDER_LABEL: Record<ProfileGender, string> = {
  male: 'Male',
  female: 'Female',
}

// No onClose prop: with DONE gone, the cube is the only way out of this screen,
// and the cube is the shell's own handler — nothing here needs to call it.
export default function SettingsScreen({ bindBack }: {
  /** The cube's back button, lent down from the hold menu. Settings nests one
      level (the root list -> a sub-page), so it hands that step up rather than
      printing a "‹ SETTINGS" of its own. See HoldMenuTwin's nativeBackRef. */
  bindBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const stepBackRef = useRef<() => boolean>(() => false)
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
  const [screenMode, setScreenMode] = useState<ScreenTransition>(() => screenTransition())
  const [cubeMode, setCubeMode] = useState<CubeTransition>(() => cubeTransition())
  const [holdCubeMode, setHoldCubeMode] = useState<HoldPreviewMode>(() => holdPreviewMode())
  const [controlSide, setControlSideState] = useState<ControlSide>(readControlSide)
  const [profileTheme, setProfileThemeState] = useState<ProfileTheme>(readSelectedProfileTheme)
  const [appIcon, setAppIcon] = useState<AppIconOption>(readSelectedAppIcon)
  const [gender, setGenderState] = useState<ProfileGender>(readProfileGender)
  const [verification, setVerification] = useState<VerificationState>(readVerification)
  const [accountPrivacy, setAccountPrivacyState] = useState<AccountPrivacySnapshot>(accountPrivacySnapshot)
  const [testActivityConsent, setTestActivityConsentState] = useState(isTestActivityConsentEnabled)
  const [testActivityConsentSaving, setTestActivityConsentSaving] = useState(false)
  const [verifyChoice, setVerifyChoice] = useState<VerificationCategoryID | null>(null)
  // null is the root list. The cube still closes Settings outright, so this only
  // ever has to walk back one level.
  const [page, setPage] = useState<Page | null>(null)

  // The ringtone is also settable on the handset itself (PhoneScreen's own
  // settings), so this mirrors the store rather than owning it — whichever
  // place you change it, both rows agree.
  const [ringtone, setRingtoneState] = useState<RingtoneId>(getRingtone)
  useEffect(() => onRingtoneChange(() => setRingtoneState(getRingtone())), [])

  const chooseRingtone = (id: RingtoneId) => {
    playPop()
    setRingtone(id)
    setRingtoneState(id)
    // Hear it as you pick it: a ringtone chosen from a list of names is a
    // guess until it makes a sound.
    previewRingtone(id)
  }

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
    // RadioScope remains the canonical wire format because it preserves the
    // existing "outside" choice. The boolean makes the shared intent explicit
    // to native shells: it applies to Radio and iPod together.
    postNativeEvent({ type: 'radioScope', scope, backgroundAudioEnabled: scope !== 'screen' })
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
  const chooseAppIcon = (icon: AppIconOption) => {
    playPop()
    if (!isNativeShell()) {
      say('App icon changes are available in the installed app.')
      return
    }
    if (!postNativeEvent({ type: 'appIconChanged', id: icon.id })) {
      say('The app icon could not be changed.')
    }
  }

  const openPage = (next: Page) => { playPop(); setPage(next) }
  // On a sub-page the cube walks back to the list; on the list it falls
  // through and closes Settings, which is what it already did. This replaced
  // the "‹ SETTINGS" button, so the pop it used to play moves here.
  stepBackRef.current = () => {
    if (page === null) return false
    playPop()
    setPage(null)
    return true
  }
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => stepBackRef.current())
    return () => bindBack(null)
  }, [bindBack])

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

  useEffect(() => onAccountPrivacyChange(setAccountPrivacyState), [])

  useEffect(() => {
    const off = onTestActivityConsentChange(setTestActivityConsentState)
    // Server state is authoritative per signed-in account. A missing network
    // response leaves the safe local default (off) in place.
    void loadTestActivityConsent().catch(() => {})
    return off
  }, [])

  useEffect(() => {
    const onNativePrivacy = (event: Event) => {
      const detail = (event as CustomEvent<{
        privateAccount?: unknown
        ghostMode?: unknown
        ok?: unknown
        message?: unknown
      }>).detail ?? {}
      if (detail.ok === false) {
        setAccountPrivacySaving(false)
        if (typeof detail.message === 'string' && detail.message.trim()) say(detail.message)
        return
      }
      applyNativeAccountPrivacy(detail)
    }
    window.addEventListener('poplur-native-account-privacy', onNativePrivacy)
    if (isNativeShell()) postNativeEvent({ type: 'requestAccountPrivacy' })
    return () => window.removeEventListener('poplur-native-account-privacy', onNativePrivacy)
  }, [])

  const changeAccountPrivacy = (patch: Partial<Pick<AccountPrivacySnapshot, 'privateAccount' | 'ghostMode'>>) => {
    playPop()
    const next = {
      privateAccount: patch.privateAccount ?? accountPrivacy.privateAccount,
      ghostMode: patch.ghostMode ?? accountPrivacy.ghostMode,
    }
    if (!isNativeShell()) {
      setLocalAccountPrivacy(next)
      return
    }
    setAccountPrivacySaving(true)
    if (!postNativeEvent({ type: 'accountPrivacyChanged', ...next })) {
      setAccountPrivacySaving(false)
      say('Privacy could not be saved on this device.')
    }
  }

  const changeTestActivityConsent = async () => {
    if (testActivityConsentSaving) return
    playPop()
    const next = !testActivityConsent
    setTestActivityConsentSaving(true)
    try {
      const saved = await setTestActivityConsent(next)
      setTestActivityConsentState(saved)
      say(saved ? 'Closed-beta activity sharing is on.' : 'Closed-beta activity sharing is off.')
    } catch (reason) {
      say(reason instanceof Error ? reason.message : 'Beta activity sharing could not be saved.')
    } finally {
      setTestActivityConsentSaving(false)
    }
  }

  // The installed shells persist the shared playback preference independently
  // of WebView storage. Ask when Settings opens rather than assuming an event
  // sent during page bootstrap was still waiting for this screen to mount.
  useEffect(() => {
    const onNativeBackgroundAudio = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean; scope?: string }>).detail
      const scope = detail?.scope === 'screen' || detail?.scope === 'app' || detail?.scope === 'outside'
        ? detail.scope
        : detail?.enabled ? 'app' : 'screen'
      setRadioScope(scope)
      setRadioScopeState(scope)
    }
    window.addEventListener('poplur-native-background-audio', onNativeBackgroundAudio)
    if (isNativeShell()) postNativeEvent({ type: 'requestBackgroundAudio' })
    return () => window.removeEventListener('poplur-native-background-audio', onNativeBackgroundAudio)
  }, [])

  useEffect(() => {
    const onNativeIcon = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; accepted?: boolean; message?: string }>).detail
      const icon = appIconById(detail?.id)
      if (detail?.accepted && icon) {
        setAppIcon(rememberSelectedAppIcon(icon.id))
        say(`${icon.displayName} icon applied.`)
      } else if (detail?.message) {
        say(detail.message)
      }
    }
    window.addEventListener('poplur-native-app-icon', onNativeIcon)
    if (isNativeShell()) postNativeEvent({ type: 'requestAppIcon' })
    return () => window.removeEventListener('poplur-native-app-icon', onNativeIcon)
  }, [])

  // Tell the shell which page of Settings is up, so the navigator cube can wear
  // the paint bucket on the two appearance pages and the verification cube on
  // VERIFICATION — the same one-screen-many-faces route WalletScreen uses for
  // SEND and CASH OUT (see poplur-wallet-page).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-settings-page', { detail: page ?? 'root' }))
  }, [page])
  // Unmount only. Folding this into the effect above would dispatch 'root' on
  // the way out of every page change and flicker the cube back to the gear
  // between one face and the next.
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('poplur-settings-page', { detail: 'root' }))
  }, [])

  const requestVerification = () => {
    if (!verifyChoice) return
    playPop()
    const { state, relayed } = submitVerificationRequest(verifyChoice)
    setVerification(state)
    say(relayed
      ? 'Verification requested. You will hear back in the app.'
      : 'Request saved on this device — review opens when verification goes live.')
  }

  const cancelVerification = () => {
    playPop()
    setVerification(withdrawVerificationRequest())
    setVerifyChoice(null)
    say('Verification request withdrawn.')
  }

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
      text: `Join me on Poplur — use my code ${code} and we both get credits and the whole map.`,
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
    grantReferralCredits()
    setActive(true)
    setRemaining(until - Date.now())
    say(`+${REFERRAL_CREDIT_REWARD} credits — worldwide radius on for ${WORLD_RADIUS_HOURS} hours.`)
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
              {/* Transitions are taste, not correctness — the original and the
                  alternatives are all defensible, so they are chosen here
                  rather than settled in code. Both apply immediately. */}
              <button
                type="button"
                className={styles.row}
                onClick={() => {
                  const next: ScreenTransition = screenTransition() === 'push' ? 'fade' : 'push'
                  setScreenTransition(next)
                  setScreenMode(next)
                }}
              >
                <span className={styles.rowText}>
                  <b>Screen change</b>
                  <i>How a screen arrives when you press a channel button.</i>
                </span>
                <span className={styles.rowValue}>{screenMode === 'push' ? 'Push' : 'Fade'}</span>
              </button>

              <button
                type="button"
                className={styles.row}
                onClick={() => {
                  const next: CubeTransition = cubeTransition() === 'slide' ? 'roll' : 'slide'
                  setCubeTransition(next)
                  setCubeMode(next)
                }}
              >
                <span className={styles.rowText}>
                  <b>Cube change</b>
                  <i>How the navigator swaps when you swipe between tabs.</i>
                </span>
                <span className={styles.rowValue}>{cubeMode === 'slide' ? 'Slide' : 'Roll'}</span>
              </button>

              <button
                type="button"
                className={styles.row}
                onClick={() => {
                  const next: HoldPreviewMode = holdPreviewMode() === '3d' ? '2d' : '3d'
                  setHoldPreviewMode(next)
                  setHoldCubeMode(next)
                }}
              >
                <span className={styles.rowText}>
                  <b>Hold Menu cubes</b>
                  <i>Use real 3D objects or lightweight 2D renders while scrolling.</i>
                </span>
                <span className={styles.rowValue}>{holdCubeMode === '3d' ? '3D' : '2D'}</span>
              </button>

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
                  <b>Audio playback</b>
                  <i>Where Radio and iPod keep playing.</i>
                </span>
                <span className={styles.rowValue}>{RADIO_LABEL[radioScope]}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('ringtone')}>
                <span className={styles.rowText}>
                  <b>Ringtone</b>
                  <i>What the Poplur Phone plays on an incoming call.</i>
                </span>
                <span className={styles.rowValue}>
                  {RINGTONES.find(r => r.id === ringtone)?.name ?? '—'}
                </span>
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

              <button type="button" className={styles.row} onClick={() => openPage('privacy')}>
                <span className={styles.rowText}>
                  <b>Privacy</b>
                  <i>Control whether posts carry a public map origin.</i>
                </span>
                <span className={styles.rowValue}>
                  {accountPrivacy.privateAccount
                    ? 'Private'
                    : accountPrivacy.ghostMode ? 'Ghost' : 'Public'}
                </span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>



              <button type="button" className={styles.row} onClick={() => openPage('app')}>
                <span className={styles.rowText}>
                  <b>App Icon</b>
                  <i>Choose how Poplur appears on this device.</i>
                </span>
                <span className={styles.rowValue}>{appIcon.displayName}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>

              <button type="button" className={styles.row} onClick={() => openPage('verify')}>
                <span className={styles.rowText}>
                  <b>Verification</b>
                  <i>Ask for the badge that marks this profile as the real one.</i>
                </span>
                <span className={styles.rowValue}>{VERIFICATION_LABEL[verification.status]}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>
            </div>
            {/* No DONE: every control here commits the moment you touch it, so
                there is nothing to confirm. The cube closes the screen. */}
          </>
        )}

        {page !== null && (
          <div className={styles.navBar}>
            {/* No "‹ SETTINGS" button — the cube is the back control, here as
                everywhere. The page just says where you are. */}
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
              ? `Your radius covers the whole world right now. Refer another friend for +${REFERRAL_CREDIT_REWARD} credits and another day.`
              : `Bring someone in and earn ${REFERRAL_CREDIT_REWARD} credits plus 24 hours of worldwide radius.`}
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
        <article className={styles.group} aria-label="Audio playback">
          <div className={styles.radioScope} role="radiogroup" aria-label="Where Radio and iPod keep playing">
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
            {radioScope === 'screen' && 'Radio and iPod stop when you leave their screens.'}
            {radioScope === 'app' && 'Radio and iPod keep playing while you browse Poplur.'}
            {radioScope === 'outside' && 'Radio keeps playing outside Poplur. iPod stops when Poplur is backgrounded.'}
          </p>
        </article>
        )}

        {page === 'ringtone' && (
        <article className={styles.group} aria-label="Phone ringtone">
          {/* Same radiogroup furniture the Radio and Control-position pages use,
              so this reads as one of the settings pages rather than a new kind
              of control. */}
          <div className={styles.radioScope} role="radiogroup" aria-label="Ringtone">
            {RINGTONES.map(tone => (
              <button
                type="button"
                key={tone.id}
                role="radio"
                aria-checked={ringtone === tone.id}
                className={ringtone === tone.id ? styles.radioScopeOn : undefined}
                onClick={() => chooseRingtone(tone.id)}
              >
                {tone.name}
              </button>
            ))}
          </div>
          <p className={styles.radioScopeNote}>
            Plays a preview as you choose. The handset has this same setting on
            its own screen — either one sets it.
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

        {page === 'privacy' && (
        <article className={styles.group} aria-label="Account location privacy">
          <button
            type="button"
            className={styles.switchRow}
            role="switch"
            aria-checked={accountPrivacy.privateAccount}
            disabled={accountPrivacy.saving}
            onClick={() => changeAccountPrivacy({ privateAccount: !accountPrivacy.privateAccount })}
          >
            <span className={styles.switchText}>
              <b>Private Account</b>
              <i>People can still see you and your posts, but not where any post came from. Poplur has no follower approvals.</i>
            </span>
            <span className={accountPrivacy.privateAccount ? `${styles.switchTrack} ${styles.switchOn}` : styles.switchTrack}>
              <em />
            </span>
          </button>

          <button
            type="button"
            className={styles.switchRow}
            role="switch"
            aria-checked={accountPrivacy.ghostMode}
            disabled={accountPrivacy.saving}
            onClick={() => changeAccountPrivacy({ ghostMode: !accountPrivacy.ghostMode })}
          >
            <span className={styles.switchText}>
              <b>Ghost Mode</b>
              <i>Temporarily hide the public map origin of all your posts while this is on.</i>
            </span>
            <span className={accountPrivacy.ghostMode ? `${styles.switchTrack} ${styles.switchOn}` : styles.switchTrack}>
              <em />
            </span>
          </button>

          <button
            type="button"
            className={styles.switchRow}
            role="switch"
            aria-checked={testActivityConsent}
            disabled={testActivityConsentSaving}
            onClick={() => { void changeTestActivityConsent() }}
          >
            <span className={styles.switchText}>
              <b>Share closed-beta activity</b>
              <i>Help test Poplur by sharing coarse screen, platform, app version and activity timing for up to 14 days.</i>
            </span>
            <span className={testActivityConsent ? `${styles.switchTrack} ${styles.switchOn}` : styles.switchTrack}>
              <em />
            </span>
          </button>

          <p className={styles.radioScopeNote}>
            Exact coordinates are never public in either mode. Public accounts show only a coarse map area; private or ghost posts show no map origin.
            {accountPrivacy.saving ? ' Updating existing posts…' : ''}
          </p>
          <p className={styles.radioScopeNote}>
            Closed-beta sharing is off by default and belongs only to this signed-in account. It never includes message text, media, precise coordinates, microphone or camera data. You can turn it off here at any time.
            {testActivityConsentSaving ? ' Saving…' : ''}
          </p>
        </article>
        )}

        {page === 'profile' && (
        <article className={styles.group} aria-label="Cube head">
          <div className={styles.radioScope} role="radiogroup" aria-label="Which clay head your profile wears">
            {(Object.entries(GENDER_LABEL) as Array<[ProfileGender, string]>).map(([value, label]) => (
              <button
                type="button"
                key={value}
                role="radio"
                aria-checked={gender === value}
                className={gender === value ? styles.radioScopeOn : undefined}
                onClick={() => {
                  playPop()
                  setGenderState(value)
                  writeProfileGender(value)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={styles.radioScopeNote}>
            The clay head your Profile tab wears — also asked once when you first sign in.
          </p>
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

        {page === 'app' && (
          <article className={styles.themeGroup} aria-label="App icon">
            <div className={styles.themeHeading}>
              <div>
                <b>App icon</b>
                <span>Choose how Poplur looks on your Home Screen.</span>
              </div>
              <strong>{appIcon.displayName}</strong>
            </div>
            <div className={styles.themeGrid} role="radiogroup" aria-label="Choose an app icon">
              {APP_ICONS.map(icon => {
                const selected = appIcon.id === icon.id
                return (
                  <button
                    type="button"
                    key={icon.id}
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${icon.displayName}${selected ? ', selected' : ''}`}
                    className={selected ? `${styles.themeTile} ${styles.themeTileSelected}` : styles.themeTile}
                    onClick={() => chooseAppIcon(icon)}
                  >
                    <span
                      className={`${styles.themePreview} ${styles.appIconPreview}`}
                      style={{ backgroundImage: `url("${icon.previewSrc}")` }}
                      aria-hidden="true"
                    >
                      {selected && <i>✓</i>}
                    </span>
                    <span className={styles.themeName}>{icon.displayName}</span>
                  </button>
                )
              })}
            </div>
            <p className={styles.themeFootnote}>Saved on this device. The operating system may take a moment to refresh the Home Screen.</p>
          </article>
        )}

        {page === 'verify' && (
          <article className={styles.themeGroup} aria-label="Profile verification">
            <div className={styles.themeHeading}>
              <div>
                <b>Verify this profile</b>
                <span>The badge tells people the account is the real one.</span>
              </div>
              <strong>{VERIFICATION_LABEL[verification.status]}</strong>
            </div>

            {verification.status === 'verified' ? (
              <p className={styles.verifyState}>
                This profile is verified. Poplur shows the blue badge beside your name.
              </p>
            ) : verification.status === 'pending' ? (
              <>
                <p className={styles.verifyState}>
                  Request sent{verification.requestedAt
                    ? ` on ${new Date(verification.requestedAt).toLocaleDateString()}`
                    : ''}. Nothing else is needed from you.
                </p>
                <button type="button" className={styles.verifyCancel} onClick={cancelVerification}>
                  WITHDRAW REQUEST
                </button>
              </>
            ) : (
              <>
                <div className={styles.verifyGrid} role="radiogroup" aria-label="What is this profile?">
                  {VERIFICATION_CATEGORIES.map(category => {
                    const selected = verifyChoice === category.id
                    return (
                      <button
                        type="button"
                        key={category.id}
                        role="radio"
                        aria-checked={selected}
                        className={selected ? `${styles.verifyTile} ${styles.verifyTileSelected}` : styles.verifyTile}
                        onClick={() => { playPop(); setVerifyChoice(category.id) }}
                      >
                        <b>{category.displayName}</b>
                        <i>{category.blurb}</i>
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className={styles.invite}
                  disabled={!verifyChoice}
                  onClick={requestVerification}
                >
                  REQUEST VERIFICATION
                </button>
              </>
            )}

            <p className={styles.themeFootnote}>
              Requests are reviewed by a person. Your profile picture and username are
              what get checked, so make sure both are current before you ask.
            </p>
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
