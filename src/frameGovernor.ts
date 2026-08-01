// One clock for every animation in the app, and a thermal ladder on top of it.
//
// WHY: the app used to run ~30 independent requestAnimationFrame loops, each
// re-arming itself at whatever rate the display offered. On a ProMotion iPhone
// that is 120Hz — double the GPU and main-thread work of 60 for clay bulges and
// drifting flyers nobody perceives above 30. Render energy scales with frames
// drawn, so an uncapped ambient loop is the single largest sustained draw the
// app has, and sustained draw is exactly what heats a phone.
//
// Several of those loops also re-armed BEFORE their own visibility guard, so
// the main thread woke 120x/sec to immediately do nothing whenever the surface
// was not front. That is invisible in a profile (each wake is ~0ms) and still
// costs real power.
//
// HOW: one rAF drives every subscriber. Each names the rate it actually needs,
// and gets called at that rate or slower — never faster. Touch temporarily
// promotes ambient work to interactive rate so gestures still feel direct, then
// it decays back down. When the page is hidden or the surface is not front, the
// loop stops entirely rather than spinning on guards.
//
// The ladder: WKWebView exposes no thermal API, but a device that is throttling
// misses its frame deadline consistently, and that IS measurable. Sustained
// overrun steps quality down; a long comfortable stretch steps it back up, with
// enough hysteresis that we never oscillate. A hot phone degrades instead of
// cooking.

/** 3 = everything on, 0 = survival. Only ever moves one step at a time. */
export type Quality = 0 | 1 | 2 | 3

/** Rate classes. Ambient work is the stuff that heats the phone for no gain. */
export type Rate = 'interactive' | 'ambient' | 'idle'

type Sub = {
  cb: (dtMs: number, now: number) => void
  rate: Rate
  last: number
}

const subs = new Set<Sub>()

let raf = 0
let running = false
let surfaceFront = true
let quality: Quality = 3
let boostUntil = 0

const qualityListeners = new Set<(q: Quality) => void>()

// ── rate table ───────────────────────────────────────────────────────────────
// Hz per rate class at each quality level. Interactive stays at 60 until the
// device is genuinely struggling: dropping gesture tracking is the most visible
// possible regression, so it is the last thing to go. Ambient is capped at 30
// even at full quality — that is the whole point of the module.
const HZ: Record<Rate, [number, number, number, number]> = {
  //           q0  q1  q2  q3
  interactive: [30, 45, 60, 60],
  ambient:     [10, 15, 24, 30],
  idle:        [2,   4,  6,  8],
}

/** Frame interval the current quality asks of a rate class, in ms. */
function intervalFor(rate: Rate): number {
  const hz = HZ[rate][quality]
  // A boost promotes ambient work to interactive rate: while a finger is down,
  // parallax and drift should track the gesture, not stutter behind it.
  if (rate === 'ambient' && performance.now() < boostUntil) {
    return 1000 / HZ.interactive[quality]
  }
  return 1000 / hz
}

// ── the thermal ladder ───────────────────────────────────────────────────────
// A rolling window of frame intervals. We compare the median against the rate
// we ASKED for, not against 16.7ms: at 30Hz ambient a 33ms frame is perfect,
// and judging it against a 60Hz budget would ratchet quality down forever.
const WINDOW = 90
const intervals: number[] = []
let lastFrame = 0
let overrunStreak = 0
let comfortStreak = 0

/** Deadline we expect to hit: the fastest rate any live subscriber asked for. */
function currentDeadlineMs(): number {
  let fastest = Infinity
  for (const s of subs) fastest = Math.min(fastest, intervalFor(s.rate))
  return fastest === Infinity ? 1000 / 30 : fastest
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function setQuality(next: Quality) {
  if (next === quality) return
  quality = next
  intervals.length = 0
  overrunStreak = 0
  comfortStreak = 0
  qualityListeners.forEach(fn => fn(quality))
}

function sampleThermals(dt: number) {
  intervals.push(dt)
  if (intervals.length > WINDOW) intervals.shift()
  if (intervals.length < WINDOW) return

  const med = median(intervals)
  const deadline = currentDeadlineMs()

  // 1.6x over the deadline is a device that cannot keep up, not one slow frame.
  if (med > deadline * 1.6) {
    overrunStreak++
    comfortStreak = 0
    // ~2s of sustained overrun before stepping down.
    if (overrunStreak > 2 && quality > 0) setQuality((quality - 1) as Quality)
  } else if (med < deadline * 1.1) {
    comfortStreak++
    overrunStreak = 0
    // Much longer to earn quality back than to lose it — recovering too eagerly
    // is how a thermally limited phone ends up oscillating between tiers.
    if (comfortStreak > 12 && quality < 3) setQuality((quality + 1) as Quality)
  }
}

// ── the loop ─────────────────────────────────────────────────────────────────
function tick(now: number) {
  raf = requestAnimationFrame(tick)

  const dt = lastFrame ? now - lastFrame : 0
  lastFrame = now
  if (dt) sampleThermals(dt)

  for (const s of subs) {
    const interval = intervalFor(s.rate)
    const since = now - s.last
    // `- 1`: rAF timestamps jitter by a fraction of a ms, and an exact
    // comparison drops every other frame at rates that divide the display rate.
    if (since < interval - 1) continue
    s.last = now
    try {
      s.cb(since, now)
    } catch {
      // One bad subscriber must not stop every animation in the app.
    }
  }
}

function shouldRun(): boolean {
  return subs.size > 0 && surfaceFront && !document.hidden
}

function sync() {
  const want = shouldRun()
  if (want && !running) {
    running = true
    lastFrame = 0
    intervals.length = 0
    raf = requestAnimationFrame(tick)
  } else if (!want && running) {
    running = false
    cancelAnimationFrame(raf)
    raf = 0
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', sync)
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Subscribe to the shared clock. Returns an unsubscribe function.
 *
 * The callback receives the ms elapsed since ITS last call (not since the last
 * display frame), so time-based animation stays correct as the rate changes
 * underneath it — which it will, whenever the ladder moves.
 */
export function onFrame(cb: (dtMs: number, now: number) => void, rate: Rate = 'ambient'): () => void {
  const sub: Sub = { cb, rate, last: 0 }
  subs.add(sub)
  sync()
  return () => {
    subs.delete(sub)
    sync()
  }
}

/**
 * Promote ambient work to interactive rate for a moment. Call on touch/pointer
 * down and during drags — cheap to call repeatedly.
 */
export function boostFrames(ms = 400): void {
  boostUntil = Math.max(boostUntil, performance.now() + ms)
}

/**
 * Whether this surface is the one the user is looking at. The map iframe stays
 * mounted behind other tabs in some shells, and a `display:none` iframe is NOT
 * `document.hidden` — so visibility alone cannot answer this.
 */
export function setSurfaceFront(front: boolean): void {
  surfaceFront = front
  sync()
}

export function currentQuality(): Quality {
  return quality
}

export function onQualityChange(cb: (q: Quality) => void): () => void {
  qualityListeners.add(cb)
  return () => { qualityListeners.delete(cb) }
}

/**
 * Device pixel ratio to render at, given the quality ladder. Small decorative
 * canvases should pass a lower `max` — a 40px clay icon gains nothing from 2x,
 * and every one of them is a full framebuffer.
 */
export function qualityPixelRatio(max = 2): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const ceiling = [1, 1.25, 1.5, max][quality]
  return Math.min(dpr, ceiling)
}

/**
 * Whether ambient decoration (flyers, boats, drifting parallax) should run at
 * all. Below full quality it is the first thing to go: it is pure decoration
 * and it is per-frame GPU work.
 */
export function ambientAllowed(): boolean {
  return quality >= 3
}
