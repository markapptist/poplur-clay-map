// Refer a friend, hold the whole world for a day.
//
// Radius is the product: a pop earns ground and that ground decays, and the
// long game is a world radius (see the map's planet scope, which already knows
// how to draw a total). This is the one thing that hands you the whole planet
// outright — for 24 hours, for bringing someone in. It is a reward that is
// worth having precisely because radius is otherwise slow, so it stacks:
// every accepted referral adds another day, up to 30 banked.
//
// The ACCOUNT holds all of it, on the server (Poplur2025-iOS
// functions/src/credits.ts): your code, whether you have used a friend's, the
// credits, and when the worldwide radius runs out. A new account enters a
// friend's code in its Wallet during its first 14 days; the server pays both
// sides once, and stops paying a referrer after 20. Sending an invite pays
// nothing: an invite shouted into the void must not pay, and a share sheet
// cannot tell anyone whether a friend actually joined.

import { creditsWallet, onCreditsChange } from './poplurCredits'

/** What one accepted referral is worth. */
export const WORLD_RADIUS_HOURS = 24

/** This account's code, or null until the server has answered. Six characters
    from an alphabet with no O/0 or I/1, because people read it aloud. */
export function referralCode(): string | null {
  return creditsWallet()?.referral.code ?? null
}

/** The invitation itself — what gets shared. */
export function referralLink(code: string): string {
  return `https://poplur.com/i/${code}`
}

/** Epoch ms the world radius runs out; 0 when it is not running. */
export function worldRadiusUntil(): number {
  const until = creditsWallet()?.worldRadiusUntil ?? 0
  return until > Date.now() ? until : 0
}

export function isWorldRadiusActive(): boolean {
  return worldRadiusUntil() > 0
}

/** Milliseconds left, 0 when it is not running. */
export function worldRadiusRemainingMs(): number {
  const until = worldRadiusUntil()
  return until === 0 ? 0 : until - Date.now()
}

/** Told whenever the account's wallet changes, which carries the referral state. */
export function onReferralChange(fn: () => void): () => void {
  return onCreditsChange(fn)
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
