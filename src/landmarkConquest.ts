import { WORLD_LANDMARK_PRESENTATIONS } from './mapLandmarkCatalog'
import type { AuthoredPostClaim } from './authoredPosts'
import { haversineKm } from './reach'
import { isWorldRadiusKm } from './worldRadius'

const LABELS: Record<string, { name: string; place: string }> = {
  'big-ben': { name: 'Big Ben', place: 'London' },
  'burj-khalifa': { name: 'Burj Khalifa', place: 'Dubai' },
  'christ-redeemer': { name: 'Christ the Redeemer', place: 'Rio de Janeiro' },
  'cn-tower': { name: 'CN Tower', place: 'Toronto' },
  'rogers-centre': { name: 'Rogers Centre', place: 'Toronto' },
  colosseum: { name: 'Colosseum', place: 'Rome' },
  eiffel: { name: 'Eiffel Tower', place: 'Paris' },
  giza: { name: 'Pyramids of Giza', place: 'Giza' },
  'golden-gate': { name: 'Golden Gate Bridge', place: 'San Francisco' },
  'space-needle': { name: 'Space Needle', place: 'Seattle' },
  'statue-liberty': { name: 'Statue of Liberty', place: 'New York' },
  'sydney-opera': { name: 'Sydney Opera House', place: 'Sydney' },
  'taj-mahal': { name: 'Taj Mahal', place: 'Agra' },
}

/** Same grounded coordinates/models as Map, including its Toronto companion. */
export const CONQUER_LANDMARKS = WORLD_LANDMARK_PRESENTATIONS.map(landmark => ({
  id: landmark.id,
  ...LABELS[landmark.id],
  coords: landmark.coords,
  image: `sprites/conquer-landmarks/${landmark.id}-s320.png`,
})).sort((a, b) => a.name.localeCompare(b.name))

export function conqueredLandmarks(claims: readonly AuthoredPostClaim[]) {
  return CONQUER_LANDMARKS.map(landmark => {
    const coveringPostIds = claims.filter(claim => Number.isFinite(claim.radiusKm) && claim.radiusKm > 0
      && claim.coords.every(Number.isFinite)
      && (isWorldRadiusKm(claim.radiusKm) || haversineKm(claim.coords, landmark.coords) <= claim.radiusKm))
      .map(claim => claim.id)
    return { ...landmark, covered: coveringPostIds.length > 0, coveringPostIds: [...new Set(coveringPostIds)] }
  })
}
