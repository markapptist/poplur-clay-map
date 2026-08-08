// Refer a friend, hold the whole world for a day.
//
// Radius is the product: a pop earns ground and that ground decays, and the
// long game is a world radius (see the map's planet scope, which already knows
// how to draw a total). This is the one thing that hands you the whole planet
// outright — for 24 hours, for bringing someone in. It is a reward that is
// worth having precisely because radius is otherwise slow, so it stacks:
// every accepted referral adds another day.
//
// TWO SOURCES, ONE PATH — the same shape engagement.ts uses:
//   REAL — the host (native, or the Aug-2026 live service) confirms a referral
//          was ACCEPTED, i.e. someone actually joined on your code:
//            window.dispatchEvent(new CustomEvent('poplur-referral-accepted'))
//          or postMessage({ type: 'poplur-referral-accepted' }).
//          Acceptance is the event, never the invitation — sending an invite
//          into the void must not pay.
//   LOCAL — there is no referral service yet, so the Settings screen resolves
//          a completed share as an acceptance itself. That stand-in is the ONLY
//          thing the live service has to take over; everything below is already
//          the real mechanic.
//
// State lives in localStorage because the reward has to survive the app being
// closed — a 24-hour grant that forgets itself on reload is not a grant. Every
// access is guarded: an embedded or partitioned shell can throw on
// localStorage, and a referral is never worth a thrown error.

const CODE_KEY = 'poplur.referral.code'
const UNTIL_KEY = 'poplur.worldRadiusUntil'

/** What one accepted referral is worth. */
export const WORLD_RADIUS_HOURS = 24
const HOUR_MS = 60 * 60 * 1000
/** Referrals stack, but not without end — a month of held planet is plenty. */
const MAX_BANKED_MS = 30 * 24 * HOUR_MS

const listeners = new Set<() => void>()

function read(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* partitioned shell */ }
}

/**
 * Your code, made once and kept. Six characters from an alphabet with no O/0
 * or I/1 in it, because this is a string people read aloud and type by hand.
 */
export function referralCode(): string {
  const existing = read(CODE_KEY)
  if (existing && /^[A-Z2-9]{6}$/.test(existing)) return existing
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i += 1) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  write(CODE_KEY, code)
  return code
}

/** The invitation itself — what gets shared. */
export function referralLink(code = referralCode()): string {
  return `https://poplur.com/i/${code}`
}

/** Epoch ms the world radius runs out; 0 when it is not running. */
export function worldRadiusUntil(): number {
  const raw = Number(read(UNTIL_KEY))
  if (!Number.isFinite(raw) || raw <= Date.now()) return 0
  return raw
}

export function isWorldRadiusActive(): boolean {
  return worldRadiusUntil() > 0
}

/** Milliseconds left, 0 when it is not running. */
export function worldRadiusRemainingMs(): number {
  const until = worldRadiusUntil()
  return until === 0 ? 0 : until - Date.now()
}

/**
 * Bank another day of planet. Extends from whatever is already banked rather
 * than from now, so referring two friends in one minute is worth two days
 * instead of one — otherwise the second referral would silently pay nothing.
 */
export function grantWorldRadius(hours = WORLD_RADIUS_HOURS): number {
  const now = Date.now()
  const from = Math.max(now, worldRadiusUntil())
  const until = Math.min(from + hours * HOUR_MS, now + MAX_BANKED_MS)
  write(UNTIL_KEY, String(until))
  listeners.forEach(fn => fn())
  return until
}

/** Told whenever the grant changes — including when it runs out. */
export function onReferralChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * The real wire. Mount once; returns its own teardown.
 *
 * Deliberately NOT a poll: the grant only ever changes when a referral lands or
 * when it expires, and both of those are moments, not states to watch. The
 * expiry is a single timer armed for exactly the remaining time — an app left
 * open across the boundary still notices, and one left open for a week costs
 * one timer rather than a heartbeat.
 */
export function startReferralWire(): () => void {
  let expiryTimer = 0

  const armExpiry = () => {
    window.clearTimeout(expiryTimer)
    const remaining = worldRadiusRemainingMs()
    if (remaining <= 0) return
    expiryTimer = window.setTimeout(() => {
      listeners.forEach(fn => fn())
      armExpiry()
    }, remaining + 250)
  }

  const accept = () => { grantWorldRadius(); armExpiry() }
  const onEvent = () => accept()
  const onMessage = (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === 'poplur-referral-accepted') accept()
  }

  window.addEventListener('poplur-referral-accepted', onEvent)
  window.addEventListener('message', onMessage)
  armExpiry()

  return () => {
    window.clearTimeout(expiryTimer)
    window.removeEventListener('poplur-referral-accepted', onEvent)
    window.removeEventListener('message', onMessage)
  }
}

/** "23h 41m" — what is left, for a screen to show. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMinutes = Math.ceil(ms / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
