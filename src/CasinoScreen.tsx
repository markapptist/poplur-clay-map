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
  glyph: string
  name: string
  /** CSS-module class painting the glyph's gradient */
  tone: string
  /** payline pay for 3 / 4 / 5 of a kind, in Poplur Credits */
  pays: [number, number, number]
}

// Poplur-themed reel symbols as styled text — no generated art (house rule).
// Mostly small pays; the 5×P line is the machine's "jackpot".
const SYMBOLS: SlotSymbol[] = [
  { id: 'p', glyph: 'P', name: 'POPLUR', tone: 'tonePink', pays: [3, 10, 100] },
  { id: 'seven', glyph: '7', name: 'LUCKY 7', tone: 'toneGold', pays: [2, 8, 25] },
  { id: 'star', glyph: '★', name: 'STAR', tone: 'toneGold', pays: [2, 6, 20] },
  { id: 'coin', glyph: '$', name: 'COINS', tone: 'toneGreen', pays: [1, 5, 15] },
  { id: 'note', glyph: '♪', name: 'BEATS', tone: 'tonePurple', pays: [1, 4, 12] },
  { id: 'gem', glyph: '◆', name: 'GEM', tone: 'toneCyan', pays: [1, 3, 10] },
]

// WILD never fills a losing line — it only ever stands in on a paid one, so
// seeing it always means the line hit.
const WILD: SlotSymbol = { id: 'wild', glyph: 'W', name: 'WILD', tone: 'toneWild', pays: [0, 0, 0] }

const REELS = 5
/** Must match the CSS --cell height — the travel transform is computed here. */
const CELL_PX = 56
/** Reel i settles at BASE + i·STEP ms; the whole spin is ~2.5s, one-shot. */
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

const ATTRACT_FACES: Faces = [
  ['note', 'p', 'star'],
  ['gem', 'star', 'coin'],
  ['star', 'seven', 'p'],
  ['coin', 'star', 'gem'],
  ['seven', 'p', 'note'],
].map(col => col.map(id => SYMBOLS.find(s => s.id === id) as SlotSymbol))

/** Old face, a blur of filler, new face — the strip each reel travels once. */
function buildStrips(from: Faces, to: Faces): Faces {
  return Array.from({ length: REELS }, (_, i) => {
    const filler = Array.from({ length: 12 + i * 3 }, () => pick(SYMBOLS))
    return [...from[i], ...filler, ...to[i]]
  })
}

interface SpinResult { amount: number; line: string }

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
    <div className={styles.stage}>
      <div className={styles.ambient} aria-hidden="true" />

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

      {/* Decorative sign, like the reference cabinet's crown. The tiers become
          real when the server economy lands. */}
      <section className={styles.jackpotSign} aria-hidden="true">
        <span className={styles.jackpotWord}>JACKPOT</span>
        <span className={styles.jackpotAmount}>10,000.00</span>
        <div className={styles.tiers}>
          <span className={styles.tier}>MAJOR</span>
          <span className={styles.tier}>MINOR</span>
          <span className={styles.tier}>MINI</span>
        </div>
      </section>

      <section className={styles.cabinet} data-win={result && result.amount > 0 ? 'true' : undefined}>
        <span className={styles.wordmark} aria-hidden="true">POPLUR</span>
        <div className={styles.reels} role="img" aria-label="Slot reels — middle line pays">
          {Array.from({ length: REELS }, (_, i) => {
            const cells = strips?.[i] ?? faces[i]
            const traveling = phase === 'rolling' && !!strips
            return (
              <div key={i} className={styles.reelWindow}>
                <div
                  className={styles.strip}
                  style={traveling ? {
                    transform: `translateY(${-(cells.length - 3) * CELL_PX}px)`,
                    transitionDuration: `${REEL_DUR_BASE + i * REEL_DUR_STEP}ms`,
                    willChange: 'transform',
                  } : undefined}
                  onTransitionEnd={e => {
                    if (e.target === e.currentTarget && e.propertyName === 'transform') onReelLanded()
                  }}
                >
                  {cells.map((sym, j) => (
                    <span key={j} className={`${styles.cell} ${styles[sym.tone]}`}>{sym.glyph}</span>
                  ))}
                </div>
              </div>
            )
          })}
          <span className={styles.payband} aria-hidden="true" />
        </div>
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

      <div className={styles.deck}>
        <button
          type="button"
          className={styles.deckBtn}
          onClick={() => { playPop(); setPaysOpen(open => !open) }}
        >
          PAY TABLE
        </button>
        <button
          type="button"
          className={styles.spinBtn}
          onClick={spin}
          disabled={used || spinning}
          aria-label={used ? 'Free spin used — come back tomorrow' : 'Spin'}
        >
          {spinning ? '· · ·' : used ? 'TOMORROW' : 'SPIN'}
        </button>
        {/* Decorative, like the reference cabinet's bet rail: the daily spin
            is always one free credit line, so there is nothing to bet. */}
        <span className={styles.betChip} aria-hidden="true">
          BET<b>FREE</b>
        </span>
      </div>

      {paysOpen && (
        <div className={styles.paysCard} role="dialog" aria-label="Pay table">
          <span className={styles.paysTitle}>PAY TABLE</span>
          <ul className={styles.paysList}>
            {SYMBOLS.map(s => (
              <li key={s.id} className={styles.paysRow}>
                <span className={`${styles.paysGlyph} ${styles[s.tone]}`}>{s.glyph}</span>
                <span className={styles.paysName}>{s.name}</span>
                <span className={styles.paysNums}>×3 {s.pays[0]} · ×4 {s.pays[1]} · ×5 {s.pays[2]}</span>
              </li>
            ))}
            <li className={styles.paysRow}>
              <span className={`${styles.paysGlyph} ${styles.toneWild}`}>W</span>
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
