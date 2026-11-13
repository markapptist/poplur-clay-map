import { isIOSNativeShell } from './nativeBridge'

/**
 * True inside the iPhone/iPad app, in the home page AND in the same-origin map
 * iframe it hosts (the shell's `poplur` handler is registered on the main
 * frame, so the iframe asks its parent).
 *
 * App Review rejected the iOS build twice under 2.5.19 for features the
 * listing does not describe (29 Oct, 13 Nov 2026). The iOS shell therefore
 * leaves out the game-like pages (House, Trophies, Games), invented content
 * (TV Guide programmes, placeholder chats, simulated posts) and chance-based
 * rewards. Android and the browser keep them. See
 * .codex/app-review-20261113/AUDIT-FINDINGS.md in the workspace.
 */
export function isIOSAppShell(): boolean {
  if (isIOSNativeShell()) return true
  try {
    if (typeof window === 'undefined' || window.parent === window) return false
    const parent = window.parent as unknown as { webkit?: { messageHandlers?: { poplur?: unknown } } }
    return Boolean(parent.webkit?.messageHandlers?.poplur)
  } catch {
    return false
  }
}

/** Pages the iOS shell never opens: not in the wheel, the arrows or resume. */
export const IOS_HIDDEN_SCREENS: ReadonlySet<string> = new Set([
  'feed-games',
  'feed-tvguide',
  'profile-house',
  'profile-trophies',
])

/** Credit ledger rows paid out by chance (the retired Map dice and Casino). */
export const CHANCE_REWARD_ENTRY_KINDS: ReadonlySet<string> = new Set([
  'map_daily_roll',
  'casino_daily_spin',
])
