import {
  DOMINANCE_OVERVIEW_MAX_ZOOM,
  type DominanceLeader,
} from './mapDominance'

export interface MapConquerRow {
  owner: string
  label: string
  color: string
  avatar: string | null
  radiusKm: number
  territories: number
  topPlace: string
  mine: boolean
  fame: number
}

export interface MapConquerSnapshot {
  scope: 'WORLD' | 'LOCAL'
  rows: MapConquerRow[]
  generatedAt: number
}

/** Enough rows for four six-line departure-board pages, while remaining a
 * tiny cross-frame payload and bounded on phones. */
export const MAP_CONQUER_ROW_LIMIT = 24

/** The full and compact departure boards share one restrained flip cadence. */
export const MAP_CONQUER_FLIP_MS = 4_800

/** The map glance is deliberately only a preview of the real board. */
export const MAP_CONQUER_GLANCE_ROW_LIMIT = 3

export function mapConquerGlanceRows(
  snapshot: MapConquerSnapshot | null,
  visible: boolean,
): MapConquerRow[] {
  if (!snapshot || !visible) return []
  return snapshot.rows.slice(0, MAP_CONQUER_GLANCE_ROW_LIMIT)
}

const SIMULATED_CONQUER_HANDLES = [
  'YOU',
  '@queenwest',
  '@nightmarket',
  '@baristabit',
  '@citysignal',
  '@alpastor',
  '@vinylvault',
  '@backstage',
  '@poutine.patrol',
  '@basement.set',
  '@streetcanvas',
  '@sunsetclub',
  '@northside',
  '@afterhours',
  '@kensington.eats',
  '@neonrunner',
  '@parkbench',
  '@cornerstore',
  '@skyline.fm',
  '@locallegend',
  '@westend.wav',
  '@citydesk',
  '@laneway',
  '@daybreak',
] as const

const SIMULATED_CONQUER_PLACES = [
  'Queen Street West',
  'Kensington Market',
  'Trinity Bellwoods',
  'Distillery District',
  'Harbourfront',
  'Ossington Avenue',
  'Yorkville',
  'The Annex',
  'Liberty Village',
  'Little Italy',
  'Roncesvalles',
  'Danforth',
] as const

const SIMULATED_CONQUER_COLORS = [
  '#f63b9a',
  '#24c7ff',
  '#7c5cff',
  '#ff8a34',
  '#17c995',
  '#f2b52d',
] as const

/** Deterministic, explicitly opt-in preview data for visual review of a full
 * four-page board. It never replaces a live map snapshot unless the Conquer
 * screen is opened with `?conquerPreview=filled`, where the UI labels it as
 * simulated data. */
export function createSimulatedMapConquerSnapshot(
  generatedAt = Date.now(),
): MapConquerSnapshot {
  return {
    scope: 'WORLD',
    generatedAt,
    rows: SIMULATED_CONQUER_HANDLES.map((label, index) => ({
      owner: index === 0 ? 'simulated-you' : `simulated-owner-${index}`,
      label,
      color: SIMULATED_CONQUER_COLORS[index % SIMULATED_CONQUER_COLORS.length],
      avatar: null,
      radiusKm: Number(Math.max(2.8, 49.5 - index * 1.72).toFixed(1)),
      territories: Math.max(1, 18 - Math.floor(index * 0.68)),
      topPlace: SIMULATED_CONQUER_PLACES[index % SIMULATED_CONQUER_PLACES.length],
      mine: index === 0,
      fame: 48_900 - index * 1_730,
    })),
  }
}

/** The full board fixture is a named review harness, never a fallback. A
 * misspelled or unrelated query therefore leaves the live snapshot path
 * completely untouched. */
export function conquerPreviewFromSearch(
  search: string,
  generatedAt = Date.now(),
): MapConquerSnapshot | null {
  return new URLSearchParams(search).get('conquerPreview') === 'filled'
    ? createSimulatedMapConquerSnapshot(generatedAt)
    : null
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** The map owns geographic sampling; the dedicated Conquer screen receives a
 * small settled snapshot so opening the leaderboard never retains a map or
 * starts a second WebGL surface behind it. */
export function createMapConquerSnapshot(
  rows: readonly DominanceLeader[],
  zoom: number,
  generatedAt = Date.now(),
): MapConquerSnapshot {
  return {
    scope: zoom <= DOMINANCE_OVERVIEW_MAX_ZOOM ? 'WORLD' : 'LOCAL',
    // Normalised at the source so the shell's reader never meets an absent
    // field. `avatar` is `string | null` on the wire, but a leader assembled
    // from a pin with no picture carried `undefined` here, which is neither —
    // and the reader, doing its job, rejected the whole board for it.
    rows: rows.slice(0, MAP_CONQUER_ROW_LIMIT).map(row => ({
      owner: row.owner,
      label: row.label,
      color: row.color,
      avatar: row.avatar ?? null,
      radiusKm: row.radiusKm,
      territories: row.territories,
      topPlace: row.topPlace ?? '',
      mine: row.mine,
      fame: row.fame,
    })),
    generatedAt,
  }
}

/** Cross-frame traffic is untrusted even on the same origin. Keep the shell's
 * cached board bounded and reject malformed rows before they reach the screen. */
export function readMapConquerSnapshot(value: unknown): MapConquerSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MapConquerSnapshot>
  if (candidate.scope !== 'WORLD' && candidate.scope !== 'LOCAL') return null
  if (!finiteNonNegative(candidate.generatedAt) || !Array.isArray(candidate.rows)) return null

  // One malformed row drops THAT row, never the board. This reader used to
  // return null for the whole snapshot on any bad field, and one field was
  // legitimately absent on every live board: a leader without a picture
  // arrived with `avatar: undefined`. The shell then kept the last snapshot
  // it had accepted — the empty one published before any post had loaded —
  // and the Conquer Board read "No conquered areas in view" over a map
  // covered in claims. Same for a missing place name: an empty string is a
  // truthful answer, a discarded board is not.
  const rows: MapConquerRow[] = []
  for (const raw of candidate.rows.slice(0, MAP_CONQUER_ROW_LIMIT)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Partial<MapConquerRow>
    if (typeof row.owner !== 'string' || typeof row.label !== 'string'
      || typeof row.color !== 'string'
      || !finiteNonNegative(row.radiusKm)
      || !finiteNonNegative(row.territories)
      || !finiteNonNegative(row.fame)
      || typeof row.mine !== 'boolean') continue
    rows.push({
      owner: row.owner.slice(0, 160),
      label: row.label.slice(0, 80),
      color: row.color.slice(0, 80),
      avatar: typeof row.avatar === 'string' ? row.avatar.slice(0, 2048) : null,
      radiusKm: row.radiusKm,
      territories: Math.floor(row.territories),
      topPlace: typeof row.topPlace === 'string' ? row.topPlace.slice(0, 160) : '',
      mine: row.mine,
      fame: Math.round(row.fame),
    })
  }
  return { scope: candidate.scope, rows, generatedAt: candidate.generatedAt }
}
