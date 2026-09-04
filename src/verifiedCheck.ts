import type { VerificationCategoryID } from './profileVerification'

// The two verification marks Poplur draws beside a name, both supplied art:
// a verified BUSINESS gets the black check, a verified PERSON the pink one.
// Nothing here decides whether someone is verified — callers pass the state.
export type VerifiedCheckKind = 'personal' | 'business'

export function verifiedCheckKind(category: VerificationCategoryID | null | undefined): VerifiedCheckKind {
  return category === 'business' || category === 'organisation' ? 'business' : 'personal'
}

export const VERIFIED_CHECK_SRC: Record<VerifiedCheckKind, string> = {
  personal: 'verified-personal.png',
  business: 'verified-business.png',
}

export const VERIFIED_CHECK_LABEL: Record<VerifiedCheckKind, string> = {
  personal: 'Verified',
  business: 'Verified business',
}
