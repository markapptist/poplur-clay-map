import { OTHER_POPS, PALETTE, POIS, type PopLevel } from './data'
import { dominanceLeaders, type DominancePinLike } from './mapDominance'
import { createMapConquerSnapshot, type MapConquerSnapshot } from './mapConquer'
import { radiusDeltaForChannel, radiusEngagementForChannel } from './radiusLedger'
import { takeoverTint } from './takeoverColor'

const NATIVE_WORLD_ZOOM_CUTOFF = 0.45

/** MapKit publishes a 0...1 logarithmic camera progress, while the shared
 * Conquer board names its context using Mapbox zoom. Keep the conversion at
 * this seam so both renderers choose the same world-versus-local board. */
export function nativeConquerScopeForZoom(progress: number): 'WORLD' | 'LOCAL' {
  return Number.isFinite(progress) && progress < NATIVE_WORLD_ZOOM_CUTOFF
    ? 'WORLD'
    : 'LOCAL'
}

export function createNativeMapConquerSnapshot({
  level,
  zoom,
  ownAvatar,
  generatedAt = Date.now(),
}: {
  level: PopLevel
  zoom: number
  ownAvatar: string | null
  generatedAt?: number
}): MapConquerSnapshot {
  const scope = nativeConquerScopeForZoom(zoom)
  const ownColor = takeoverTint(PALETTE.pinkHot)
  const mine: DominancePinLike[] = level === 'others' ? [] : POIS.map(poi => ({
    id: `pop-${poi.id}`,
    ownerId: 'self',
    user: null,
    name: poi.name,
    radiusKm: Math.max(0, poi.radiusKm + radiusDeltaForChannel(poi.channel)),
    color: ownColor,
    avatar: ownAvatar,
    mine: true,
    engagement: radiusEngagementForChannel(poi.channel),
  }))
  // At the world end Mapbox promotes regional holders. At local zoom it shows
  // the same nearby challenger seed as its detailed clay map, rather than
  // mixing far-away regional claims into a city board.
  const rivals: DominancePinLike[] = level === 'mine' ? [] : OTHER_POPS
    .filter(pop => scope === 'WORLD' ? pop.world : !pop.world)
    .map(pop => ({
      id: pop.id,
      ownerId: pop.user,
      user: pop.user,
      name: pop.name,
      radiusKm: pop.radiusKm,
      color: pop.color,
      avatar: pop.avatar,
      mine: false,
    }))

  // createMapConquerSnapshot owns the bounded, validated public payload.
  // These sentinel zooms select the same named scope without leaking native
  // renderer units into the Mapbox-oriented board contract.
  return createMapConquerSnapshot(
    dominanceLeaders([...rivals, ...mine], ownColor),
    scope === 'WORLD' ? 0 : 12,
    generatedAt,
  )
}
