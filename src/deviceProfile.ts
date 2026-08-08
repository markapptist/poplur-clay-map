// On-device heat probe.
//
// Why this exists: every measurement I can take on the Mac is headless Chrome,
// and Chrome's compositor is not WebKit's — a change that moves nothing in
// Chrome can still be what heats the phone, and vice versa. The device CPU
// trace that WOULD settle it cannot be read here: `xctrace export` segfaults on
// this machine on every path (matching the xctrace crash reports already in
// ~/Library/Logs/DiagnosticReports).
//
// So the page measures itself on the real device and prints it, and the line is
// read back with `devicectl device process launch --console`.
//
// It must not become part of the problem it is measuring:
//   - NO requestAnimationFrame loop. A rAF probe keeps the compositor awake and
//     would manufacture the very cost it claims to observe.
//   - PerformanceObserver('longtask') is passive — the browser reports blocking
//     work that already happened, at zero cost when nothing is blocking.
//   - One setInterval, and only while enabled.
// Long-task total-blocking-time is the honest heat proxy: it is main-thread
// time the page could not yield, which is exactly what a phone burns power on.

import { postNativeEvent } from './nativeBridge'
import { audioGateDebug } from './audioGate'

const INITIAL_REPORT_MS = 5000
const SETTLED_REPORT_MS = 30_000
const SETTLED_AFTER_MS = 60_000
let previousMapRenders = 0
let previousMapRenderAt = typeof performance === 'undefined' ? 0 : performance.now()

function mapRenderRate(): string {
  const total = (window as typeof window & { __poplurMapRenderCount?: number })
    .__poplurMapRenderCount
  if (typeof total !== 'number') return 'n/a'
  const now = performance.now()
  const seconds = Math.max(0.001, (now - previousMapRenderAt) / 1000)
  const delta = Math.max(0, total - previousMapRenders)
  previousMapRenders = total
  previousMapRenderAt = now
  return `${(delta / seconds).toFixed(1)}fps(${delta})`
}

/** Name every animation the compositor is still driving, deduped. The device
    CPU trace blamed per-frame style recalc (createAnimatedElementUpdate) on
    the idle map; the count alone cannot say WHICH animation, so name each one:
    keyframe name (or transition property), first class of its target, and ∞
    when it loops forever — an infinite animation on an idle screen is free
    heat. Runs on the 5s report beat, no observers of its own. */
function animCensus(): string {
  try {
    const seen = new Map<string, number>()
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue
      const eff = a.effect instanceof KeyframeEffect ? a.effect : null
      const target = eff?.target instanceof HTMLElement ? eff.target : null
      const name = (a as CSSAnimation).animationName
        || (a as CSSTransition).transitionProperty
        || a.constructor.name
      const cls = target
        ? `${target.tagName.toLowerCase()}.${String(target.className).split(' ')[0] || '-'}`.slice(0, 44)
        : '?'
      const forever = eff?.getTiming().iterations === Infinity ? '∞' : ''
      const key = `${name}${forever}@${cls}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    if (seen.size === 0) return 'none'
    return [...seen].map(([k, n]) => (n > 1 ? `${k}x${n}` : k)).join(' ')
  } catch { return 'n/a' }
}

interface Bucket { count: number; total: number; worst: number }

function summarise(bucket: Bucket): string {
  if (bucket.count === 0) return 'none'
  return `${bucket.count} tasks / ${Math.round(bucket.total)}ms blocked / worst ${Math.round(bucket.worst)}ms`
}

/** What is mounted right now — the cheap structural counts, not a full walk. */
function surfaces(): string {
  const canvases = document.querySelectorAll('canvas').length
  const videos = [...document.querySelectorAll('video')]
  const playing = videos.filter(v => !v.paused).length
  const iframes = document.querySelectorAll('iframe').length
  // getAnimations() is the reliable way to see what the compositor is actually
  // still driving — an infinite CSS animation nobody remembers is free heat.
  let running = 0
  try { running = document.getAnimations().filter(a => a.playState === 'running').length } catch { /* older WebKit */ }
  // Which perf tiers are ACTUALLY applied. Everything above assumed `perf-lite`
  // was on in the app shell (it is what strips the full-screen filter off the
  // playing feed video); that assumption was never checked on the device.
  const tiers = document.documentElement.className || '(none)'
  // The single most expensive thing this app can do is filter a full-screen
  // PLAYING video — every decoded frame gets re-filtered on the GPU. Report it
  // directly rather than inferring it from the tier classes.
  let filteredVideo = 'n/a'
  let drops = 'n/a'
  const video = document.querySelector('video')
  if (video) {
    const cs = getComputedStyle(video)
    filteredVideo = cs.filter && cs.filter !== 'none' ? `YES(${cs.filter})` : 'no'
    // "No sound" has an obvious candidate that has nothing to do with the native
    // audio session: the feed video AUTOPLAYS MUTED on purpose (iOS blocks
    // unmuted autoplay) and is supposed to unmute on the first gesture. If that
    // unmute never lands, the video plays silently forever and every native
    // audio setting looks perfectly healthy. Report it rather than infer it.
    filteredVideo += ` muted=${video.muted} vol=${video.volume.toFixed(2)}`
    // "Skipping" as a NUMBER rather than a report. droppedVideoFrames is the
    // decoder saying it could not keep up — it separates "the GPU/decoder is
    // drowning" from "something else stutters and the video is fine". Also
    // report waiting/stalled counts, because a video that keeps re-buffering
    // looks identical to a dropping one from the sofa.
    try {
      const q = video.getVideoPlaybackQuality?.()
      const total = q ? (q.totalVideoFrames || 0) : 0
      const dropped = q ? (q.droppedVideoFrames || 0) : 0
      const now = performance.now()
      const wallSec = prevWallClock ? (now - prevWallClock) / 1000 : 0
      const dFrames = total - prevFrames
      const dTime = video.currentTime - prevTime
      prevFrames = total; prevTime = video.currentTime; prevWallClock = now

      // THE question this answers: when the picture freezes, is playback itself
      // suspended, or is decode fine and only presentation stuck?
      //   dTime ~0 and dFrames 0 -> playback suspended (something paused it)
      //   dTime advancing but dFrames 0 -> decode/present stalled while the
      //     media clock ran on, i.e. the compositor never got new frames
      const frozen = wallSec > 1 && dFrames === 0
      const verdict = frozen
        ? (dTime > 0.5 ? ' FREEZE(present)' : ' FREEZE(playback-suspended)')
        : ''
      drops = `${dropped}/${total} rs=${video.readyState} stalls=${stallCount}`
        + ` dFrames=${dFrames} dTime=${dTime.toFixed(2)}s`
        + ` fps=${wallSec > 0 ? (dFrames / wallSec).toFixed(1) : '?'}`
        + ` paused=${video.paused} rate=${video.playbackRate}`
        + ` play/pause=${playCount}/${pauseCount} seeks=${seekCount} rateCh=${rateChanges}`
        + (lastPauseStack ? ` pausedBy[${lastPauseStack}]` : '')
        + verdict
      playCount = 0; pauseCount = 0; seekCount = 0; rateChanges = 0; lastPauseStack = ''
    } catch { /* not implemented everywhere */ }
  }
  // One-shot: what is ACTUALLY on screen in WebKit. Chrome shows exactly one
  // stat card (the other at opacity 0) while the device shows both stacked, so
  // the difference has to be read on the phone rather than inferred from a
  // headless run that disagrees. Also reports the loaded bundle hash, which
  // settles "is this even the build I just installed?" without another guess.
  let cards = 'n/a'
  try {
    const found = [...document.querySelectorAll('[class*=statCard]')].map(c => {
      const cs = getComputedStyle(c)
      const r = c.getBoundingClientRect()
      const cls = String((c as HTMLElement).className)
      return `${cls.includes('Out') ? 'OUT' : 'IN '}op=${cs.opacity}`
        + ` y=${Math.round(r.y)} vis=${cs.visibility}`
        + ` "${(c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22)}"`
    })
    const script = [...document.querySelectorAll('script[src]')]
      .map(el => (el as HTMLScriptElement).src.split('/').pop())
      .filter(n => n && n.startsWith('index-'))[0] || '?'
    cards = `bundle=${script} n=${found.length} :: ${found.join(' | ')}`
  } catch { /* probe is never load-bearing */ }

  return `canvas=${canvases} video=${videos.length}(${playing} playing) iframe=${iframes} anim=${running}`
    + ` mapDraw=${mapRenderRate()}`
    + ` tiers=[${tiers}] videoFiltered=${filteredVideo} drops=${drops}`
    + ` | STAT ${cards}`
    + ` | ANIM ${animCensus()} | AUDIO ${audioGateDebug()}`
    + ` idle=${String((window as unknown as { __poplurChromeIdle?: boolean }).__poplurChromeIdle ?? '?')}`
}

/** Re-buffering looks exactly like frame-dropping to the eye, so count it too. */
let stallCount = 0

// Who is stopping the video?
//
// The feed video's media clock advances only ~2.6s per 5.0s of wall clock, with
// `paused=false`, `drops=0`, `stalls=0`, `rs=4` — every health metric says fine
// while the picture visibly stutters. When it DOES advance it decodes a clean
// 30fps, so it is not slow, it is being stopped and restarted. FeedTwin calls
// `video.pause()` behind a suppression flag, so the suspicion is app code
// toggling it — but suspicion is not evidence. These counters name the culprit:
// if `pause` fires repeatedly the app is doing it; if it does not, WebKit is
// throttling us and the fix is somewhere else entirely.
let playCount = 0
let pauseCount = 0
let rateChanges = 0
let seekCount = 0
let lastPauseStack = ''

// Per-interval deltas. The totals alone hid the actual defect: frames climbed
// overall while standing completely still for one whole 5s window (654 -> 654)
// with drops=0 and stalls=0. Totals cannot show that; deltas can.
let prevFrames = 0
let prevTime = 0
let prevWallClock = 0
function watchStalls(): void {
  const attach = () => {
    for (const v of document.querySelectorAll('video')) {
      if ((v as HTMLVideoElement & { __stallWatched?: boolean }).__stallWatched) continue
      ;(v as HTMLVideoElement & { __stallWatched?: boolean }).__stallWatched = true
      for (const type of ['waiting', 'stalled']) {
        v.addEventListener(type, () => { stallCount += 1 })
      }
      v.addEventListener('play', () => { playCount += 1 })
      v.addEventListener('ratechange', () => { rateChanges += 1 })
      v.addEventListener('seeking', () => { seekCount += 1 })
      v.addEventListener('pause', () => {
        pauseCount += 1
        // A pause raised by app code carries our own frames in the stack; one
        // raised by the engine does not. That is the whole question, so capture
        // it rather than guess. Trimmed hard — this rides a 5s log line.
        try {
          const stack = (new Error().stack || '').split('\n').slice(2, 5)
            .map(s => s.trim().replace(/^at\s+/, '').slice(0, 60)).join(' <- ')
          if (stack) lastPauseStack = stack
        } catch { /* stacks are best-effort */ }
      })
    }
  }
  attach()
  // The feed swaps video elements as channels change, so re-attach periodically.
  window.setInterval(attach, 15_000)
}

export function startDeviceProfile(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return
  const profiledWindow = window as typeof window & { __poplurDeviceProfileStarted?: boolean }
  if (profiledWindow.__poplurDeviceProfileStarted) return
  profiledWindow.__poplurDeviceProfileStarted = true
  watchStalls()

  const bucket: Bucket = { count: 0, total: 0, worst: 0 }
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        bucket.count += 1
        bucket.total += entry.duration
        if (entry.duration > bucket.worst) bucket.worst = entry.duration
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    // Safari/WKWebView did not ship longtask everywhere; the surface counts below
    // are still worth having, so do not bail out entirely.
  }

  let elapsedMs = 0
  const report = () => {
    const interval = elapsedMs < SETTLED_AFTER_MS ? INITIAL_REPORT_MS : SETTLED_REPORT_MS
    elapsedMs += interval
    const line = `[PoplurProfile ${elapsedMs / 1000}s] blocking=${summarise(bucket)} | ${surfaces()}`
    // A WKWebView's console.log goes to Web Inspector, NOT to the app's stdout —
    // so a probe that only console.logs is invisible to `devicectl --console`,
    // which is the whole point of running it on the device. Push it across the
    // existing `poplur` bridge so Swift can print it where it can be read.
    const posted = postNativeEvent({ type: 'profile', line })
    // Native already prints bridged reports. Logging the same long census to
    // WebKit as well doubled console traffic on device for no added evidence.
    if (!posted) console.log(line) // eslint-disable-line no-console
    bucket.count = 0
    bucket.total = 0
    bucket.worst = 0
    window.setTimeout(report, elapsedMs < SETTLED_AFTER_MS ? INITIAL_REPORT_MS : SETTLED_REPORT_MS)
  }
  window.setTimeout(report, INITIAL_REPORT_MS)
}
