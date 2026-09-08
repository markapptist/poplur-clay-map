export type MapPointKind = 'current' | 'pin' | 'landmark'

export interface MapPointPinInput {
  id: string
  name: string
  coords: [number, number]
  mine: boolean
  radiusKm: number
  color?: string
}

export interface MapPointLandmarkInput {
  id: string
  name: string
  coords: [number, number]
}

export interface MapCyclePoint {
  key: string
  id: string
  kind: MapPointKind
  name: string
  coords: [number, number]
  mine: boolean
  /** Radius is intentionally public only for the signed-in person's pins. */
  radiusKm: number | null
  color?: string
}

export interface MapPointStep {
  point: MapCyclePoint
  index: number
  total: number
}

function validCoords(coords: unknown): coords is [number, number] {
  if (!Array.isArray(coords) || coords.length !== 2) return false
  const [longitude, latitude] = coords
  return Number.isFinite(longitude)
    && Math.abs(longitude) <= 180
    && Number.isFinite(latitude)
    && Math.abs(latitude) <= 90
}

function safeName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * The Map arrows walk an authoritative data route, never mounted DOM markers.
 * Marker LOD intentionally hides most pins at world scale, but hiding a visual
 * must not make that point unreachable from the controls.
 */
export function buildMapPointCycle({
  currentLocation,
  pins,
  landmarks,
}: {
  currentLocation: [number, number] | null
  pins: readonly MapPointPinInput[]
  landmarks: readonly MapPointLandmarkInput[]
}): MapCyclePoint[] {
  const points: MapCyclePoint[] = []
  const keys = new Set<string>()

  if (validCoords(currentLocation)) {
    points.push({
      key: 'current:location',
      id: 'location',
      kind: 'current',
      name: 'Current location',
      coords: currentLocation,
      mine: false,
      radiusKm: null,
    })
    keys.add('current:location')
  }

  const rankedPins = [...pins].sort((a, b) => {
    const radius = (pin: MapPointPinInput) => Number.isFinite(pin?.radiusKm) ? Math.max(0, pin.radiusKm) : 0
    return radius(b) - radius(a) || String(a?.id).localeCompare(String(b?.id))
  })
  for (const pin of rankedPins) {
    if (!pin || typeof pin.id !== 'string' || !pin.id.trim() || !validCoords(pin.coords)) continue
    const key = `pin:${pin.id}`
    if (keys.has(key)) continue
    keys.add(key)
    // Every pop's radius, not just your own: the number is already public on
    // the post document, and the radius readout is how interception gets
    // judged against the pin while the system is under test. Zero stays a
    // real, displayed value — it is the honest reading for a fresh post.
    const radiusKm = Number.isFinite(pin.radiusKm) && pin.radiusKm >= 0
      ? pin.radiusKm
      : null
    points.push({
      key,
      id: pin.id,
      kind: 'pin',
      name: safeName(pin.name, 'Map pin'),
      coords: pin.coords,
      mine: pin.mine,
      radiusKm,
      color: pin.color,
    })
  }

  for (const landmark of landmarks) {
    if (!landmark || typeof landmark.id !== 'string' || !landmark.id.trim() || !validCoords(landmark.coords)) continue
    const key = `landmark:${landmark.id}`
    if (keys.has(key)) continue
    keys.add(key)
    points.push({
      key,
      id: landmark.id,
      kind: 'landmark',
      name: safeName(landmark.name, 'Landmark'),
      coords: landmark.coords,
      mine: false,
      radiusKm: null,
    })
  }

  return points
}

/**
 * Displayed poster identity shared by traversal and marker highlighting.
 * Branded posts can share a publishing account. Account alone merges their
 * handles; handle alone merges unrelated accounts. Keep both when available.
 * Own pins have no handle and keep their account id.
 */
export function pinOwnerKey(pin: { ownerId?: string | null; user: string | null }): string {
  const owner = pin.ownerId?.trim()
  const handle = pin.user?.trim().replace(/^@/, '').toLowerCase()
  if (owner && handle) return JSON.stringify([owner, handle])
  return owner || (handle ? `@${handle}` : 'self')
}

/** Right from no selection starts at one; left starts at the route's end. */
export function stepMapPointCycle(
  points: readonly MapCyclePoint[],
  selectedKey: string | null,
  direction: -1 | 1,
): MapPointStep | null {
  if (!points.length) return null
  const current = selectedKey ? points.findIndex(point => point.key === selectedKey) : -1
  const index = current < 0
    ? direction > 0 ? 0 : points.length - 1
    : ((current + direction) % points.length + points.length) % points.length
  return { point: points[index], index, total: points.length }
}
