import { useEffect, type RefObject } from 'react'
import { playPop } from './pop'

/** Pull-to-refresh, the clay-mark bounce.
 *
 *  The mark drops in with the pull, squashes against it (taller and narrower
 *  the further you go, the way a soft object resists a push), then springs back
 *  past its resting point rather than easing into it. The overshoot on release
 *  is the whole feel — an ease-out reads as a page moving, a spring reads as
 *  something elastic you let go of.
 *
 *  Written against the DOM rather than React state on purpose: a re-render per
 *  pointermove would rebuild the grid under the finger. Transform and opacity
 *  only, no layout properties, so the gesture cannot cost a reflow — the same
 *  rule every animated layer in this app follows, and this one runs on the two
 *  surfaces whose heat is already watched.
 */
export function usePullToRefresh({ scrollRef, innerRef, markRef, spinClass, onRefresh, enabled = true }: {
  /** The element that actually scrolls; the gesture only starts at its top. */
  scrollRef: RefObject<HTMLElement | null>
  /** The content that travels down with the pull. */
  innerRef: RefObject<HTMLElement | null>
  /** The clay mark shown above the content. */
  markRef: RefObject<HTMLElement | null>
  /** Class that spins the mark while the refresh runs. */
  spinClass: string
  /** Re-read whatever this screen shows. May be async. */
  onRefresh: () => void | Promise<void>
  enabled?: boolean
}) {
  useEffect(() => {
    if (!enabled) return
    const scroll = scrollRef.current
    const inner = innerRef.current
    const mark = markRef.current
    if (!scroll || !inner || !mark) return

    // Distance the finger travels vs. distance the page moves. Below 1 so the
    // page feels attached to something rather than dragged freely.
    const RESIST = 0.55
    const MAX = 74
    const COMMIT = 46
    // Where the page rests while the refresh runs — far enough to show the
    // mark spinning, short enough not to hide the first row of content.
    const HOLD = 34
    // A refresh that returns instantly still shows the spin: a flash of
    // spinner reads as "nothing happened", which is the opposite of the truth.
    const MIN_SPIN = 700

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let pulling = false
    let startY = 0
    let pull = 0
    let busy = false
    let settleTimer = 0

    const draw = (spinning: boolean) => {
      inner.style.transform = `translateY(${pull}px)`
      const t = Math.min(1, pull / 52)
      mark.style.opacity = String(Math.min(1, t * 1.3))
      if (spinning) return
      // Grows in from nothing at the top of the content, travels down at half
      // the page's speed so it separates from the first row, and squashes as it
      // takes the load — taller, and narrower to keep its volume.
      const grow = 0.55 + t * 0.45
      mark.style.transform =
        `translateY(${pull * 0.5}px) scale(${(grow * (1 - t * 0.14)).toFixed(3)}, ${(grow * (1 + t * 0.3)).toFixed(3)})`
    }

    const springTo = (value: number, ms: number, done?: () => void) => {
      const ease = reduced ? 'ease' : 'cubic-bezier(0.2, 1.5, 0.4, 1)'
      inner.style.transition = `transform ${ms}ms ${ease}`
      mark.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ${ease}`
      pull = value
      draw(false)
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        inner.style.transition = ''
        mark.style.transition = ''
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
      draw(false)
      mark.classList.add(spinClass)
      const started = Date.now()
      const finish = () => {
        const wait = Math.max(0, MIN_SPIN - (Date.now() - started))
        window.setTimeout(() => {
          mark.classList.remove(spinClass)
          mark.style.transform = ''
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
        // spinner is worse than a refresh that quietly found nothing.
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
      mark.style.transition = ''
      mark.style.transform = ''
      mark.classList.remove(spinClass)
    }
  }, [scrollRef, innerRef, markRef, spinClass, onRefresh, enabled])
}
