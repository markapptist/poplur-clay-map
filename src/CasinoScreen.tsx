import React, { useEffect, useRef, useState } from 'react'
import styles from './CasinoScreen.module.css'
import { playPop } from './pop'
import { creditBalance, grantCasinoWin, onCreditsChange } from './poplurCredits'

// POPLUR CASINO — the feed's daily slots channel. One free spin a day; the
// middle line pays, and wins land in the poplurCredits ledger (the same one
// the avatar cube spends from and the wallet windows onto — never a second
// balance).
//
// This pass is deliberately client-side: the outcome is rolled on-device and
// the daily gate is device-local storage. The casino spec's server-
// authoritative economy (server-rolled outcomes, per-account gating,
// anti-cheat) replaces both when the wallet backend lands — until then the
// most a clock-tamperer can mint is a few credits on their own screen.
//
// Idle discipline (this codebase has burned phones before): the reels move
// ONLY during a spin, driven by one-shot CSS transitions — no rAF loop, no
// infinite keyframes. Every glow here is a static gradient or shadow; the two
// keyframe animations in the CSS are bounded and marked governor-ok.

interface SlotSymbol {
  id: string
  name: string
  /** tile art under public/casino/ — cropped from the user-supplied cabinet render */
  img: string
  /** wider-than-square art (shades, WILD banner) letterboxes instead of cropping */
  wide?: boolean
  /** payline pay for 3 / 4 / 5 of a kind, in Poplur Credits */
  pays: [number, number, number]
}

// Reel symbols cropped straight out of the user-supplied cabinet reference
// (no synthesized art — these are the render's own tiles, starfield backing
// included so they blend into the dark reels). Mostly small pays; the 5×P
// line is the machine's "jackpot".
const SYMBOLS: SlotSymbol[] = [
  { id: 'p', name: 'POPLUR', img: 'casino/sym-p.png', pays: [3, 10, 100] },
  { id: 'star', name: 'STAR', img: 'casino/sym-star.png', pays: [2, 8, 25] },
  { id: 'headphones', name: 'BEATS', img: 'casino/sym-headphones.png', pays: [2, 6, 20] },
  { id: 'phone', name: 'PHONE', img: 'casino/sym-phone.png', pays: [2, 5, 16] },
  { id: 'sneaker', name: 'KICKS', img: 'casino/sym-sneaker.png', pays: [1, 5, 15] },
  { id: 'coins', name: 'COINS', img: 'casino/sym-coins.png', pays: [1, 4, 12] },
  { id: 'shades', name: 'SHADES', img: 'casino/sym-shades.png', wide: true, pays: [1, 4, 10] },
  { id: 'backpack', name: 'PACK', img: 'casino/sym-backpack.png', pays: [1, 3, 10] },
  { id: 'camera', name: 'CAMERA', img: 'casino/sym-camera.png', pays: [1, 3, 8] },
  { id: 'globe', name: 'GLOBE', img: 'casino/sym-globe.png', pays: [1, 2, 6] },
]

// WILD never fills a losing line — it only ever stands in on a paid one, so
// seeing it always means the line hit.
const WILD: SlotSymbol = { id: 'wild', name: 'WILD', img: 'casino/sym-wild.png', wide: true, pays: [0, 0, 0] }

const REELS = 5
/** Reel i settles at BASE + i·STEP ms; the whole spin is ~2.5s, one-shot.
    The travel distance is a PERCENTAGE of the strip's own height (see the
    transform below), so the CSS --cell can scale with the viewport without
    the component knowing the pixel size. */
const REEL_DUR_BASE = 1400
const REEL_DUR_STEP = 260

// ── daily gate ───────────────────────────────────────────────────────────────
// Device-local, keyed like the app's other persisted prefs. SERVER-SIDE
// ENFORCEMENT COMES LATER (see the note at the top of this file); this is
// honest-player plumbing, not security.
const LAST_SPIN_KEY = 'poplur.casino.lastSpin.v1'

function todayStamp(): string {
  // LOCAL date on purpose: "one a day" should reset at the player's midnight,
  // not UTC's.
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function spinUsedToday(): boolean {
  try { return window.localStorage.getItem(LAST_SPIN_KEY) === todayStamp() }
  catch { return false }
}

function markSpinUsed(): void {
  try { window.localStorage.setItem(LAST_SPIN_KEY, todayStamp()) }
  catch { /* private mode — component state still gates this visit */ }
}

// ── outcome ──────────────────────────────────────────────────────────────────
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

type Outcome = { count: 0 } | { count: 3 | 4 | 5; symbol: SlotSymbol }

/** Client-rolled for this pass (Math.random, like the ledger's entry ids).
    Mostly small wins, rare bigger hits — a daily freebie should feel warm. */
function rollOutcome(): Outcome {
  const r = Math.random()
  if (r < 0.25) return { count: 0 }
  if (r < 0.75) return { count: 3, symbol: pick(SYMBOLS) }
  if (r < 0.94) return { count: 4, symbol: pick(SYMBOLS) }
  return { count: 5, symbol: pick(SYMBOLS) }
}

/** The middle line, left-anchored like every slot in history. Fillers never
    extend the run and never pair up, so the line reads exactly what it pays;
    a losing line is five distinct symbols — near-misses allowed, phantom wins
    not. */
function buildPayline(outcome: Outcome): SlotSymbol[] {
  if (outcome.count === 0) {
    const pool = [...SYMBOLS]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, 5)
  }
  const line: SlotSymbol[] = []
  for (let i = 0; i < REELS; i++) {
    if (i < outcome.count) { line.push(outcome.symbol); continue }
    let filler = pick(SYMBOLS)
    while (filler.id === outcome.symbol.id || filler.id === line[i - 1]?.id) filler = pick(SYMBOLS)
    line.push(filler)
  }
  // A dash of WILD on some wins — cosmetic (the pay was decided above), and
  // never on reel 1, so the line still reads from the left.
  if (Math.random() < 0.3) line[1 + Math.floor(Math.random() * (outcome.count - 1))] = WILD
  return line
}

/** Top/bottom rows are dressing — random, but never three-in-a-row, so no
    visible line ever looks like a win that didn't pay. */
function buildDressingRow(): SlotSymbol[] {
  const row: SlotSymbol[] = []
  for (let i = 0; i < REELS; i++) {
    let s = pick(SYMBOLS)
    while (i >= 2 && row[i - 1].id === s.id && row[i - 2].id === s.id) s = pick(SYMBOLS)
    row.push(s)
  }
  return row
}

/** faces[reel] = [top, middle, bottom] */
type Faces = SlotSymbol[][]

// The at-rest faces reproduce the reference cabinet's own reel layout,
// WILD tile included (cosmetic here — the middle line is shades/headphones/
// star/backpack/globe, five distinct symbols, so it reads as no win).
const SYMBOL_BY_ID = new Map([...SYMBOLS, WILD].map(s => [s.id, s]))
const ATTRACT_FACES: Faces = [
  ['p', 'shades', 'sneaker'],
  ['star', 'headphones', 'coins'],
  ['headphones', 'star', 'wild'],
  ['phone', 'backpack', 'camera'],
  ['sneaker', 'globe', 'p'],
].map(col => col.map(id => SYMBOL_BY_ID.get(id) as SlotSymbol))

/** Old face, a blur of filler, new face — the strip each reel travels once. */
function buildStrips(from: Faces, to: Faces): Faces {
  return Array.from({ length: REELS }, (_, i) => {
    const filler = Array.from({ length: 12 + i * 3 }, () => pick(SYMBOLS))
    return [...from[i], ...filler, ...to[i]]
  })
}

interface SpinResult { amount: number; line: string }

// The cabinet's payline number chips — the colored circles running down both
// sides of the reference's reel panel, top to bottom. Decorative hardware
// until multi-line play exists; values and colourways copied from the render.
const PAYLINE_CHIPS: Array<[label: string, tone: string]> = [
  ['4', 'chipPink'], ['2', 'chipGold'], ['8', 'chipIndigo'], ['6', 'chipTeal'], ['1', 'chipGreen'],
  ['7', 'chipGold'], ['9', 'chipGreen'], ['3', 'chipBlue'], ['5', 'chipPurple'],
]

/** Slot-machine readouts show cents even though credits are integers —
    1,234.00, like the reference's BALANCE well. Same number, more Vegas. */
const fmtWell = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CasinoScreen({ onClose }: { onClose: () => void }) {
  const [faces, setFaces] = useState<Faces>(ATTRACT_FACES)
  const [strips, setStrips] = useState<Faces | null>(null)
  const [phase, setPhase] = useState<'idle' | 'armed' | 'rolling'>('idle')
  const [used, setUsed] = useState(() => spinUsedToday())
  const [credits, setCredits] = useState(() => creditBalance())
  const [result, setResult] = useState<SpinResult | null>(null)
  const [paysOpen, setPaysOpen] = useState(false)

  const landedRef = useRef(0)
  const ceilingRef = useRef<number | null>(null)
  const finalFacesRef = useRef<Faces | null>(null)
  const pendingRef = useRef<SpinResult | null>(null)

  useEffect(() => onCreditsChange(() => setCredits(creditBalance())), [])

  // Same contract as GamesScreen: ask HomeTwin to clear its wordmark and stat
  // row while this screen is up (the jackpot sign lives where the wordmark
  // sits). Deferred a macrotask for the same child-before-parent mount-order
  // reason documented there; cleanup always restores the chrome.
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('poplur-games-chrome-mute', { detail: { on: true } }))
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.dispatchEvent(new CustomEvent('poplur-games-chrome-mute', { detail: { on: false } }))
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Grant exactly once — whether the reels settle on screen or the screen is
      closed mid-spin, the outcome was decided at press time. */
  const settleGrant = () => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending && pending.amount > 0) grantCasinoWin(pending.amount, pending.line)
  }

  const finish = () => {
    if (!finalFacesRef.current) return // already finished (ceiling vs transitionend)
    if (ceilingRef.current) { window.clearTimeout(ceilingRef.current); ceilingRef.current = null }
    setFaces(finalFacesRef.current)
    finalFacesRef.current = null
    setStrips(null)
    setPhase('idle')
    const shown = pendingRef.current ?? { amount: 0, line: '' }
    settleGrant()
    setResult(shown)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => () => {
    if (ceilingRef.current) window.clearTimeout(ceilingRef.current)
    settleGrant() // a win must not evaporate because the cube closed the screen
  }, [])

  const spin = () => {
    if (phase !== 'idle' || used) return
    playPop()
    setResult(null)
    setPaysOpen(false)
    const outcome = rollOutcome()
    const line = buildPayline(outcome)
    const top = buildDressingRow()
    const bottom = buildDressingRow()
    const final: Faces = Array.from({ length: REELS }, (_, i) => [top[i], line[i], bottom[i]])
    finalFacesRef.current = final
    pendingRef.current = outcome.count === 0
      ? null
      : {
          amount: outcome.symbol.pays[outcome.count - 3],
          line: `Slots ${outcome.count}× ${outcome.symbol.name}`,
        }
    // The spin is SPENT when the reels are committed, not when they stop —
    // closing the screen mid-spin must not re-arm today's spin.
    markSpinUsed()
    setUsed(true)
    landedRef.current = 0
    setStrips(buildStrips(faces, final))
    setPhase('armed')
    // Never strand the machine mid-spin if a transitionend is swallowed
    // (display:none tab, reduced-motion edge): force the settle a beat after
    // the slowest reel was due.
    ceilingRef.current = window.setTimeout(
      () => finishRef.current(),
      REEL_DUR_BASE + REEL_DUR_STEP * (REELS - 1) + 900,
    )
  }

  // governor-ok: a single deferred frame per spin press, no loop — the strips
  // must mount at rest before the transform that travels them, or there is no
  // transition to run.
  useEffect(() => {
    if (phase !== 'armed') return
    const raf = window.requestAnimationFrame(() => setPhase('rolling'))
    return () => window.cancelAnimationFrame(raf)
  }, [phase])

  const onReelLanded = () => {
    playPop() // one pop per reel as it thunks in, like the wheel's notches
    landedRef.current += 1
    if (landedRef.current >= REELS) finish()
  }

  const spinning = phase !== 'idle'
  const status = spinning
    ? 'GOOD LUCK…'
    : used
      ? 'COME BACK TOMORROW — ONE FREE SPIN A DAY'
      : 'YOUR FREE DAILY SPIN IS READY'

  return (
    <div className={styles.stage} data-win={result && result.amount > 0 ? 'true' : undefined}>
      <div className={styles.ambient} aria-hidden="true" />
      {/* Hot-pink neon rails down both screen edges — the reference cabinet's
          side lighting. Static glows, nothing animates. */}
      <span className={`${styles.rail} ${styles.railLeft}`} aria-hidden="true" />
      <span className={`${styles.rail} ${styles.railRight}`} aria-hidden="true" />

      <header className={styles.topbar}>
        <div className={styles.chWrap}>
          <span className={styles.chPill}>CH 777</span>
          <span className={styles.chName}>CASINO</span>
        </div>
        <div className={styles.creditsBox}>
          <span className={styles.creditsLabel}>CREDITS</span>
          <b className={styles.creditsValue}>{credits}</b>
        </div>
        {/* No ✕ — the cube closes every subscreen, this one included. */}
      </header>

      {/* The reference render's own marquee — wordmark, jackpot sign, mascot,
          skyline — cropped as one strip. It IS the header; the jackpot tiers
          on it become real when the server economy lands. width/height keep
          the strip's aspect reserved before the bytes arrive. */}
      <img
        className={styles.marquee}
        src="casino/marquee.png"
        alt="POPLUR casino — jackpot 10,000"
        width={1200}
        height={223}
        draggable={false}
      />

      {/* Reel panel flanked by the payline number chips, like the reference. */}
      <section className={styles.reelsBand}>
        <span className={styles.chipCol} aria-hidden="true">
          {PAYLINE_CHIPS.map(([label, tone], i) => (
            <span key={i} className={`${styles.chip} ${styles[tone]}`}>{label}</span>
          ))}
        </span>
        <div className={styles.reels} role="img" aria-label="Slot reels — middle line pays">
          {Array.from({ length: REELS }, (_, i) => {
            const cells = strips?.[i] ?? faces[i]
            const traveling = phase === 'rolling' && !!strips
            return (
              <div key={i} className={styles.reelWindow}>
                <div
                  className={styles.strip}
                  style={traveling ? {
                    // Travel = strip height minus the 3 visible cells, as a
                    // fraction of the strip's own height — cell-size agnostic.
                    transform: `translateY(-${(((cells.length - 3) / cells.length) * 100).toFixed(4)}%)`,
                    transitionDuration: `${REEL_DUR_BASE + i * REEL_DUR_STEP}ms`,
                    willChange: 'transform',
                  } : undefined}
                  onTransitionEnd={e => {
                    if (e.target === e.currentTarget && e.propertyName === 'transform') onReelLanded()
                  }}
                >
                  {cells.map((sym, j) => (
                    <span key={j} className={styles.cell}>
                      {/* the cell box is fixed by CSS (--cell), so tiles never
                          reflow the strip while their bytes load */}
                      <img
                        className={sym.wide ? `${styles.cellArt} ${styles.cellArtWide}` : styles.cellArt}
                        src={sym.img}
                        alt=""
                        draggable={false}
                      />
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
          <span className={styles.payband} aria-hidden="true" />
        </div>
        <span className={styles.chipCol} aria-hidden="true">
          {PAYLINE_CHIPS.map(([label, tone], i) => (
            <span key={i} className={`${styles.chip} ${styles[tone]}`}>{label}</span>
          ))}
        </span>
      </section>

      {/* BALANCE / BET / WIN wells plus the glitter SPIN panel, the reference
          readout row. BALANCE and WIN are live; BET is honestly FREE (the
          daily spin has no stake) and the +/− pills are decorative hardware. */}
      <section className={styles.readout}>
        <div className={styles.well}>
          <span className={styles.wellLabel}>BALANCE</span>
          <span className={styles.wellRow}>
            <b className={styles.wellValue}>{fmtWell(credits)}</b>
            <span className={styles.wellPill} aria-hidden="true">+</span>
          </span>
        </div>
        <div className={styles.well}>
          <span className={styles.wellLabel}>BET</span>
          <span className={styles.wellRow}>
            <span className={styles.wellPill} aria-hidden="true">−</span>
            <b className={styles.wellValue}>FREE</b>
            <span className={styles.wellPill} aria-hidden="true">+</span>
          </span>
        </div>
        <div className={styles.well}>
          <span className={styles.wellLabel}>WIN</span>
          <span className={styles.wellRow}>
            <b className={styles.wellValue}>{fmtWell(result?.amount ?? 0)}</b>
          </span>
        </div>
        <button
          type="button"
          className={styles.spinPanel}
          onClick={spin}
          disabled={used || spinning}
          aria-label={used ? 'Free spin used — come back tomorrow' : 'Spin'}
        >
          <img src="casino/spin-panel.png" alt="" width={279} height={86} draggable={false} />
        </button>
      </section>

      <div className={styles.resultRow} role="status" aria-live="polite">
        {result ? (
          result.amount > 0 ? (
            <span className={styles.resultWin} key="win">WIN <b>+{result.amount}</b> CREDITS</span>
          ) : (
            <span className={styles.resultMiss} key="miss">SO CLOSE — TOMORROW'S SPIN IS LOADED</span>
          )
        ) : (
          <span className={styles.statusLine}>{status}</span>
        )}
      </div>

      {/* Bottom hardware row. Only PAY TABLE and SPIN are wired — the rest
          are honest decorative hardware (spans, not buttons) until bets and
          autoplay exist; the mini-panel is the reference's own art. */}
      <section className={styles.hardware}>
        <div className={styles.hwRow}>
          <button
            type="button"
            className={styles.hwBtn}
            onClick={() => { playPop(); setPaysOpen(open => !open) }}
          >
            PAY TABLE
          </button>
          <span className={styles.hwBtn} aria-hidden="true">BET DOWN</span>
          <span className={styles.hwBtn} aria-hidden="true">BET UP</span>
          <span className={styles.hwBtn} aria-hidden="true">MAX BET</span>
          <span className={`${styles.hwBtn} ${styles.hwBlue}`} aria-hidden="true">AUTO PLAY</span>
        </div>
        <div className={styles.hwRow}>
          <img
            className={styles.miniPanel}
            src="casino/mini-panel.png"
            alt=""
            width={388}
            height={150}
            draggable={false}
          />
          <button
            type="button"
            className={styles.spinBtn}
            onClick={spin}
            disabled={used || spinning}
            aria-label={used ? 'Free spin used — come back tomorrow' : 'Spin'}
          >
            {spinning ? '· · ·' : used ? 'TOMORROW' : 'SPIN'}
          </button>
        </div>
      </section>

      {paysOpen && (
        <div className={styles.paysCard} role="dialog" aria-label="Pay table">
          <span className={styles.paysTitle}>PAY TABLE</span>
          <ul className={styles.paysList}>
            {SYMBOLS.map(s => (
              <li key={s.id} className={styles.paysRow}>
                <span className={styles.paysGlyph}><img src={s.img} alt="" draggable={false} /></span>
                <span className={styles.paysName}>{s.name}</span>
                <span className={styles.paysNums}>×3 {s.pays[0]} · ×4 {s.pays[1]} · ×5 {s.pays[2]}</span>
              </li>
            ))}
            <li className={styles.paysRow}>
              <span className={styles.paysGlyph}><img src={WILD.img} alt="" draggable={false} /></span>
              <span className={styles.paysName}>WILD</span>
              <span className={styles.paysNums}>stands in for any symbol</span>
            </li>
          </ul>
          <p className={styles.paysFoot}>
            Middle line pays, left to right · one free spin a day · wins are Poplur Credits
          </p>
          <button
            type="button"
            className={styles.paysClose}
            onClick={() => { playPop(); setPaysOpen(false) }}
          >
            CLOSE
          </button>
        </div>
      )}
    </div>
  )
}
