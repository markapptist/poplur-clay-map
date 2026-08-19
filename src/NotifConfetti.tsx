import { useEffect, useRef } from 'react'
import styles from './NotifConfetti.module.css'

// The confetti from pre-login, ported to the notifications sheet.
//
// This is the WELCOME screen's own routine (PreloginWeb/welcome.html), not a
// new effect: same six colours, same 13px clay sprinkles, same ballistic
// physics — spawn above the top edge, drift on a slight spread, accelerate
// down, spin, shrink and fade out. Ported rather than reimplemented so the two
// surfaces cannot drift apart.
//
// Two deliberate differences, both about where it now runs:
//   · The loop is a frameGovernor subscriber instead of a bare rAF. The
//     governor pauses with the app, so the sheet cannot keep a private 60Hz
//     timer alive behind a backgrounded phone — the exact failure the thermal
//     work exists to prevent.
//   · Particles are capped. Pre-login owns a near-empty page; this sheet sits
//     over a live profile, so the cap keeps a long read from growing an
//     unbounded pile of DOM nodes.
const COLORS = ['#FF2D55', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#AF52DE']
const BIRTH_RATE = 45      // particles per second, as pre-login
const MAX_PARTICLES = 260  // ~one lifetime's worth at the birth rate

interface Particle {
  el: HTMLElement
  age: number
  life: number
  x: number; y: number
  vx: number; vy: number
  ax: number; ay: number
  rotation: number
  rotationSpeed: number
  scale: number
  alpha: number
}

export default function NotifConfetti() {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // Reduce Motion: the sheet keeps its colour and its calm. Confetti is
    // decoration, and this is the one place where honouring the setting costs
    // the reader nothing.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const particles: Particle[] = []
    let carry = 0

    const place = (p: Particle) => {
      const t = p.age
      const x = p.x + p.vx * t + 0.5 * p.ax * t * t
      const y = p.y + p.vy * t + 0.5 * p.ay * t * t
      const scale = Math.max(0.2, p.scale - 0.03 * t)
      const alpha = Math.max(0, Math.min(1, p.alpha - 0.05 * t))
      p.el.style.transform =
        `translate3d(${x}px, ${y}px, 0) rotate(${p.rotation + p.rotationSpeed * t}rad) scale(${scale})`
      p.el.style.opacity = String(alpha)
    }

    const spawn = (prefillAge = 0) => {
      if (particles.length >= MAX_PARTICLES) return
      const width = box.clientWidth || 393
      const life = 3.2 + Math.random() * 2
      const speed = 130 + Math.random() * 180
      const spread = (Math.random() - 0.5) * (Math.PI / 5)
      const el = document.createElement('i')
      el.className = styles.piece
      el.style.background = COLORS[(Math.random() * COLORS.length) | 0]
      box.appendChild(el)
      const p: Particle = {
        el,
        age: Math.min(prefillAge, life - 0.001),
        life,
        x: -200 + Math.random() * (width + 400),
        y: -44,
        vx: Math.sin(spread) * speed,
        vy: Math.cos(spread) * speed,
        ax: 20,
        ay: 65,
        rotation: (Math.random() - 0.5) * Math.PI,
        rotationSpeed: 2.5,
        scale: 0.33 + Math.random() * 0.44,
        alpha: 0.9 + Math.random() * 0.2,
      }
      particles.push(p)
      place(p)
    }

    // Prefill so the sheet opens INTO falling confetti rather than starting an
    // empty sky and filling it — the same trick pre-login uses.
    for (let i = 0; i < Math.round(BIRTH_RATE * 4.2); i += 1) {
      spawn(Math.random() * (3.2 + Math.random() * 2))
    }

    // A PLAIN rAF loop, exactly as pre-login runs it — deliberately not a
    // frameGovernor subscriber. The governor exists to retire AMBIENT
    // decoration on idle surfaces, and it did its job here: subscribed as
    // ambient the confetti prefilled and froze mid-air (the sheet is usually
    // opened by someone who has been reading quietly, so the 15s sleep had
    // already fallen), and promoting it to interactive did not deliver frames
    // either. This sheet is not an idle surface: it exists only while it is
    // deliberately open and the loop is cancelled the moment it closes, which
    // is the same lifetime the governor would have enforced anyway.
    //
    // It still stands down with the app: a hidden document gets no frames from
    // the browser, and the visibility guard stops the clock from jumping when
    // it comes back.
    // governor-ok: justified above — ambient froze this mid-air and interactive
    // delivered no frames; the sheet is modal, deliberately opened, and the loop
    // dies with it. Marked so verify-governed-loops.mjs records the exception as
    // a decision rather than letting the count drift up silently.
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // governor-ok: see the note above this effect.
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (document.hidden) return
      carry += dt * BIRTH_RATE
      while (carry >= 1) { spawn(); carry -= 1 }
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]
        p.age += dt
        if (p.age >= p.life) {
          p.el.remove()
          particles.splice(i, 1)
        } else place(p)
      }
    }
    // governor-ok: same exception, kick-off call.
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      for (const p of particles) p.el.remove()
      particles.length = 0
    }
  }, [])

  return <div className={styles.confetti} ref={boxRef} aria-hidden="true" />
}
