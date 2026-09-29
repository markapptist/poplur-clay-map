import { useEffect, type RefObject } from 'react'
import { playPop, primePopAudio } from './pop'

// The peek-a-boo cast: prebaked clay sprites already in the bundle (the same
// files the map's markers use — supplied art, never invented). One is drawn
// per PULL, along with the edge it peeks from, so the curtain is a little
// different every time you tug it.
const PEEK_SPRITES = [
  'sprites/poplur_mark_head_navigator_y0_p0_s640.png',
  'sprites/poplur_mark_head_navigator_y-16_p0_s640.png',
  'sprites/poplur_mark_head_navigator_y16_p0_s640.png',
  'sprites/poplur_pin_y0_p0_s256.png',
  'sprites/poplur_bell_y0_p12_s256.png',
  'sprites/boat_clay_y35_p6_s320.png',
  'sprites/poplur_camera_kodak_y0_p14_s320.png',
  'sprites/poplur_mic_y0_p0_s512.png',
] as const

// The 16-bit lap: while a refresh is in flight the Poplurgatchi pet sprints
// the band, two strides from the game's own sheet (cropped, never redrawn —
// see games/poplurgatchi/assets/sprite-sheet.webp).
const RUN_FRAMES = [
  'sprites/poplurgatchi_run_0.png',
  'sprites/poplurgatchi_run_1.png',
] as const
const STRIDE_MS = 150
// One full crossing fits inside the shortest possible busy window (MIN_BUSY +
// the closing spring): a quick refresh still reads as "the pet ran the lap",
// not "something poked out and gave up".
const LAP_MS = 1000

type PeekEdge = 'bottom' | 'left' | 'right' | 'top'
// The lip is still the star; the sides are the surprise; hanging upside-down
// from the top is the rare one that gets a laugh.
const PEEK_EDGES: PeekEdge[] = [
  'bottom', 'bottom', 'bottom', 'bottom',
  'left', 'left', 'right', 'right',
  'top',
]

/** Pull-to-refresh, the peeking-mark curtain.
 *
 *  Pulling reveals a solid clay sheet from under the top edge — the further
 *  you pull, the deeper the band — and the Poplur mark head rises over the
 *  band's bottom lip to watch you do it. Let go past the commit line and the
 *  band holds while the screen re-reads itself, the head bobbing; let go
 *  early and the whole curtain springs shut past its resting point. The
 *  overshoot is the feel: an ease-out reads as a page moving, a spring reads
 *  as something elastic you let go of.
 *
 *  Written against the DOM rather than React state on purpose: a re-render per
 *  pointermove would rebuild the grid under the finger. Transform and opacity
 *  only — the band is a fixed-height sheet parked at translateY(-100%) above
 *  the scroll clip and slid down, never a height that changes — so the gesture
 *  cannot cost a reflow. That matters doubly here: these are the two surfaces
 *  whose heat is already watched.
 */
export function usePullToRefresh({ scrollRef, innerRef, panelRef, headRef, busyClass, onRefresh, enabled = true }: {
  /** The element that actually scrolls; the gesture only starts at its top. */
  scrollRef: RefObject<HTMLElement | null>
  /** The content that travels down with the pull. */
  innerRef: RefObject<HTMLElement | null>
  /** The clay sheet revealed above the content. */
  panelRef: RefObject<HTMLElement | null>
  /** The mark head peeking over the sheet's bottom edge. */
  headRef: RefObject<HTMLElement | null>
  /** Class on the head while the refresh runs (bobs its inner img). */
  busyClass: string
  /** Re-read whatever this screen shows. May be async. */
  onRefresh: () => void | Promise<void>
  enabled?: boolean
}) {
  useEffect(() => {
    if (!enabled) return
    const scroll = scrollRef.current
    const inner = innerRef.current
    const panel = panelRef.current
    const head = headRef.current
    if (!scroll || !inner || !panel || !head) return

    // Distance the finger travels vs. distance the page moves. Below 1 so the
    // page feels attached to something rather than dragged freely.
    const RESIST = 0.55
    // Band depths. A shallow lip, not a wall: the head is the event and the
    // band is just the edge it leans over, so the deepest stretch stays under
    // a ninth of the phone and the grid never loses its first row.
    const MAX = 112
    const COMMIT = 68
    // Where the band rests while the refresh runs — the face clears the lip,
    // the band stays a lip.
    const HOLD = 78
    // A refresh that returns instantly still shows the head bobbing: a flash
    // of band reads as "nothing happened", which is the opposite of the truth.
    const MIN_BUSY = 700
    // The sprite crests this far into the pull — and that is also the pop:
    // the sound belongs to the character appearing, not to the finger moving.
    const CREST = 30

    // The news page's content starts below a wordmark reserve (its scroll
    // padding), so a band that only ever grows to `pull` left a strip of bare
    // paper between its lip and the masthead — the "gap when you pull too
    // much". The curtain OVERDRIVES to swallow that reserve: it slides
    // slightly faster than the finger and is flush with the content's real
    // top edge by the commit line. Measured, not configured, so profile (no
    // reserve) keeps a 1:1 curtain automatically.
    const reserve = (() => {
      const padding = parseFloat(getComputedStyle(scroll).paddingTop)
      return Number.isFinite(padding) ? padding : 0
    })()
    const bandDepth = (at: number) =>
      at <= 0 ? 0 : at + reserve * Math.min(1, at / COMMIT)

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let pulling = false
    let startY = 0
    let pull = 0
    let busy = false
    let settleTimer = 0
    let crested = false
    let edge: PeekEdge = 'bottom'

    const img = head.querySelector('img')

    // The runner lives here rather than in the consumers' markup so both
    // screens get the lap without their trees changing. Hidden except while
    // busy; transform-only via WAAPI so the lap stays on the compositor.
    const runner = document.createElement('img')
    runner.src = RUN_FRAMES[0]
    runner.alt = ''
    Object.assign(runner.style, {
      position: 'absolute',
      bottom: '8px',
      left: '0',
      height: '48px',
      width: 'auto',
      imageRendering: 'pixelated',
      display: 'none',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 3px 6px rgba(30, 0, 16, 0.35))',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(runner)
    const strideB = new Image()
    strideB.src = RUN_FRAMES[1]

    let runAnim: Animation | null = null
    let strideTimer = 0
    const startRun = () => {
      // The pet appears on EVERY pull. Reduce Motion used to skip this whole
      // function, so on a phone with that setting the character simply never
      // existed — the gesture looked broken rather than considerate. Honour the
      // setting the way it is meant to be honoured: show the character, drop
      // the MOTION (no sprint across the band, no stride flipping).
      if (runAnim) return
      runner.style.display = 'block'
      if (reduced) {
        // Parked mid-band, facing the reader. Still the pet, still every pull.
        runner.style.transform = `translateX(${Math.round(panel.clientWidth / 2 - 24)}px)`
        return
      }
      // Enter from past the left edge, exit past the right, loop.
      const lap = panel.clientWidth + 96
      runAnim = runner.animate(
        [{ transform: 'translateX(-64px)' }, { transform: `translateX(${lap}px)` }],
        { duration: LAP_MS, iterations: Infinity, easing: 'linear' },
      )
      let stride = 0
      strideTimer = window.setInterval(() => {
        stride ^= 1
        runner.src = RUN_FRAMES[stride]
      }, STRIDE_MS)
    }
    const stopRun = () => {
      runAnim?.cancel()
      runAnim = null
      window.clearInterval(strideTimer)
      runner.style.display = 'none'
      runner.style.transform = ''
      runner.src = RUN_FRAMES[0]
    }

    /** Where the peeker sits for a given progress t on the chosen edge. The
        wrapper carries these inline; the img inside carries the busy bob, so
        the two never fight (same split the spin-era code used). */
    const peekTransform = (t: number, depth: number) => {
      const hide = 96 - t * 62 // % of its own size still outside the band
      switch (edge) {
        case 'left': return `translate(-${hide.toFixed(1)}%, 0) rotate(${((1 - t) * 10).toFixed(1)}deg)`
        case 'right': return `translate(${hide.toFixed(1)}%, 0) rotate(${((1 - t) * -10).toFixed(1)}deg)`
        // Hanging upside-down from the top of the band: ride up the full band
        // depth (px), then drop back into view by its own height (%).
        case 'top': return `translateY(calc(${(-depth).toFixed(1)}px + ${(t * 62).toFixed(1)}%)) rotate(176deg)`
        default: return `translateY(${hide.toFixed(1)}%) rotate(${((1 - t) * -8).toFixed(1)}deg)`
      }
    }

    const draw = (holding: boolean) => {
      inner.style.transform = `translateY(${pull}px)`
      // The sheet is its own full height above the clip; sliding it down
      // shows exactly `bandDepth(pull)` pixels of band — the overdrive keeps
      // its lip flush with the content's true top edge, reserve and all.
      const depth = bandDepth(pull)
      panel.style.transform = `translate3d(0, calc(${depth.toFixed(1)}px - 100%), 0)`
      if (holding) return
      head.style.transform = peekTransform(Math.min(1, pull / COMMIT), depth)
    }

    const springTo = (value: number, ms: number, done?: () => void) => {
      const ease = reduced ? 'ease' : 'cubic-bezier(0.2, 1.5, 0.4, 1)'
      inner.style.transition = `transform ${ms}ms ${ease}`
      panel.style.transition = `transform ${ms}ms ${ease}`
      head.style.transition = `transform ${ms}ms ${ease}`
      pull = value
      draw(false)
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        inner.style.transition = ''
        panel.style.transition = ''
        head.style.transition = ''
        done?.()
      }, ms + 20)
    }

    const onDown = (event: PointerEvent) => {
      if (busy || scroll.scrollTop > 0) return
      // iOS keeps a fresh AudioContext suspended until a user gesture touches
      // it, and playPop's resume is asynchronous — so without this the pop for
      // this very gesture is dropped. HoldMenuTwin primes on its pointerdown
      // for exactly this reason; the pull surfaces never did, which is why the
      // curtain was silent on a phone while sounding fine in a desktop browser.
      primePopAudio()
      pulling = true
      startY = event.clientY
      crested = false
      // Cast the peeker for THIS pull: who shows up, and from which edge of
      // the curtain, changes every time — that is the whole joke.
      edge = PEEK_EDGES[Math.floor(Math.random() * PEEK_EDGES.length)]
      head.dataset.edge = edge
      if (img) img.src = PEEK_SPRITES[Math.floor(Math.random() * PEEK_SPRITES.length)]
    }

    const onMove = (event: PointerEvent) => {
      if (!pulling) return
      const dy = event.clientY - startY
      pull = dy > 0 ? Math.min(MAX, dy * RESIST) : 0
      draw(false)
      // The pop belongs to the character cresting the curtain, once per pull.
      if (!crested && pull >= CREST) {
        crested = true
        // Every pull gets the pet, not just a committed one: it crests with
        // the sound, runs while you decide, and leaves with the curtain.
        startRun()
      }
    }

    const onUp = () => {
      if (!pulling) return
      pulling = false
      if (pull <= COMMIT) {
        springTo(0, 300, stopRun)
        return
      }
      busy = true
      playPop(0.6, 'refresh')
      pull = HOLD
      // Hold the band; the peeker keeps the spot it earned on its edge and
      // its inner img takes over with the bob — inline transform and
      // keyframes would fight on the same element, so they live one level
      // apart.
      draw(true)
      head.style.transform = peekTransform(1, bandDepth(HOLD))
      head.classList.add(busyClass)
      startRun()
      const started = Date.now()
      const finish = () => {
        const wait = Math.max(0, MIN_BUSY - (Date.now() - started))
        window.setTimeout(() => {
          head.classList.remove(busyClass)
          // The pet finishes its lap as the curtain lets go — cancelling with
          // the spring keeps the exit tied to the band, not to a lap count.
          springTo(0, 340, () => { busy = false })
          stopRun()
        }, wait)
      }
      try {
        const result = onRefresh()
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).then(finish, finish)
        } else finish()
      } catch {
        // A refresh that throws must still let go of the page — a stuck
        // curtain is worse than a refresh that quietly found nothing.
        finish()
      }
    }

    // iOS ONLY LOOKS BROKEN HERE — and it looks like "the refresh does nothing".
    //
    // WebKit's own scroller claims a downward drag that starts at the top and
    // fires `pointercancel`, which this hook (correctly) treats as a release.
    // With almost no travel recorded, that release lands under COMMIT: the
    // curtain springs shut, onRefresh is never called, and the page reprints
    // nothing. A desktop browser never does this, so every headless check
    // passes while the phone refuses to refresh.
    //
    // Claiming the gesture is the fix: while a pull is genuinely in progress,
    // preventDefault the touchmove so the native scroller stands down and the
    // pointer stream survives to pointerup. Registered non-passive, because a
    // passive listener is forbidden from calling preventDefault at all — the
    // default for touchmove on many engines, which is exactly why this needs
    // saying out loud.
    const onTouchMove = (event: TouchEvent) => {
      if (pulling && pull > 0 && event.cancelable) event.preventDefault()
    }

    scroll.addEventListener('pointerdown', onDown)
    scroll.addEventListener('pointermove', onMove)
    scroll.addEventListener('pointerup', onUp)
    scroll.addEventListener('pointercancel', onUp)
    scroll.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      scroll.removeEventListener('pointerdown', onDown)
      scroll.removeEventListener('pointermove', onMove)
      scroll.removeEventListener('pointerup', onUp)
      scroll.removeEventListener('pointercancel', onUp)
      scroll.removeEventListener('touchmove', onTouchMove)
      window.clearTimeout(settleTimer)
      stopRun()
      runner.remove()
      inner.style.transition = ''
      inner.style.transform = ''
      panel.style.transition = ''
      panel.style.transform = ''
      head.style.transition = ''
      head.style.transform = ''
      head.classList.remove(busyClass)
    }
  }, [scrollRef, innerRef, panelRef, headRef, busyClass, onRefresh, enabled])
}
