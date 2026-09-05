import { feedPostReachesViewer } from './feedDiscovery'
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
 * the empty-static feed after VIEW IN FEED.
 *
 * Recovering a post is NOT the same as trusting one. The payload arrives from
 * the map document, so the recovered post must clear the same gates the pool's
 * own rows clear — earned reach, and the viewer's hidden list — or a stale pin
 * could put a post on the board that the viewer was never entitled to see.
 * That is the rule feedRealtimePolicy guards: a handoff may reorder and
 * recover, never resurrect. When the relay later delivers the real row it has
 * the same id and takes over through the first branch.
 */
export function withHandoffPost(
  posts: ChannelPost[],
  channelId: string,
  focusedContent?: MapFeedHandoff | null,
  eligibility: {
    viewer?: readonly [number, number] | null
    hiddenPostIds?: readonly string[]
  } = {},
): ChannelPost[] {
  if (!focusedContent || focusedContent.channelId !== channelId) return posts
  const focusedId = canonicalFeedPostId(focusedContent.id)
  const focusedPost = posts.find(post => post.id === focusedId)
  if (focusedPost) return [focusedPost, ...posts.filter(post => post.id !== focusedPost.id)]
  // The pool does not hold it. Standing the post up from the handoff payload
  // is only legitimate for a post that would have been delivered anyway, so
  // it faces the same two gates the pool's own rows pass: the earned-reach
  // rule, and the viewer's hidden list. A handoff reorders and recovers what
  // the viewer is entitled to see; it never grants reach an author has not
  // earned, and never revives something the viewer dismissed.
  if (eligibility.hiddenPostIds?.includes(focusedId)) return posts
  if (!feedPostReachesViewer(focusedContent, eligibility.viewer ?? null)) return posts
  return [channelPostFromHandoff(focusedContent, focusedId), ...posts]
}
