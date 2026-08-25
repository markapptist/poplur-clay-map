export interface LandmarkRendererCandidate {
  id: string
  coords: readonly [number, number]
}

/**
 * Pick the grounded landmark that the current camera framing is presenting.
 * Nearby landmarks can share an activation radius (CN Tower and Rogers Centre
 * are only a few hundred metres apart), but registration order must not decide
 * which one survives a constrained phone's renderer budget.
 *
 * Equirectangular distance is accurate at neighbourhood scale and cheaper than
 * a full haversine for a choice made on each settled map move.
 */
export function preferredLandmarkRendererId(
  center: readonly [number, number],
  candidates: readonly LandmarkRendererCandidate[],
): string | null {
  if (candidates.length === 0) return null

  const longitudeScale = Math.cos(center[1] * Math.PI / 180)
  let preferred = candidates[0]
  let preferredDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const longitudeDistance = (candidate.coords[0] - center[0]) * longitudeScale
    const latitudeDistance = candidate.coords[1] - center[1]
    const distance = longitudeDistance ** 2 + latitudeDistance ** 2
    if (distance < preferredDistance) {
      preferred = candidate
      preferredDistance = distance
    }
  }

  return preferred.id
}
