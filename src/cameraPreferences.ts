// Camera preferences that outlive a session. Kept beside feedPreferences and
// mapTourPreferences so every surface reads one contract instead of each
// keeping a private copy of the answer.
//
// Both of these exist because the camera does things ON ITS OWN — it talks,
// and it starts looking — and anything the app does unprompted needs a way to
// be told not to.

const VOICE_KEY = 'poplur.cameraAiVoice'
const DETECT_KEY = 'poplur.cameraDetectDefault'

/**
 * Does the AI say aloud what it is looking at?
 *
 * Defaults ON: naming what it sees is the point of pointing the camera at
 * something. Off, the readout and the boxes still work — the room just stays
 * quiet, which matters when you are filming, in company, or somewhere you
 * would rather the phone did not narrate.
 */
export function readCameraAiVoice(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(VOICE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeCameraAiVoice(on: boolean): boolean {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? '1' : '0')
  } catch { /* private mode: the session value still applies */ }
  notify()
  return on
}

/**
 * Is ML detection already running when the camera opens?
 *
 * Defaults ON (owner decision, 9 Sep 2026). Scanning is what this camera is
 * FOR — the readout, the boxes and the commerce cards are the product, and a
 * viewfinder that opens inert makes the whole feature something you have to
 * know to go and switch on.
 *
 * It was the other way round, and the reason is still true: the model is the
 * single most expensive thing the camera does, and the camera has burned this
 * phone before. So this stays a real preference rather than a hard-coded
 * `true` — Settings can turn it off, and once turned off it STAYS off across
 * launches, which is the half that was previously broken (cameraStore never
 * read this at all).
 */
export function readCameraDetectDefault(): boolean {
  if (typeof window === 'undefined') return true
  try {
    // Absent means "never chosen", which is now ON. Only an explicit '0' — a
    // deliberate visit to Settings — opens the camera quiet.
    return window.localStorage.getItem(DETECT_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeCameraDetectDefault(on: boolean): boolean {
  try {
    window.localStorage.setItem(DETECT_KEY, on ? '1' : '0')
  } catch { /* private mode */ }
  notify()
  return on
}

// The native side owns the voice (CameraAIAnnouncer) and the camera session,
// so a change here has to cross the bridge as well as land in storage.
const listeners = new Set<() => void>()

export function onCameraPreferenceChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notify() {
  listeners.forEach(fn => {
    try { fn() } catch { /* one deaf listener must not block the rest */ }
  })
}
