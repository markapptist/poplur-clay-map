import { readVerification, type VerificationCategoryID } from './profileVerification'

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

function handleKey(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@+/, '').toLowerCase()
}

/**
 * Which mark a byline earns, or none. The same standing the profile shows:
 * @poplur carries no mark, the viewer's own handle follows the category they
 * asked to be verified under, and every other handle reads as a verified person
 * until a verification service says otherwise.
 */
export function verifiedKindForHandle(
  handle: string | null | undefined,
  ownHandle: string | null | undefined,
): VerifiedCheckKind | null {
  const key = handleKey(handle)
  if (!key || key === 'poplur') return null
  if (ownHandle && key === handleKey(ownHandle)) return verifiedCheckKind(readVerification().category)
  return 'personal'
}
