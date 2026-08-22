import { postNativeEvent } from './nativeBridge'

// Profile verification: the request side only. Poplur already draws verified
// badges in the news feed (NewsPaper.tsx's VerifyBadge, blue = verified, grey
// = confirmed), but there has never been a way for a person to ASK for one.
//
// NOTE ON PERSISTENCE: there is no verification service yet. `trophies.ts`
// records the same gap — global rank, verification and subscription are all
// named as live-service concerns that do not exist. So a submitted request is
// announced over the native bridge (the same relay shape as `appIconChanged`
// and `poplurStoreCheckoutRequested`) and then remembered on this device. If
// nothing is listening, the request still reads back as pending here — which
// is the honest local state, not a claim that anything received it. Swap
// readVerification/submitVerificationRequest for the service call when one
// exists; the stored shape is deliberately the shape a server would return.

export type VerificationStatus = 'unverified' | 'pending' | 'verified'

export type VerificationCategoryID = 'creator' | 'business' | 'publicFigure' | 'organisation'

export interface VerificationCategory {
  id: VerificationCategoryID
  displayName: string
  blurb: string
}

export interface VerificationState {
  status: VerificationStatus
  category: VerificationCategoryID | null
  /** Epoch ms, or null when nothing has been requested on this device. */
  requestedAt: number | null
}

export const VERIFICATION_CATEGORIES: readonly VerificationCategory[] = [
  { id: 'creator', displayName: 'Creator', blurb: 'You post to an audience that follows you.' },
  { id: 'business', displayName: 'Business', blurb: 'You represent a shop, venue or service.' },
  { id: 'publicFigure', displayName: 'Public figure', blurb: 'You are known outside Poplur.' },
  { id: 'organisation', displayName: 'Organisation', blurb: 'A team, charity or public body.' },
]

const STORAGE_KEY = 'poplur.profileVerification.v1'

export const NO_VERIFICATION: VerificationState = { status: 'unverified', category: null, requestedAt: null }

export function verificationCategoryById(id: string | null | undefined): VerificationCategory | undefined {
  return VERIFICATION_CATEGORIES.find(category => category.id === id)
}

function isStatus(value: unknown): value is VerificationStatus {
  return value === 'unverified' || value === 'pending' || value === 'verified'
}

export function readVerification(): VerificationState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || !isStatus(parsed.status)) return NO_VERIFICATION
    return {
      status: parsed.status,
      category: verificationCategoryById(parsed.category)?.id ?? null,
      requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : null,
    }
  } catch {
    // Private mode, or a shape written by an older build. Either way the safe
    // read is "nothing requested" — never a claim of being verified.
    return NO_VERIFICATION
  }
}

function remember(next: VerificationState): VerificationState {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* storage may be unavailable */ }
  return next
}

/** Announce the request, then remember it locally. Returns the new state and
    whether anything native actually took delivery — the caller decides what to
    tell the user, exactly as chooseAppIcon does. */
export function submitVerificationRequest(
  category: VerificationCategoryID,
): { state: VerificationState; relayed: boolean } {
  const relayed = postNativeEvent({ type: 'profileVerificationRequested', category })
  const state = remember({ status: 'pending', category, requestedAt: Date.now() })
  return { state, relayed }
}

export function withdrawVerificationRequest(): VerificationState {
  postNativeEvent({ type: 'profileVerificationWithdrawn' })
  return remember(NO_VERIFICATION)
}
