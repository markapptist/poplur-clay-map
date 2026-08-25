export const POST_SCHEMA_VERSION = 2
export const POST_RIGHTS_VERSION = '2026-08'

export type PostAudience = 'public'
export type PostLocationVisibility = 'exact' | 'approximate'

export interface PublishPrivacy {
  audience: PostAudience
  locationVisibility: PostLocationVisibility
  rightsAttested: boolean
}

const POST_ID = /^post-[a-zA-Z0-9-]{16,96}$/

/**
 * One identity follows a post through every retry. Native shells use it for
 * both the Storage object and Firestore document, so a late success followed
 * by a retry cannot create two posts.
 */
export function createClientPostId(randomUUID?: () => string): string {
  const uuid = randomUUID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`
  return `post-${uuid.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 96)}`
}

export function isClientPostId(value: unknown): value is string {
  return typeof value === 'string' && POST_ID.test(value)
}

/**
 * Approximate posts disclose an area of roughly a city block, not the exact
 * map tap. This is intentionally deterministic so feed/map clients agree.
 */
export function publicCoordinate(
  value: number,
  visibility: PostLocationVisibility,
): number {
  if (!Number.isFinite(value)) throw new Error('A valid post location is required.')
  if (visibility === 'exact') return value
  return Math.round(value * 1_000) / 1_000
}

export function validatePublishPrivacy(value: PublishPrivacy): string | null {
  if (value.audience !== 'public') return 'This version can only publish to Everyone.'
  if (value.locationVisibility !== 'exact' && value.locationVisibility !== 'approximate') {
    return 'Choose how precisely the post location should be shown.'
  }
  if (!value.rightsAttested) return 'Confirm that you have permission to share this media and music.'
  return null
}
