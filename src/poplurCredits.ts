// Poplur credits — the app's spend unit for work that costs Poplur real money
// on someone else's meter. Right now that is exactly one thing: a Meshy cube
// generated from your photo (AvatarScreen). Studio songs and AI compose will
// join it, which is why this is its own ledger rather than a number hidden in
// the avatar store.
//
// Radius is EARNED and decays (radiusLedger.ts). Credits are BOUGHT and are
// spent once — the two must never be confused, so they stay separate ledgers
// with separate words on screen.

export type CreditEntryKind = 'welcome' | 'purchase' | 'refund' | 'avatar-cube'

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
