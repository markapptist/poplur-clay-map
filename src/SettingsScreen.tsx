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

// Settings, and the one thing in it that is a feature rather than a switch:
// REFER A FRIEND. Radius is earned slowly and decays; a referral hands you the
// entire planet for a day, which is the only place in the app where reach is
// given outright. See referral.ts for the mechanic and the live-service wire.

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
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
    <section className={styles.screen} aria-label="Settings">
      <header className={styles.header}>
        <p className={styles.eyebrow}>POPLUR</p>
        <h2>SETTINGS</h2>
      </header>

      <div className={styles.body}>
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

        <article className={styles.group} aria-label="Camera">
          <span className={styles.groupKicker}>CAMERA</span>

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

        <article className={styles.group} aria-label="Radio playback">
          <span className={styles.groupKicker}>RADIO PLAYBACK</span>
          <div className={styles.radioScope} role="radiogroup" aria-label="Where radio keeps playing">
            {([
              ['screen', 'Radio screen'],
              ['app', 'Across Poplur'],
              ['outside', 'Outside app'],
            ] as Array<[RadioScope, string]>).map(([scope, label]) => (
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

        <article className={styles.group} aria-label="Control position">
          <span className={styles.groupKicker}>CONTROL POSITION</span>
          <div className={styles.radioScope} role="radiogroup" aria-label="Side for camera and map controls">
            {([['left', 'Left side'], ['right', 'Right side']] as Array<[ControlSide, string]>).map(([side, label]) => (
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
        {isNativeShell() && (
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

        {/* DONE, the same way SHOW ME ends — the cube is still the universal
            back, this is the one that is on the screen you are reading. */}
        <button type="button" className={styles.done} onClick={onClose}>DONE</button>
      </div>
    </section>
  )
}
