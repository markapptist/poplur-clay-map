// Poplur credits — the app's spend unit for work that costs Poplur real money
// on someone else's meter. Right now that is exactly one thing: a Meshy cube
// generated from your photo (AvatarScreen). Studio songs and AI compose will
// join it, which is why this is its own ledger rather than a number hidden in
// the avatar store.
//
// Radius is EARNED and decays (radiusLedger.ts). Credits are a durable spend
// unit: most are bought, while a few bounded app rewards (casino, referrals,
// and the Map's daily die) are earned. Radius and Credits must never be
// confused, so they stay separate ledgers with separate words on screen.

export type CreditEntryKind =
  | 'welcome' | 'purchase' | 'refund' | 'avatar-cube'
  // Wallet movements. Same ledger deliberately: the wallet is a WINDOW onto
  // this ledger, not a second balance that could disagree with it.
  | 'transfer-out' | 'transfer-in' | 'cash-out'
  // The casino's daily free spin (CasinoScreen). Its own kind, not 'purchase',
  // so the history says where the credits came from — these are WON, and when
  // the server-side economy lands they become the mirror of a server grant.
  | 'casino-win'
  | 'map-reward'
  | 'referral'

export interface CreditEntry {
  id: string
  kind: CreditEntryKind
  /** positive tops up, negative spends */
  delta: number
  note?: string
  at: number
}

const LEDGER_KEY = 'poplur.credits.ledger.v1'
export const CREDITS_CHANGE_EVENT = 'poplur-credits-change'

/** What one Meshy cube costs. Meshy bills Poplur per generated task, so this
    is a real cost being passed on, not a game currency sink. */
export const AVATAR_CUBE_COST = 25

/** Every account starts with enough for one cube. A generator you cannot try
    once is a generator nobody buys credits for. */
const WELCOME_GRANT = 30

function readLedger(): CreditEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? 'null')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry: CreditEntry) => entry && Number.isFinite(entry.delta))
  } catch {
    return []
  }
}

function writeLedger(entries: CreditEntry[]) {
  try { window.localStorage.setItem(LEDGER_KEY, JSON.stringify(entries.slice(-200))) }
  catch { /* private mode — the balance still holds for this session */ }
}

function publish() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CREDITS_CHANGE_EVENT, { detail: { balance: creditBalance() } }))
}

function append(kind: CreditEntryKind, delta: number, note?: string): CreditEntry {
  const entry: CreditEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    delta,
    note,
    at: Date.now(),
  }
  writeLedger([...readLedger(), entry])
  publish()
  return entry
}

/** The welcome grant, once per device. Written as a LEDGER ENTRY rather than a
    starting balance so it cannot be re-granted by clearing one key, and so the
    history explains where the first 30 came from. */
function ensureWelcome(): CreditEntry[] {
  const entries = readLedger()
  if (entries.some(entry => entry.kind === 'welcome')) return entries
  const welcome: CreditEntry = {
    id: 'welcome',
    kind: 'welcome',
    delta: WELCOME_GRANT,
    note: 'Welcome to Poplur',
    at: Date.now(),
  }
  const next = [welcome, ...entries]
  writeLedger(next)
  return next
}

export function creditHistory(): CreditEntry[] {
  return [...ensureWelcome()].sort((a, b) => b.at - a.at)
}

export function creditBalance(): number {
  return ensureWelcome().reduce((total, entry) => total + entry.delta, 0)
}

export function canAfford(cost: number): boolean {
  return creditBalance() >= cost
}

/**
 * Spend. Returns false and writes nothing when the balance will not cover it —
 * the caller must treat that as "send them to the Store", never as a silent
 * overdraft.
 *
 * This is the CLIENT-side ledger. When the Meshy proxy lands, the server debits
 * the account of record on task creation and this becomes the local mirror of
 * that balance; a spend recorded here that the server rejects is refunded by
 * `refundCredits` on the failure path (AvatarScreen already does this).
 */
export function spendCredits(cost: number, kind: CreditEntryKind, note?: string): boolean {
  if (!Number.isFinite(cost) || cost <= 0) return false
  if (!canAfford(cost)) return false
  append(kind, -cost, note)
  return true
}

export function refundCredits(cost: number, note?: string): void {
  if (!Number.isFinite(cost) || cost <= 0) return
  append('refund', cost, note)
}

export function grantCredits(amount: number, note?: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  append('purchase', amount, note)
}

/** Casino winnings. Client-side for now, like every grant in this file: the
    outcome that earned it is rolled on-device (CasinoScreen), and the server-
    authoritative casino economy replaces both the roll and this grant when it
    lands. Until then the most a tamperer can mint is one small win a day on
    their own device. */
export function grantCasinoWin(amount: number, note?: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  append('casino-win', amount, note)
}

/** Stable id for the Map's once-per-UTC-day free roll. Keeping the day in the
    ledger entry makes the local mirror idempotent even if the animation or
    bridge repeats its completion edge. */
export function dailyMapRewardEntryId(day: string): string {
  return `map-reward:${day}`
}

/** Grant one bounded Map reward for a UTC day. Returns false when that day was
    already recorded or the input is invalid. The future server ledger can use
    the same stable id as its idempotency key. */
export function grantDailyMapReward(amount: number, day: string, note?: string): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const entries = ensureWelcome()
  const id = dailyMapRewardEntryId(day)
  if (entries.some(entry => entry.id === id)) return false
  const entry: CreditEntry = {
    id,
    kind: 'map-reward',
    delta: Math.floor(amount),
    note: note ?? 'Daily Map reward',
    at: Date.now(),
  }
  writeLedger([...entries, entry])
  publish()
  return true
}

export const REFERRAL_CREDIT_REWARD = 10

export function grantReferralCredits(): void {
  append('referral', REFERRAL_CREDIT_REWARD, 'Referral reward')
}

// ── Wallet operations ────────────────────────────────────────────────────────
// Client-side mirrors of what the Wallet spec defines as server-authoritative
// operations (sendCredits / requestCashOut). Same contract as spendCredits
// above: when the server ledger lands these become the local mirror of its
// balance, and every mutation here already carries the shape the server needs
// (idempotent append, no in-place edits, reversal-not-deletion).

/** What one credit redeems for, in CAD. Display only — the Wallet spec's
    `creditsPerDollar` (100/[$1]) lives server-side when cash-out goes live. */
export const CREDITS_PER_DOLLAR = 100

export function creditsToCad(credits: number): string {
  return (credits / CREDITS_PER_DOLLAR).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

/** Send credits to another user. Balance-guarded like spendCredits — a false
    return means "not enough", never a partial write. */
export function transferCreditsOut(amount: number, toHandle: string): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false
  if (!canAfford(amount)) return false
  append('transfer-out', -amount, `To ${toHandle}`)
  return true
}

/** Receive credits from another user (bridge/demo path until the server
    ledger notifies for real). */
export function receiveCredits(amount: number, fromHandle: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  append('transfer-in', amount, `From ${fromHandle}`)
}

/** Redeem credits toward a payout. The debit is immediate; payout state
    machine (created → processing → paid) is the server's job when it lands. */
export function cashOutCredits(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false
  if (!canAfford(amount)) return false
  append('cash-out', -amount, `Cash out ${creditsToCad(amount)}`)
  return true
}

export function onCreditsChange(listener: () => void): () => void {
  const handle = () => listener()
  window.addEventListener(CREDITS_CHANGE_EVENT, handle)
  // Another tab (or the native shell's second web view) spending credits must
  // move this one's balance too — they share one localStorage.
  window.addEventListener('storage', handle)
  return () => {
    window.removeEventListener(CREDITS_CHANGE_EVENT, handle)
    window.removeEventListener('storage', handle)
  }
}
