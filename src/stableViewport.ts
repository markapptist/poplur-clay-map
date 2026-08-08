// The system that keeps the HUD where it was put.
//
// Every screen ultimately sizes off `html/body/#root { height: 100% }`, which
// tracks the WKWebView LAYOUT viewport — and iOS resizes that thing behind the
// app's back: keyboard show/hide, safe-area/status-bar transitions (in-call
// banner, dynamic island events, fullscreen-video exit), and an occasional
// transient 0/stale height on background-restore. Everything anchored
// `bottom: 18px` — the cube, the counters, the corner buttons — rides each of
// those, which is exactly "the 3D elements sometimes move out of place".
//
// The cure is the one the pre-login welcome already ships (its fit() holds
// --poplur-layout-height steady through keyboard churn): measure once, expose
// the height as a CSS variable, and adopt a NEW height only for genuine
// viewport changes — an orientation/width change, or a height change while no
// text editor is focused. ViewHarness's .stage consumes the variable, so the
// whole screen tree below it inherits one stable box.
//
// Imported for its side effect from main.tsx, before first paint.

const VAR = '--poplur-app-height'

// A keyboard resize shrinks height by at least this much with width unchanged.
const KEYBOARD_MIN_SHRINK = 80
const WIDTH_JITTER = 3

let stableW = 0
let stableH = 0

function editorFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

function apply() {
  document.documentElement.style.setProperty(VAR, `${stableH}px`)
}

// How long a shrink must PERSIST before it counts as the real viewport.
// A retracting keyboard restores the height well inside this; a genuine change
// (rotation, a safe-area transition) is still there afterwards.
const SHRINK_CONFIRM_MS = 700

let confirmTimer = 0

function fit() {
  const w = window.innerWidth
  const h = window.innerHeight
  // The WKWebView background-restore glitch: a transient zero/absurd height
  // must never be adopted — keep the held value until a sane one arrives.
  if (h <= 0 || w <= 0) return
  const widthStable = Math.abs(w - stableW) < WIDTH_JITTER
  const shrunk = widthStable && h < stableH - KEYBOARD_MIN_SHRINK

  // A big shrink is NEVER adopted on the spot.
  //
  // This used to trust `editorFocused()` to tell a keyboard apart from a real
  // resize, and that fails in the one flow that matters: posting a comment
  // UNMOUNTS the focused input, so by the time the keyboard has finished
  // retracting there is no editor to find. The resize then read as a genuine
  // viewport change, the shrunken height was adopted, and every screen sizing
  // off --poplur-app-height stayed short — the feed left sitting out of place
  // with black bands above and below it, until the app was reloaded.
  //
  // So the test is persistence rather than focus: hold the known-good height,
  // and only take the smaller one if it is STILL smaller once the keyboard
  // would have finished leaving.
  if (shrunk) {
    window.clearTimeout(confirmTimer)
    confirmTimer = window.setTimeout(() => {
      const stillNarrow = Math.abs(window.innerWidth - stableW) < WIDTH_JITTER
      const stillShort = window.innerHeight > 0 && window.innerHeight < stableH - KEYBOARD_MIN_SHRINK
      if (stillNarrow && stillShort && !editorFocused()) {
        stableW = window.innerWidth
        stableH = window.innerHeight
        apply()
      }
    }, SHRINK_CONFIRM_MS)
    apply()
    return
  }

  window.clearTimeout(confirmTimer)
  stableW = w
  stableH = h
  apply()
}

if (typeof window !== 'undefined') {
  stableW = window.innerWidth
  stableH = window.innerHeight
  apply()
  window.addEventListener('resize', fit)
  window.addEventListener('orientationchange', fit)
  window.addEventListener('pageshow', fit)
  // Post-keyboard settle. Sampled more than once on purpose: iOS does not
  // reliably fire a resize at the END of the keyboard's retraction, and a
  // single check at 360ms can land while it is still moving. These re-fits are
  // free — fit() with an unchanged height sets the same variable to the same
  // value and nothing re-lays-out.
  const settle = () => { [120, 360, 900].forEach(ms => window.setTimeout(fit, ms)) }
  window.addEventListener('focusout', settle)
  // Posting a comment REMOVES the focused input rather than blurring it, and a
  // removed element does not reliably fire focusout. Watch the field going
  // away as well, or that flow settles only if some later event happens to
  // arrive. Cheap: it only looks when an editor was the thing that left.
  const editorRemoved = (records: MutationRecord[]) =>
    records.some(r => [...r.removedNodes].some(n =>
      n instanceof HTMLElement
      && (n.matches('input, textarea, [contenteditable]') || Boolean(n.querySelector('input, textarea, [contenteditable]')))))
  new MutationObserver(records => { if (editorRemoved(records)) settle() })
    .observe(document.documentElement, { childList: true, subtree: true })
  // visualViewport fires where window.resize sometimes does not (iOS inset
  // transitions); fit() itself decides whether the change is adoptable.
  window.visualViewport?.addEventListener('resize', fit)
}

export {}
