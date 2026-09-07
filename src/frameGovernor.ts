import { MANAGED_RENDERING_OPERATION_EVENT, isNativeShell } from './nativeBridge'
import { nativeAmbientDeadline } from './ambientWorkBudget'

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

// Master off-switch for every automatic degradation this module performs:
// the missed-deadline ladder, native thermal/policy ceilings, the phone
// baseline rung, ambient sleep and the renderer park. Hidden-document and
// background gating stay — an invisible page still renders nothing. The
// native shells carry the same switch (PoplurPerformanceManager.
// governorDisabled); flip both together. OFF-governor means the phone heats
// at the rate the content actually costs.
//
// Recontracted after the 17 Aug thermal audit. The switch used to conflate
// two different jobs and kept getting flipped off because of the first one:
//   1. QUALITY MASKING — capping visible animation and dropping texture/DPR
//      at rest. Removed outright: FULL quality is now the resting state on
//      every capable device (see NATIVE_BASELINE_QUALITY below), so there is
//      nothing here to want off.
//   2. DEMAND SCHEDULING + the safety ladder — the clock sleeping when no
//      subscriber is dirty, ambient sleep after real idleness, the renderer
//      park, and thermal/power/memory ceilings entered only on real device
//      signal. This is what an off-switch used to silently kill: measured
//      cost of killing it was a 60Hz no-op clock, 75 unstoppable CSS
//      animations (49% of main-thread time in the 6 Aug device trace), and
//      the camera losing its pressure brakes.
// The switch remains for experiments, but understand what it now means:
// it disables scheduling AND the ladder together, and the publish gate will
// pass the build unmeasured, loudly. Ship it off only on purpose.
// 3GB-class detection matches main.tsx's tier-low; those devices also start
// one quality rung lower because ungoverned they measured map p50 250ms /
// 100% janky against 57ms governed.
const LOW_TIER_DEVICE = (() => {
  try {
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory
    return typeof mem === 'number' && mem <= 2
  } catch {
    return false
  }
})()
const GOVERNOR_DISABLED = false

/** Rate classes. Ambient work is the stuff that heats the phone for no gain. */
export type Rate = 'interactive' | 'managed' | 'ambient' | 'idle'

type Sub = {
  cb: (dtMs: number, now: number) => void
  rate: Rate
  last: number
  /**
   * Fixed period for `onTick` subscribers, in ms. `onFrame` subscribers leave
   * this undefined and take their period from the rate table instead.
   *
   * A tick names a real deadline ("poll this every second"), not a smoothness
   * preference, so the ladder does NOT stretch it and a boost does NOT promote
   * it — a 1s watchdog has no business running at 60Hz because a finger came
   * down. What a tick gives up instead is the right to run while nothing is
   * happening: see `subscriberWorkPaused`.
   */
  everyMs?: number
}

const subs = new Set<Sub>()

let raf = 0
let wakeTimer = 0
let running = false
let surfaceFront = true
// Capable phones start at the full showcase: pre-emptive downgrade at rest
// was quality masking, and the 17 Aug audit removed it — the thermal and
// policy ceilings below still demote the moment a real signal arrives. Only
// the 3GB class keeps the lower baseline, on its own measured numbers.
const NATIVE_BASELINE_QUALITY: Quality = LOW_TIER_DEVICE ? 2 : 3
let quality: Quality = NATIVE_BASELINE_QUALITY
// The JS ladder infers pressure from missed deadlines. Native iOS has the real
// ProcessInfo thermal state, so it can impose a ceiling before WebKit becomes
// slow enough for inference to notice. `fair` already means the phone is warm;
// decorative motion should be gone by then, not after serious throttling.
let nativeThermalCeiling: Quality = 3
// Native policy carries thermal, battery-saver and lifecycle decisions from
// the host. Keep its own baseline as a hard ceiling so the JS comfort ladder
// cannot silently promote a physical phone back to desktop FULL quality.
let nativePolicyCeiling: Quality = NATIVE_BASELINE_QUALITY
let powerSavingCeiling: Quality = 3
let memoryPressureCeiling: Quality = 3
let boostUntil = 0
// This gate does NOT hide or pause the visible screen. It retires only ambient
// decoration and Mapbox's already-settled renderer, preserving its last frame.
// The tab navigator has its own event-driven budget, so it can still react to
// tilt without keeping the rest of the document awake.
// Native decoration has a shared, non-renewable burst followed by a rest.
// Renewing a 15s idle timeout with every tap left it running for an entire
// active session. New bursts remain available after the rest; gestures and
// meaningful handset motion never depend on decorative motion being awake.
// Desktop retains the renewable 15s idle lease.
//
// The 3GB class is different, and this was measured, not assumed: on an A03 the
// ambient subscribers ARE the frame budget (map p50 57ms governed vs 250ms with
// decoration running, 100% janky). Flattening this to one lease for everyone
// regressed that device's map straight back to 250ms. So no-headroom hardware
// keeps the short lease AND the one-showcase kill: it gets the authored
// showcase once, then decoration stays parked and the frame budget goes to
// gestures. Other phones keep recurring bounded bursts.
const AMBIENT_IDLE_MS = LOW_TIER_DEVICE ? 2_000 : 15_000
let ambientAwakeUntil = typeof performance !== 'undefined'
  ? performance.now() + AMBIENT_IDLE_MS
  : Number.POSITIVE_INFINITY
let ambientSleepTimer = 0

const qualityListeners = new Set<(q: Quality) => void>()
const ambientSleepListeners = new Set<(sleeping: boolean) => void>()
let ambientSleeping = false
// Set the first time ambient decoration sleeps; only consulted on LOW_TIER.
let ambientShowcaseFinished = false

// ── arrival vs RETURN ────────────────────────────────────────────────────────
// A surface coming front for the first time is an ARRIVAL: it has nothing on
// screen yet, and the authored showcase — traffic, boats, the idle orbit — is
// the thing it arrived to show. Coming front again is a RETURN, and a return is
// a different event entirely: the camera has not moved, the tiles are resident,
// the style is built and `mapIdleSnapshot` is holding a pixel-accurate still of
// the exact frame the user left.
//
// setSurfaceFront treated both the same and granted a fresh AMBIENT_IDLE_MS
// lease either way, which is what made a return expensive (measured 21 Aug on
// the shipped bundle: ~5800ms of renderer CPU and ~290 Mapbox frames over 30s
// for a camera that never moved). Almost none of that was waking up. It was the
// decoration layer replaying its showcase: traffic is a SYMBOL layer over a
// GeoJSON source, so each 4Hz `setData` re-tiles the source, re-runs symbol
// placement, and every finished tile independently calls Map._update() ->
// triggerRepaint(). 52 traffic updates produced 728 tile loads and 781 of the
// window's 843 repaints, on a scene that was already composed and correct.
//
// So a return no longer buys a showcase. It buys exactly enough RENDERER time
// to replace the retained still with a live WebGL frame and park again — the
// governor already separates those two decisions (see rendererParked below),
// and a bounded managed operation is the primitive that un-parks the renderer
// without waking a single ambient subscriber. The first real touch runs
// wakeAmbient() through onGestureStart and the world comes back at full rate,
// which is the same bargain LOW_TIER hardware has always had.
//
// Long enough that a person who came back to look, and has not touched anything
// yet, is looking at the live canvas rather than at the retained still. It buys
// no extra frames: Mapbox is event-driven, so once the wake frame is painted
// and the map goes idle it draws nothing further for the rest of the lease —
// measured identical (one frame) at 500ms and at 2500ms.
const SURFACE_RESUME_RENDER_MS = 2_500
// "Has the showcase played?" is deliberately NOT just "has this surface ever
// been front". A React effect that re-runs tears down and re-establishes the
// front signal inside a single tick, and the performance manager can flip a
// renderer inactive and active again just as fast. Either would otherwise count
// as a completed visit and rob the real arrival of its showcase. Only a visit
// long enough for the showcase to actually have been watched counts.
const SHOWCASE_MIN_VISIT_MS = 3_000
let surfaceShowcasePlayed = false
// Zero means "no visit is being timed", and only a POSITIVELY observed front
// state starts the clock. Not a false->true edge: `surfaceFront` initialises to
// true ("assume front until a shell says otherwise"), so a document that mounts
// already-front never produces that edge and its first visit would go
// uncredited, handing the second visit a showcase it had already had. And not a
// module-init timestamp either: a shell that mounts the map hidden may take
// longer than SHOWCASE_MIN_VISIT_MS to boot and post front:false, which would
// credit a visit that never happened and rob the real first visit instead.
let surfaceFrontSince = 0

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
const MAX_MANAGED_OPERATION_MS = 45_000
let managedOperationUntil = 0
let managedOperationTimer = 0

function effectiveQualityCeiling(): Quality {
  if (GOVERNOR_DISABLED) return 3
  return Math.min(
    nativeThermalCeiling,
    nativePolicyCeiling,
    powerSavingCeiling,
    memoryPressureCeiling,
  ) as Quality
}

function interacting(): boolean {
  if (pointersDown > 0) return true
  return typeof performance !== 'undefined' && performance.now() < interactionUntil
}

export function managedRenderingOperationActive(): boolean {
  return typeof performance !== 'undefined' && performance.now() < managedOperationUntil
}

function setManagedOperation(durationMs: number): void {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return
  window.clearTimeout(managedOperationTimer)
  managedOperationTimer = 0
  const bounded = Number.isFinite(durationMs)
    ? Math.min(MAX_MANAGED_OPERATION_MS, Math.max(0, Math.ceil(durationMs)))
    : 0
  managedOperationUntil = bounded > 0 ? performance.now() + bounded : 0
  if (bounded > 0) {
    const expire = () => {
      const remaining = managedOperationUntil - performance.now()
      if (remaining > 0) {
        managedOperationTimer = window.setTimeout(expire, remaining + 5)
        return
      }
      managedOperationTimer = 0
      managedOperationUntil = 0
      syncRendererPark()
      sync()
    }
    managedOperationTimer = window.setTimeout(expire, bounded + 5)
  }
  syncRendererPark()
  sync()
}

function syncRendererPark(): void {
  const next = ambientSleeping && !interacting() && !managedRenderingOperationActive()
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
    sync()
  }, INTERACTION_TAIL_MS + 20)
  syncRendererPark()
  sync()
}

function setAmbientSleeping(sleeping: boolean): void {
  // With the governor off, decoration and tilt never sleep. Hidden-document
  // gating lives in shouldRun(), not here, so backgrounding still stops work.
  if (GOVERNOR_DISABLED && sleeping) return
  if (ambientSleeping === sleeping) return
  ambientSleeping = sleeping
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('poplur-ambient-sleep', sleeping)
  }
  ambientSleepListeners.forEach(listener => listener(sleeping))
  syncRendererPark()
  // An untouched document has no shared-clock wakeups. Direct input and
  // managed operations can restart their own subscribers during ambient rest.
  sync()
}

// ── rate table ───────────────────────────────────────────────────────────────
// Hz per rate class at each quality level.
//
// Interactive used to top out at 60, on the reasoning that dropping gesture
// tracking is the most visible possible regression so it should be the last
// thing to go. That reasoning is sound and it still lost: on a real iPhone,
// unplugged, this app reached `fair` after ~33 minutes of ordinary use and the
// owner was the post-login web surface. 60Hz is simply twice the per-second
// work of 30 for every gesture, on a device already carrying a 3D map, four
// WebGL widgets and video decoders.
//
// The ladder is kept — pressure must still be able to step down — but the
// ceiling is now 30. This is a deliberate trade of drag smoothness for heat,
// asked for explicitly after the phone stayed warm through every structural
// fix. Raising it back is one line, and should be done against a device soak
// rather than a gate pass: the gate measures an idle census and cannot see
// what a gesture costs.
const HZ: Record<Rate, [number, number, number, number]> = {
  //           q0  q1  q2  q3
  interactive: [20, 24, 30, 30],
  // Finite, explicitly requested media/VFX work. It is permitted through the
  // native ambient gate only while wakeManagedRendering owns a bounded lease,
  // and follows the public 10/15/24/30 policy rather than display refresh.
  managed:     [10, 15, 24, 30],
  // Ambient decoration must have a hard energy ceiling even on a phone that
  // can still hit every deadline. Waiting for thermal throttling before
  // reducing it means the device is already hot. Twenty frames is enough for
  // slow clay drift; the interactive boost still gives a gesture 60.
  ambient:     [5,  10, 15, 20],
  idle:        [1,   2,  3,  4],
}

/** Interval this subscriber should be called at under the current quality, in ms. */
function intervalFor(sub: Sub): number {
  if (sub.everyMs !== undefined) return sub.everyMs
  // Governor off: visible motion runs at display-class rate, no ambient cap.
  // Ticks keep their named deadlines and idle housekeeping stays slow.
  if (GOVERNOR_DISABLED && (sub.rate === 'interactive' || sub.rate === 'ambient' || sub.rate === 'managed')) {
    return 1000 / 60
  }
  const hz = HZ[sub.rate][quality]
  // A boost promotes ambient work to interactive rate: while a finger is down,
  // parallax and drift should track the gesture, not stutter behind it.
  if (sub.rate === 'ambient' && performance.now() < boostUntil) {
    return 1000 / HZ.interactive[quality]
  }
  return 1000 / hz
}

/**
 * Whether this shared-clock subscriber is currently gated off.
 *
 * `rendererParked` is a strict subset of ambient sleep — it additionally
 * requires that no finger is down — so gating on the sleep flag alone honours
 * both signals with one test.
 *
 * `onFrame` must obey this too. Leaving non-tick subscribers eligible kept the
 * governor's timer/rAF pair alive after ambient sleep just to invoke callbacks
 * such as `animateFlyers`, whose own guards immediately returned. A static
 * screen should have zero shared-clock wakeups, not a low-frequency no-op loop.
 *
 * This is also the bargain of `onTick` over `setInterval`: a raw interval keeps
 * firing on a phone nobody is touching, which is exactly where sustained work
 * is pure heat.
 */
function subscriberWorkPaused(sub: Sub): boolean {
  if (!ambientSleeping) return false
  if (sub.rate === 'managed') return !managedRenderingOperationActive()
  // A finite camera/navigation operation may keep attended work alive, but it
  // never re-enables ambient or idle decoration while the thermal gate is shut.
  return sub.rate !== 'interactive'
    || (!interacting() && !managedRenderingOperationActive())
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
  for (const s of subs) {
    // Gated work is not asking for any deadline. In normal operation shouldRun
    // stops the clock outright; this guard also covers a sleep transition that
    // lands during an already-scheduled frame.
    if (subscriberWorkPaused(s)) continue
    fastest = Math.min(fastest, intervalFor(s))
  }
  return fastest === Infinity ? 1000 / 30 : fastest
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function setQuality(next: Quality) {
  // A ceiling must remain a ceiling while the screen is visible. The previous
  // foreground exception forced every active phone back to FULL and defeated
  // native thermal, low-power, memory and missed-frame responses precisely
  // while the expensive work was on screen.
  const bounded = Math.min(next, effectiveQualityCeiling()) as Quality
  if (bounded === quality) return
  quality = bounded
  intervals.length = 0
  overrunStreak = 0
  comfortStreak = 0
  qualityListeners.forEach(fn => fn(quality))
}

function sampleThermals(dt: number) {
  if (GOVERNOR_DISABLED) return
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
    if (subscriberWorkPaused(s)) {
      // Resume with a beat rather than a backlog: zeroing `last` makes the
      // first frame after the gate reopens fire once, immediately, instead of
      // either replaying the whole sleep or waiting out another full period.
      s.last = 0
      continue
    }
    const interval = intervalFor(s)
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
  if (!surfaceFront || document.hidden || subs.size === 0) return false
  // Ambient sleep is a hard clock gate. A low-frequency `onFrame` subscriber
  // is still a recurring main-thread/display wakeup, even when its callback has
  // nothing visible to do. Input wakes the ambient gate before work resumes.
  for (const sub of subs) {
    if (!subscriberWorkPaused(sub)) return true
  }
  return false
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
  // Declares the switch to anything measuring this build — the thermal gate
  // reads it to tell "deliberately ungoverned" from "idle machinery broke".
  if (GOVERNOR_DISABLED) document.documentElement.dataset.poplurGovernor = 'off'
  const sleepAmbient = () => {
    window.clearTimeout(ambientSleepTimer)
    ambientSleepTimer = 0
    ambientAwakeUntil = 0
    ambientShowcaseFinished = true
    setAmbientSleeping(true)
  }
  const ambientLeaseMs = () => {
    const ceiling = effectiveQualityCeiling()
    if (ceiling <= 1) return 0
    return AMBIENT_IDLE_MS
  }
  const wakeAmbient = () => {
    if (document.hidden || !surfaceFront) {
      sleepAmbient()
      return
    }
    // No-headroom hardware gets the authored showcase once and then keeps its
    // frames for gestures; later touches wake the renderer's direct-gesture
    // window, not traffic, weather, boats and every other ambient subscriber.
    if (LOW_TIER_DEVICE && ambientShowcaseFinished && !managedRenderingOperationActive()) {
      sleepAmbient()
      return
    }
    const lease = ambientLeaseMs()
    if (lease <= 0) {
      sleepAmbient()
      return
    }
    const deadline = isNativeShell()
      ? nativeAmbientDeadline(lease)
      : performance.now() + lease
    if (!deadline) {
      sleepAmbient()
      return
    }
    ambientAwakeUntil = deadline
    setAmbientSleeping(false)
    window.clearTimeout(ambientSleepTimer)
    ambientSleepTimer = window.setTimeout(sleepAmbient, Math.max(0, deadline - performance.now()))
    boostFrames()
  }
  const onVisibility = () => {
    document.documentElement.dataset.poplurSurfaceFront = !document.hidden && surfaceFront ? '1' : '0'
    if (document.hidden || !surfaceFront) sleepAmbient()
    else wakeAmbient()
    sync()
  }

  // Input keeps the renderer responsive through the gesture and a short tail.
  // The ambient lease may expire afterward, but that only parks internal map
  // work behind its retained frame; it never hides or freezes the visible UI.
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
    if (GOVERNOR_DISABLED) return
    const state = typeof raw === 'string'
      ? raw.toLowerCase()
      : typeof raw === 'object' && raw
        ? String((raw as { state?: unknown }).state ?? '').toLowerCase()
        : ''
    if (!state) return

    const previousCeiling = effectiveQualityCeiling()
    nativeThermalCeiling = state === 'critical' || state === 'serious'
      ? 0
      : state === 'fair'
        ? 1
        : 3
    document.documentElement.dataset.poplurThermal = state
    const nextCeiling = effectiveQualityCeiling()
    if (quality > nextCeiling) setQuality(nextCeiling)
    if (nextCeiling < 2) {
      sleepAmbient()
    } else if (previousCeiling < 2) {
      // Recover conservatively: native has returned to nominal, but jumping
      // straight from survival to every effect can heat it again immediately.
      setQuality(2)
      if (surfaceFront && !document.hidden) wakeAmbient()
    }
  }
  const applyNativePolicy = (raw: unknown) => {
    if (GOVERNOR_DISABLED) return
    const payload = typeof raw === 'object' && raw
      ? ('policy' in raw && typeof (raw as { policy?: unknown }).policy === 'object'
          ? (raw as { policy: Record<string, unknown> }).policy
          : raw as Record<string, unknown>)
      : null
    const mode = String(payload?.mode ?? '').toLowerCase().replace('-', '_')
    if (!mode) return

    const previousCeiling = effectiveQualityCeiling()
    const active = payload?.active
    nativePolicyCeiling = active === false
      ? 0
      : mode === 'emergency'
        ? 0
        : mode === 'low_power' || mode === 'lowpower'
          ? 0
          : mode === 'reduced'
            ? 1
            : 2
    document.documentElement.dataset.poplurPerformanceMode = mode
    const nextCeiling = effectiveQualityCeiling()
    if (quality > nextCeiling) setQuality(nextCeiling)
    if (nextCeiling < 2) {
      sleepAmbient()
    } else if (previousCeiling < 2) {
      // Cooling recovery is gradual. Native FULL still means the phone's cool
      // baseline (quality 2), never the desktop-only quality 3 rung.
      setQuality(2)
      if (surfaceFront && !document.hidden) wakeAmbient()
    }
    sync()
  }
  window.addEventListener('poplur-native-thermal', event => {
    applyNativeThermal((event as CustomEvent).detail)
  })
  window.addEventListener('poplur-performance-policy', event => {
    applyNativePolicy((event as CustomEvent).detail)
  })
  window.addEventListener('poplur-performance', event => {
    applyNativePolicy((event as CustomEvent).detail)
  })
  window.addEventListener(MANAGED_RENDERING_OPERATION_EVENT, event => {
    const detail = (event as CustomEvent<{ durationMs?: unknown }>).detail
    setManagedOperation(Number(detail?.durationMs ?? 0))
  })
  window.addEventListener('message', event => {
    if (event.data?.type === 'poplur-native-thermal') applyNativeThermal(event.data)
    if (event.data?.type === 'poplur-native-performance-policy') applyNativePolicy(event.data)
  })
  const bootMode = document.documentElement.dataset.poplurPerformanceMode
  if (bootMode) applyNativePolicy({ mode: bootMode })
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
 * Subscribe periodic (non-animation) work to the shared clock, at a fixed
 * period. Returns an unsubscribe function. The drop-in shape of
 * `setInterval(cb, ms)` / `clearInterval`, with the governor's lifecycle.
 *
 * WHY THIS EXISTS. `onFrame` fixed the ~30 rAF loops, and the polling timers
 * then became the largest thing still running on an untouched screen. An
 * interval is worse than a rAF loop here, not better: it keeps its own
 * independent wake schedule, it does not stop when the page is hidden or the
 * surface goes behind another tab, and several of them at different periods
 * beat the main thread out of any alignment the OS could coalesce. Sub-second
 * ones are the ones that count — a handful at 120-1000ms wake the phone more
 * often, over a long idle, than any decoration does.
 *
 * WHAT YOU GET. One clock, so ticks land on frames already being scheduled.
 * Sleep when the page is hidden or the surface is not front. Pause on the
 * ambient/thermal gate, where the shared loop stops outright along with every
 * `onFrame` subscriber.
 *
 * WHAT YOU GIVE UP. The tick does not fire while the gate is closed, and it
 * resumes with a single immediate call rather than a replay of what it missed.
 * The test for whether work belongs here is therefore not "could this matter
 * while idle" but "would acting on it at the next touch be too late". Polling
 * and watchdogs generally pass — nobody is harmed by a stall that is fixed
 * before their finger lifts. Deadlines the user never has to be present for —
 * an upload retry, a session refresh, anything with a server on the other end —
 * do not, and belong on a plain timer at a period chosen to be cheap.
 *
 * `dtMs` is the time since THIS subscriber's previous call, so accumulating
 * work stays correct across a pause instead of assuming a fixed step.
 */
export function onTick(cb: (dtMs: number, now: number) => void, ms: number): () => void {
  const sub: Sub = { cb, rate: 'ambient', last: 0, everyMs: Math.max(0, ms) }
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
  if (effectiveQualityCeiling() <= 0) return
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
    if (front && surfaceFrontSince === 0) surfaceFrontSince = performance.now()
    document.documentElement.dataset.poplurSurfaceFront = front && !document.hidden ? '1' : '0'
    if (front && !document.hidden) {
      window.clearTimeout(ambientSleepTimer)
      const lease = effectiveQualityCeiling() <= 1
        ? 0
        : AMBIENT_IDLE_MS
      if (surfaceShowcasePlayed) {
        // A RETURN. Keep decoration asleep and hand the renderer a short,
        // bounded lease instead: it un-parks, Mapbox repaints the unchanged
        // camera once, the retained still is swapped out for the live canvas,
        // and the lease expires straight back into the parked state. No
        // source is mutated, so nothing re-tiles and nothing re-places.
        ambientAwakeUntil = 0
        setAmbientSleeping(true)
        ambientSleepTimer = 0
        if (lease > 0) setManagedOperation(SURFACE_RESUME_RENDER_MS)
      } else if (lease <= 0) {
        ambientAwakeUntil = 0
        setAmbientSleeping(true)
        ambientSleepTimer = 0
      } else {
        ambientAwakeUntil = isNativeShell()
          ? nativeAmbientDeadline(lease)
          : performance.now() + lease
        setAmbientSleeping(ambientAwakeUntil === 0)
        ambientSleepTimer = window.setTimeout(() => {
          ambientAwakeUntil = 0
          setAmbientSleeping(true)
        }, Math.max(0, ambientAwakeUntil - performance.now()))
      }
    } else {
      // A surface going away cannot leave a finger "down": the pointerup landed
      // somewhere else, and a stuck count would hold the renderer awake forever.
      pointersDown = 0
      interactionUntil = 0
      ambientAwakeUntil = 0
      setAmbientSleeping(true)
      window.clearTimeout(ambientSleepTimer)
      ambientSleepTimer = 0
      // Leaving is what makes the next arrival a return: whatever the showcase
      // had to say, it has now had a whole visit to say it.
      if (surfaceFrontSince > 0
        && performance.now() - surfaceFrontSince >= SHOWCASE_MIN_VISIT_MS) {
        surfaceShowcasePlayed = true
      }
      surfaceFrontSince = 0
    }
  }
  sync()
}

export function currentQuality(): Quality {
  return quality
}

/** Impose or release the OS power-saver ceiling. A power-saving device keeps
 * interactive UI usable but never spends above LOW_POWER on decoration. */
export function setPowerSavingMode(enabled: boolean): void {
  const previous = effectiveQualityCeiling()
  powerSavingCeiling = enabled ? 1 : 3
  const next = effectiveQualityCeiling()
  if (quality > next) setQuality(next)
  if (next < 2) {
    ambientAwakeUntil = 0
    setAmbientSleeping(true)
  } else if (previous < 2 && surfaceFront && !document.hidden) {
    // Recovery is permission to render on the next interaction, not a reason
    // to restart every ambient subscriber while the phone is untouched.
    setQuality(2)
  }
  sync()
}

/** Memory pressure is a rendering ceiling, not a pretend process RAM cap.
 * Cache/resource owners purge separately; this stops them immediately
 * rebuilding expensive decoration while the device is asking for relief. */
export function setMemoryPressure(level: 'normal' | 'warning' | 'critical'): void {
  const previous = effectiveQualityCeiling()
  memoryPressureCeiling = level === 'critical' ? 0 : level === 'warning' ? 1 : 3
  const next = effectiveQualityCeiling()
  if (quality > next) setQuality(next)
  if (next < 2) {
    ambientAwakeUntil = 0
    setAmbientSleeping(true)
  } else if (previous < 2 && surfaceFront && !document.hidden) {
    // Stay settled until a real gesture or managed operation needs rendering.
    setQuality(2)
  }
  sync()
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
 * The lease accounts for native thermal/power ceilings when it is granted.
 * A rest preserves the last rendered frame; direct manipulation has a separate
 * renderer lease so this signal must only gate autonomous decoration.
 */
export function ambientAllowed(): boolean {
  return surfaceFront
    && (typeof document === 'undefined' || !document.hidden)
    && (typeof performance === 'undefined' || performance.now() < ambientAwakeUntil)
}
