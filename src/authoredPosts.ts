import { normalizeLiveFeedPost, type NativeFeedPost } from './nativeFeedPosts'
import { clampRadiusMeters } from './worldRadius'

export interface AuthoredPostRow { id: string; row: Record<string, unknown> }
export interface AuthoredPostClaim { id: string; coords: [number, number]; radiusKm: number }
export interface AuthoredPostsSnapshot {
  uid: string
  posts: NativeFeedPost[]
  totalRadiusKm: number
  postCount: number
  claims: AuthoredPostClaim[]
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const finite = (value: unknown): number | null => value == null || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null
const enabled = (value: unknown) => value === true || value === 1 || text(value).toLowerCase() === 'true'

/** One author's complete published reach, independent of Feed pagination and
 * whether this client can display a post's media. Sum each immutable post once;
 * a seed belongs to that post's reach, but is not added a second time. */
export function authoredPostsSnapshot(uid: string, documents: readonly AuthoredPostRow[]): AuthoredPostsSnapshot {
  const result: AuthoredPostsSnapshot = { uid, posts: [], totalRadiusKm: 0, postCount: 0, claims: [] }
  const seen = new Set<string>()
  for (const { id, row } of documents) {
    if (!id || seen.has(id) || text(row.userID ?? row.userId ?? row.ownerId) !== uid) continue
    seen.add(id)
    const audience = text(row.audience).toLowerCase()
    const status = text(row.visibilityStatus ?? row.status).toLowerCase()
    if ((audience && audience !== 'public') || (status && status !== 'published' && status !== 'live')
      || enabled(row.deleted) || enabled(row.isDeleted)) continue
    const radiusKm = clampRadiusMeters(finite(row.radiusMeters ?? row.radius ?? row.organicRadiusMeters) ?? 0) / 1_000
    if (radiusKm <= 0) continue
    result.totalRadiusKm += radiusKm
    result.postCount++
    const post = normalizeLiveFeedPost(id, { ...row, ownerId: uid })
    if (post) result.posts.push(post)
    // Hidden origins cannot be inferred from leftover coordinate fields.
    if (row.locationVisibility !== 'approximate' || enabled(row.privateAccount) || enabled(row.ghostMode)) continue
    const lng = finite(row.originLongitude ?? row.longitude)
    const lat = finite(row.originLatitude ?? row.latitude)
    if (lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) continue
    result.claims.push({ id, coords: [lng, lat], radiusKm })
  }
  result.posts.sort((a, b) => b.createdAtMillis - a.createdAtMillis || a.id.localeCompare(b.id))
  return result
}
