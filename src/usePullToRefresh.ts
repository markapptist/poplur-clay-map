import { useEffect, type RefObject } from 'react'
import { playPop } from './pop'

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
    // Band depths, sized to the reference: the sheet reads as a real place the
    // head lives, not a sliver — roughly a sixth of the phone at full stretch.
    const MAX = 150
    const COMMIT = 88
    // Where the band rests while the refresh runs — deep enough for the whole
    // face, shallow enough that the first row of content stays in sight.
    const HOLD = 104
    // A refresh that returns instantly still shows the head bobbing: a flash
    // of band reads as "nothing happened", which is the opposite of the truth.
    const MIN_BUSY = 700

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let pulling = false
    let startY = 0
    let pull = 0
    let busy = false
    let settleTimer = 0

    const draw = (holding: boolean) => {
      inner.style.transform = `translateY(${pull}px)`
      // The sheet is its own full height above the clip; sliding it down by
      // the pull shows exactly `pull` pixels of band. calc() keeps this true
      // whatever height the stylesheet gives it.
      panel.style.transform = `translate3d(0, calc(${pull}px - 100%), 0)`
      if (holding) return
      // The head climbs the band's bottom lip as the pull deepens: scalp
      // first, whole face by the commit line, with the last of its lean
      // straightening out as it arrives.
      const t = Math.min(1, pull / COMMIT)
      const rise = 96 - t * 62 // % of its own height still hidden below the lip
      head.style.transform = `translateY(${rise.toFixed(1)}%) rotate(${((1 - t) * -8).toFixed(1)}deg)`
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
      pulling = true
      startY = event.clientY
    }

    const onMove = (event: PointerEvent) => {
      if (!pulling) return
      const dy = event.clientY - startY
      pull = dy > 0 ? Math.min(MAX, dy * RESIST) : 0
      draw(false)
    }

    const onUp = () => {
      if (!pulling) return
      pulling = false
      if (pull <= COMMIT) {
        springTo(0, 300)
        return
      }
      busy = true
      playPop()
      pull = HOLD
      // Hold the band; the head keeps the rise it earned and its inner img
      // takes over with the bob — inline transform and keyframes would fight
      // on the same element, so they live one level apart.
      draw(true)
      head.style.transform = 'translateY(34%)'
      head.classList.add(busyClass)
      const started = Date.now()
      const finish = () => {
        const wait = Math.max(0, MIN_BUSY - (Date.now() - started))
        window.setTimeout(() => {
          head.classList.remove(busyClass)
          springTo(0, 340, () => { busy = false })
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

    scroll.addEventListener('pointerdown', onDown)
    scroll.addEventListener('pointermove', onMove)
    scroll.addEventListener('pointerup', onUp)
    scroll.addEventListener('pointercancel', onUp)
    return () => {
      scroll.removeEventListener('pointerdown', onDown)
      scroll.removeEventListener('pointermove', onMove)
      scroll.removeEventListener('pointerup', onUp)
      scroll.removeEventListener('pointercancel', onUp)
      window.clearTimeout(settleTimer)
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
