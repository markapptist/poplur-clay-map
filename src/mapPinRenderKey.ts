import type { PopPin } from './ClayMap'

/**
 * Every value captured by a rendered marker or its click handler belongs in
 * this identity. Firestore may change a post without changing its id; when it
 * does, ClayMap must rebuild that marker so its coordinate, accessible label,
 * artwork, and popup payload all describe the same current document.
 */
export function mapPinRenderKey(pin: PopPin): string {
  const engagement = pin.engagement
  return JSON.stringify({
    id: pin.id,
    ownerId: pin.ownerId ?? null,
    user: pin.user,
    name: pin.name,
    coords: pin.coords,
    radiusKm: pin.radiusKm,
    radiusDeltaKm: pin.radiusDeltaKm ?? null,
    color: pin.color,
    avatar: pin.avatar,
    selfieVideo: pin.selfieVideo ?? null,
    engagement: engagement ? {
      views: engagement.views ?? null,
      repeatViews: engagement.repeatViews ?? null,
      upvotes: engagement.upvotes ?? null,
      downvotes: engagement.downvotes ?? null,
      comments: engagement.comments ?? null,
      profileVisits: engagement.profileVisits ?? null,
    } : null,
    channel: pin.channel ?? null,
    media: pin.media ?? null,
    world: pin.world ?? false,
    mine: pin.mine ?? false,
    ghost: pin.ghost ?? false,
    pinColor: pin.pinColor ?? null,
    syntheticPostId: pin.syntheticPostId ?? null,
  })
}
