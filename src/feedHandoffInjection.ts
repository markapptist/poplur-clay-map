import type { ChannelPost } from './FeedTwin'
import type { MapFeedHandoff } from './mapFeedHandoff'

// The Map → Feed handoff (VIEW IN FEED on a pin card), kept pure so it can be
// tested in node: FeedTwin itself touches `window` at import.

/** Pool ids are bare; a map pin's id carries the `firestore:` prefix. */
export function canonicalFeedPostId(id: string): string {
  return id.startsWith('firestore:') ? id.slice('firestore:'.length) : id
}

/** The handed-off pin as a feed post, for when the feed's own pool lacks it. */
export function channelPostFromHandoff(handoff: MapFeedHandoff, id: string): ChannelPost {
  return {
    id,
    user: handoff.username,
    video: handoff.mediaURL,
    poster: handoff.mediaType === 'photo' ? handoff.mediaURL : handoff.posterURL,
    mediaType: handoff.mediaType,
    caption: handoff.caption,
    reachKm: handoff.radiusMeters == null ? undefined : handoff.radiusMeters / 1_000,
    createdAtMillis: handoff.createdAtMillis || undefined,
    locationVisibility: handoff.locationVisibility,
    originLatitude: handoff.originLatitude,
    originLongitude: handoff.originLongitude,
  }
}

/**
 * Puts the handed-off post first in a channel's ranked list.
 *
 * If the pool already holds it, that row is moved to the front. If not — the
 * pool behind the feed is a newest-N window the native relay fills over time,
 * so a pin the Map is drawing RIGHT NOW can be absent here (aged out of the
 * window, or not delivered yet at the instant of the tap) — the post is stood
 * up from the handoff itself. Falling back to "whatever the channel has" was
 * the empty-static feed after VIEW IN FEED. The Map rendered that pin from the
 * same live source and the handoff carries the whole post, so this is safe;
 * when the relay later delivers the real row it has the same id and takes over
 * through the first branch.
 */
export function withHandoffPost(
  posts: ChannelPost[],
  channelId: string,
  focusedContent?: MapFeedHandoff | null,
): ChannelPost[] {
  if (!focusedContent || focusedContent.channelId !== channelId) return posts
  const focusedId = canonicalFeedPostId(focusedContent.id)
  const focusedPost = posts.find(post => post.id === focusedId)
  if (focusedPost) return [focusedPost, ...posts.filter(post => post.id !== focusedPost.id)]
  return [channelPostFromHandoff(focusedContent, focusedId), ...posts]
}
