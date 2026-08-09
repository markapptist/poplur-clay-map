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
let wakeTimer = 0
let running = false
let surfaceFront = true
let quality: Quality = 3
// The JS ladder infers pressure from missed deadlines. Native iOS has the real
// ProcessInfo thermal state, so it can impose a ceiling before WebKit becomes
// slow enough for inference to notice. `fair` already means the phone is warm;
// decorative motion should be gone by then, not after serious throttling.
let nativeThermalCeiling: Quality = 3
let boostUntil = 0
const AMBIENT_IDLE_MS = 15_000
let ambientAwakeUntil = typeof performance !== 'undefined'
  ? performance.now() + AMBIENT_IDLE_MS
  : Number.POSITIVE_INFINITY
let ambientSleepTimer = 0

const qualityListeners = new Set<(q: Quality) => void>()
const ambientSleepListeners = new Set<(sleeping: boolean) => void>()
let ambientSleeping = false

// Decoration asleep and the map renderer parked are NOT the same decision, and
// conflating them cost us a frozen map. A parked map has its private
// `_triggerFrame` patched out, so it cannot draw its own pans and zooms either —
// at a serious thermal ceiling, where every touch re-slept ambient, that left the
// canvas dead for as long as the phone stayed warm while the HUD kept updating,
// which reads as a broken map rather than a throttled one.
//
// So: decoration still stops the moment the gate closes, but the surface a finger
// is actually on keeps drawing. The window is the gesture itself plus a short tail
// for inertia; nothing autonomous can hold it open.
const rendererParkListeners = new Set<(parked: boolean) => void>()
let rendererParked = false
let pointersDown = 0
let interactionUntil = 0
let interactionTimer = 0
const INTERACTION_TAIL_MS = 1200

function interacting(): boolean {
  if (pointersDown > 0) return true
  return typeof performance !== 'undefined' && performance.now() < interactionUntil
}

function syncRendererPark(): void {
  const next = ambientSleeping && !interacting()
  if (next === rendererParked) return
  rendererParked = next
  rendererParkListeners.forEach(listener => listener(next))
}

/** Extend the direct-interaction window and re-evaluate the park. */
function noteInteraction(): void {
  if (typeof performance === 'undefined' || typeof window === 'undefined') return
  interactionUntil = performance.now() + INTERACTION_TAIL_MS
  window.clearTimeout(interactionTimer)
  // The tail has to re-park itself: once the gesture ends, no other event fires.
  interactionTimer = window.setTimeout(() => {
    interactionTimer = 0
    syncRendererPark()
  }, INTERACTION_TAIL_MS + 20)
  syncRendererPark()
}

function setAmbientSleeping(sleeping: boolean): void {
  if (ambientSleeping === sleeping) return
  ambientSleeping = sleeping
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('poplur-ambient-sleep', sleeping)
  }
  ambientSleepListeners.forEach(listener => listener(sleeping))
  syncRendererPark()
}

// ── rate table ───────────────────────────────────────────────────────────────
// Hz per rate class at each quality level. Interactive stays at 60 until the
// device is genuinely struggling: dropping gesture tracking is the most visible
// possible regression, so it is the last thing to go. Ambient is capped at 30
// even at full quality — that is the whole point of the module.
const HZ: Record<Rate, [number, number, number, number]> = {
  //           q0  q1  q2  q3
  interactive: [30, 45, 60, 60],
  // Ambient decoration must have a hard energy ceiling even on a phone that
  // can still hit every deadline. Waiting for thermal throttling before
  // reducing it means the device is already hot. Twenty frames is enough for
  // slow clay drift; the interactive boost still gives a gesture 60.
  ambient:     [5,  10, 15, 20],
  idle:        [1,   2,  3,  4],
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
  const bounded = Math.min(next, nativeThermalCeiling) as Quality
  if (bounded === quality) return
  quality = bounded
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
function scheduleNext() {
  if (!running) return
  // Do not keep a ProMotion display awake at 120 Hz just to discover that the
  // fastest subscriber only asked for 4/20/60 Hz. Sleep until the requested
  // deadline, then align the actual draw with the next compositor frame.
  const delay = Math.max(0, currentDeadlineMs() - 2)
  wakeTimer = window.setTimeout(() => {
    wakeTimer = 0
    if (running) raf = requestAnimationFrame(tick)
  }, delay)
}

function tick(now: number) {
  raf = 0

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

  scheduleNext()
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
    window.clearTimeout(wakeTimer)
    raf = 0
    wakeTimer = 0
  }
}

if (typeof document !== 'undefined') {
  const sleepAmbient = () => {
    window.clearTimeout(ambientSleepTimer)
    ambientSleepTimer = 0
    ambientAwakeUntil = 0
    setAmbientSleeping(true)
  }
  /**
   * How long decoration stays awake after a touch, by thermal ceiling.
   * A warm phone earns a shorter leash; a throttling one gets none.
   */
  const ambientLeaseMs = () => {
    if (nativeThermalCeiling <= 0) return 0       // serious / critical
    if (nativeThermalCeiling <= 1) return 4_000   // fair
    return AMBIENT_IDLE_MS
  }
  const wakeAmbient = () => {
    // THE BUG THIS CLOSES. This used to wake unconditionally, and it is bound
    // to pointerdown/touchstart/wheel/keydown below — on the map, a surface you
    // touch constantly. So every drag restarted the decorative work the thermal
    // ceiling had just stopped, and boosted the frame rate on top of it.
    //
    // Measured on device 2026-08-09: the map reached SERIOUS in 35 seconds and
    // did not recover once in the following 14 minutes. The profiler showed
    // exactly this loop — the map parking at 0fps, then returning to 8-14fps
    // while still `thermal=serious`, once per touch. `setQuality` was clamped by
    // the ceiling all along (see the bound in setQuality); ambient sleep and the
    // frame boost were the two paths that never consulted it.
    const lease = ambientLeaseMs()
    if (lease <= 0) {
      // Throttling: decoration stays down. Direct interaction survives because
      // the renderer park consults the gesture window separately (see
      // `syncRendererPark`) — it is NOT enough to rely on Mapbox driving its own
      // pans, because parking patches out the very entry points it would use.
      sleepAmbient()
      return
    }
    ambientAwakeUntil = performance.now() + lease
    setAmbientSleeping(false)
    window.clearTimeout(ambientSleepTimer)
    ambientSleepTimer = window.setTimeout(sleepAmbient, lease)
    boostFrames()
  }
  const onVisibility = () => {
    if (document.hidden || !surfaceFront) sleepAmbient()
    else wakeAmbient()
    sync()
  }

  // Continuous decoration is useful while somebody is exploring, but it has
  // no value once the phone is sitting on the same map. Freeze it after a
  // short untouched window; any real input wakes it immediately. This is an
  // energy gate, not a quality downgrade — the objects remain visible.
  const opts: AddEventListenerOptions = { passive: true, capture: true }
  const onGestureStart = (event: Event) => {
    if (event.type === 'pointerdown') pointersDown++
    noteInteraction()
    wakeAmbient()
  }
  // Only pointer events adjust the count: touch fires BOTH touchstart and
  // pointerdown for one finger, and counting both would never reach zero.
  const onGestureEnd = () => {
    if (pointersDown > 0) pointersDown--
    noteInteraction()
  }
  const onGestureMove = () => {
    if (pointersDown > 0) noteInteraction()
  }
  for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const) {
    document.addEventListener(type, onGestureStart, opts)
  }
  for (const type of ['pointerup', 'pointercancel'] as const) {
    document.addEventListener(type, onGestureEnd, opts)
  }
  // A long drag emits no further downs; without this the tail expires mid-gesture
  // and the map parks under the finger.
  document.addEventListener('pointermove', onGestureMove, opts)
  const applyNativeThermal = (raw: unknown) => {
    const state = typeof raw === 'string'
      ? raw.toLowerCase()
      : typeof raw === 'object' && raw
        ? String((raw as { state?: unknown }).state ?? '').toLowerCase()
        : ''
    if (!state) return

    const previousCeiling = nativeThermalCeiling
    nativeThermalCeiling = state === 'critical' || state === 'serious'
      ? 0
      : state === 'fair'
        ? 1
        : 3
    document.documentElement.dataset.poplurThermal = state
    if (quality > nativeThermalCeiling) setQuality(nativeThermalCeiling)
    if (nativeThermalCeiling < 2) {
      sleepAmbient()
    } else if (previousCeiling < 2) {
      // Recover conservatively: native has returned to nominal, but jumping
      // straight from survival to every effect can heat it again immediately.
      setQuality(2)
      if (surfaceFront && !document.hidden) wakeAmbient()
    }
  }
  window.addEventListener('poplur-native-thermal', event => {
    applyNativeThermal((event as CustomEvent).detail)
  })
  window.addEventListener('message', event => {
    if (event.data?.type === 'poplur-native-thermal') applyNativeThermal(event.data)
  })
  document.addEventListener('visibilitychange', onVisibility)
  wakeAmbient()
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
  // Never promote work on a phone the OS is already throttling. This is the one
  // call whose entire purpose is to spend more frames, so a serious thermal
  // state is the last place it should be honoured. Gated here rather than only
  // at the call sites so a future caller cannot reintroduce the same loop.
  if (nativeThermalCeiling <= 0) return
  boostUntil = Math.max(boostUntil, performance.now() + ms)
  // A parked ambient/idle timer may be tens or hundreds of milliseconds from
  // its next beat. A touch deserves an immediate frame, then the normal
  // interactive schedule takes over.
  if (running && wakeTimer) {
    window.clearTimeout(wakeTimer)
    wakeTimer = 0
    if (!raf) raf = requestAnimationFrame(tick)
  }
}

/**
 * Whether this surface is the one the user is looking at. The map iframe stays
 * mounted behind other tabs in some shells, and a `display:none` iframe is NOT
 * `document.hidden` — so visibility alone cannot answer this.
 */
export function setSurfaceFront(front: boolean): void {
  surfaceFront = front
  if (typeof document !== 'undefined') {
    if (front && !document.hidden) {
      ambientAwakeUntil = performance.now() + AMBIENT_IDLE_MS
      setAmbientSleeping(false)
      window.clearTimeout(ambientSleepTimer)
      ambientSleepTimer = window.setTimeout(() => {
        ambientAwakeUntil = 0
        setAmbientSleeping(true)
      }, AMBIENT_IDLE_MS)
    } else {
      // A surface going away cannot leave a finger "down": the pointerup landed
      // somewhere else, and a stuck count would hold the renderer awake forever.
      pointersDown = 0
      interactionUntil = 0
      ambientAwakeUntil = 0
      setAmbientSleeping(true)
      window.clearTimeout(ambientSleepTimer)
      ambientSleepTimer = 0
    }
  }
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
 * Observe the hard idle/thermal gate. Mapbox camera animations and source
 * transitions are not frame-governor subscribers, so a 2D map uses this edge
 * to stop any in-flight autonomous camera work and truly park its renderer.
 */
export function onAmbientSleepChange(cb: (sleeping: boolean) => void): () => void {
  ambientSleepListeners.add(cb)
  cb(ambientSleeping)
  return () => { ambientSleepListeners.delete(cb) }
}

/**
 * Whether the map renderer itself should park — the idle/thermal gate AND no live
 * gesture. Subscribe to this rather than `onAmbientSleepChange` for anything that
 * suppresses drawing, so a pan or a zoom drag still paints on a warm phone.
 * Decoration keeps using the ambient signal and stays down regardless.
 */
export function onRendererParkChange(cb: (parked: boolean) => void): () => void {
  rendererParkListeners.add(cb)
  cb(rendererParked)
  return () => { rendererParkListeners.delete(cb) }
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
 * Whether ambient decoration (flyers, boats, traffic) should run at all.
 *
 * Deliberately NOT `quality >= 3`: the ladder drops a step on any sustained
 * overrun, and killing every moving thing in the city the first time a device
 * gets warm is a worse regression than the frames cost. Decoration survives one
 * step down (just slower, per the rate table) and only stops at the bottom two
 * tiers, where the device is genuinely in trouble.
 */
export function ambientAllowed(): boolean {
  return quality >= 2
    && (typeof performance === 'undefined' || performance.now() < ambientAwakeUntil)
}
