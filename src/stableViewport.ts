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

function fit() {
  const w = window.innerWidth
  const h = window.innerHeight
  // The WKWebView background-restore glitch: a transient zero/absurd height
  // must never be adopted — keep the held value until a sane one arrives.
  if (h <= 0 || w <= 0) return
  const widthStable = Math.abs(w - stableW) < WIDTH_JITTER
  const keyboardResize = editorFocused() && widthStable && h < stableH - KEYBOARD_MIN_SHRINK
  if (!keyboardResize) {
    stableW = w
    stableH = h
  }
  apply()
}

if (typeof window !== 'undefined') {
  stableW = window.innerWidth
  stableH = window.innerHeight
  apply()
  window.addEventListener('resize', fit)
  window.addEventListener('orientationchange', fit)
  window.addEventListener('pageshow', fit)
  // Post-keyboard settle: adopt the restored height once focus leaves a field.
  window.addEventListener('focusout', () => { window.setTimeout(fit, 360) })
  // visualViewport fires where window.resize sometimes does not (iOS inset
  // transitions); fit() itself decides whether the change is adoptable.
  window.visualViewport?.addEventListener('resize', fit)
}

export {}
