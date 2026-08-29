/**
 * Deterministic, demo-only fixtures for the in-Poplur radius-domination
 * preview. Nothing in this module reads or writes live claim state.
 *
 * Ownership identity is deliberately independent from presentation themes:
 * the source fixtures retain stable owner colours for pins/rims/ranks, while
 * the preview layer may repaint held ground with a seasonal material palette.
 */

export const RADIUS_PREVIEW_OWNER_PALETTE = [
  { id: 'mine', label: 'YOU', color: '#EC3E91', outline: '#FFD0E8' },
  { id: 'leo', label: 'LEO', color: '#34BEEB', outline: '#C9F5FF' },
  { id: 'sophie', label: 'SOPHIE', color: '#F2A11D', outline: '#FFE3A2' },
  { id: 'milo', label: 'MILO', color: '#9560E4', outline: '#E1CFFF' },
  { id: 'orbit', label: 'ORBIT', color: '#96C63C', outline: '#E1FFAE' },
  { id: 'citydesk', label: '@CITYDESK', color: '#EF6C62', outline: '#FFD2CD' },
  { id: 'skylar', label: 'SKYLAR', color: '#3F7FE8', outline: '#C9DDFF' },
  { id: 'luna', label: 'LUNA', color: '#F3BC2A', outline: '#FFECAC' },
] as const

export type RadiusPreviewOwnerId = (typeof RADIUS_PREVIEW_OWNER_PALETTE)[number]['id']

export const RADIUS_PREVIEW_UNCLAIMED_COLOR = '#A79FC7'

export type RadiusPreviewSceneId =
  | 'leader-pins'
  | 'regional-leaders'
  | 'contested'
  | 'selected-radius'
  | 'territories'
  | 'my-property'
  | 'world'

export type RadiusPreviewThemeId =
  | 'original'
  | 'christmas'
  | 'halloween'
  | 'lunar-new-year'
  | 'valentine'
  | 'pride'

export interface RadiusPreviewCamera {
  center: readonly [number, number]
  zoom: number
  pitch: number
  bearing: number
}

export type RadiusPreviewTerritoryStatus =
  | 'mine'
  | 'leader'
  | 'owned'
  | 'contested'
  | 'unclaimed'

export interface RadiusPreviewTerritoryProperties {
  id: string
  ownerId: RadiusPreviewOwnerId | 'unclaimed'
  ownerLabel: string
  color: string
  outline: string
  status: RadiusPreviewTerritoryStatus
  rank: number
  power: number
  selected: boolean
  contested: boolean
}

export interface RadiusPreviewPinProperties {
  id: string
  ownerId: RadiusPreviewOwnerId
  ownerLabel: string
  color: string
  outline: string
  label: string
  rank: number
  metric: string
  crown: boolean
}

export interface RadiusPreviewScene {
  id: RadiusPreviewSceneId
  title: string
  eyebrow: string
  summary: string
  camera: RadiusPreviewCamera
  territories: GeoJSON.FeatureCollection<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>
  pins: GeoJSON.FeatureCollection<GeoJSON.Point, RadiusPreviewPinProperties>
}

export interface RadiusPreviewTheme {
  id: RadiusPreviewThemeId
  label: string
  eyebrow: string
  className: string
  decorations: readonly string[]
  chromeAccents: readonly string[]
}

export interface RadiusPreviewReference {
  id: string
  sceneId: RadiusPreviewSceneId
  themeId: RadiusPreviewThemeId
  title: string
  referenceNumber: number
}

const paletteById = Object.fromEntries(
  RADIUS_PREVIEW_OWNER_PALETTE.map((owner) => [owner.id, owner]),
) as Record<RadiusPreviewOwnerId, (typeof RADIUS_PREVIEW_OWNER_PALETTE)[number]>

const owner = (ownerId: RadiusPreviewOwnerId) => paletteById[ownerId]

function closedRing(points: readonly (readonly [number, number])[]): [number, number][] {
  const ring = points.map(([longitude, latitude]) => [longitude, latitude] as [number, number])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first])
  return ring
}

function polygonTerritory(
  id: string,
  points: readonly (readonly [number, number])[],
  ownerId: RadiusPreviewOwnerId | 'unclaimed',
  options: Partial<Pick<
    RadiusPreviewTerritoryProperties,
    'status' | 'rank' | 'power' | 'selected' | 'contested'
  >> = {},
): GeoJSON.Feature<GeoJSON.Polygon, RadiusPreviewTerritoryProperties> {
  const identity = ownerId === 'unclaimed'
    ? { label: 'UNCLAIMED', color: RADIUS_PREVIEW_UNCLAIMED_COLOR, outline: '#E8E4F3' }
    : owner(ownerId)
  return {
    type: 'Feature',
    properties: {
      id,
      ownerId,
      ownerLabel: identity.label,
      color: identity.color,
      outline: identity.outline,
      status: options.status ?? (ownerId === 'mine' ? 'mine' : ownerId === 'unclaimed' ? 'unclaimed' : 'owned'),
      rank: options.rank ?? 0,
      power: options.power ?? 0,
      selected: options.selected ?? false,
      contested: options.contested ?? false,
    },
    geometry: { type: 'Polygon', coordinates: [closedRing(points)] },
  }
}

function parcelHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Demo-only claim mask shaped like an irregular map parcel. The size still
 * derives from the authored radius, but the geometry is deliberately angular
 * and deterministic: it is never rendered as a radius ring or circle.
 */
function parcelTerritory(
  id: string,
  center: readonly [number, number],
  radiusKm: number,
  ownerId: RadiusPreviewOwnerId | 'unclaimed',
  options: Partial<Pick<
    RadiusPreviewTerritoryProperties,
    'status' | 'rank' | 'power' | 'selected' | 'contested'
  >> & { wobble?: number; phase?: number } = {},
): GeoJSON.Feature<GeoJSON.Polygon, RadiusPreviewTerritoryProperties> {
  const [longitude, latitude] = center
  const kmPerDegreeLatitude = 110.574
  const kmPerDegreeLongitude = Math.max(18, 111.32 * Math.cos((latitude * Math.PI) / 180))
  const seed = parcelHash(id)
  const steps = 7 + (seed % 3)
  const wobble = options.wobble ?? 0
  const phase = options.phase ?? (((seed >>> 8) % 360) * Math.PI) / 180
  const longitudeScale = 0.82 + ((seed >>> 14) % 19) / 100
  const latitudeScale = 0.78 + ((seed >>> 20) % 23) / 100
  const points = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2
    const vertexSeed = parcelHash(`${id}:${index}`)
    const deterministicNotch = 0.76 + (vertexSeed % 31) / 100
    const authoredVariation = wobble * Math.sin(angle * 2 + phase)
    const shapedRadius = radiusKm * Math.max(0.58, deterministicNotch + authoredVariation)
    return [
      longitude + (shapedRadius * longitudeScale / kmPerDegreeLongitude) * Math.cos(angle + phase),
      latitude + (shapedRadius * latitudeScale / kmPerDegreeLatitude) * Math.sin(angle + phase),
    ] as const
  })
  return polygonTerritory(id, points, ownerId, options)
}

function previewPin(
  id: string,
  coordinates: readonly [number, number],
  ownerId: RadiusPreviewOwnerId,
  options: { label: string; rank?: number; metric?: string; crown?: boolean },
): GeoJSON.Feature<GeoJSON.Point, RadiusPreviewPinProperties> {
  const identity = owner(ownerId)
  return {
    type: 'Feature',
    properties: {
      id,
      ownerId,
      ownerLabel: identity.label,
      color: identity.color,
      outline: identity.outline,
      label: options.label,
      rank: options.rank ?? 0,
      metric: options.metric ?? '',
      crown: options.crown ?? false,
    },
    geometry: { type: 'Point', coordinates: [...coordinates] },
  }
}

const featureCollection = <Geometry extends GeoJSON.Geometry, Properties>(
  features: GeoJSON.Feature<Geometry, Properties>[],
): GeoJSON.FeatureCollection<Geometry, Properties> => ({ type: 'FeatureCollection', features })

const EIFFEL: readonly [number, number] = [2.2945, 48.8584]

const leaderPinsScene: RadiusPreviewScene = {
  id: 'leader-pins',
  title: 'Leader pins',
  eyebrow: 'RADIUS DOMINATION · LOCAL',
  summary: 'Ranked owners mark irregular claimed parcels while the terrain and buildings carry each owner colour.',
  camera: { center: EIFFEL, zoom: 13.15, pitch: 38, bearing: -16 },
  territories: featureCollection([
    parcelTerritory('leader-leo', [2.282, 48.865], 1.45, 'leo', { status: 'leader', rank: 1, power: 92 }),
    parcelTerritory('leader-sophie', [2.309, 48.857], 1.12, 'sophie', { status: 'leader', rank: 2, power: 87 }),
    parcelTerritory('leader-mine', [2.277, 48.847], 0.96, 'mine', { status: 'mine', rank: 3, power: 82 }),
    parcelTerritory('leader-milo', [2.309, 48.842], 1.2, 'milo', { status: 'owned', rank: 4, power: 75 }),
  ]),
  pins: featureCollection([
    previewPin('pin-leo', [2.282, 48.865], 'leo', { label: '#1 LEO', rank: 1, metric: '4.8 km', crown: true }),
    previewPin('pin-sophie', [2.309, 48.857], 'sophie', { label: '#2 SOPHIE', rank: 2, metric: '3.2 km' }),
    previewPin('pin-mine', [2.277, 48.847], 'mine', { label: 'YOU', rank: 3, metric: '2.7 km' }),
    previewPin('pin-milo', [2.309, 48.842], 'milo', { label: 'MILO', rank: 4, metric: '3.9 km' }),
  ]),
}

const regionalLeadersScene: RadiusPreviewScene = {
  id: 'regional-leaders',
  title: 'Regional leaders',
  eyebrow: 'RADIUS DOMINATION · REGIONAL',
  summary: 'At continent scale only the top three readable regional leaders remain labelled.',
  camera: { center: [-100, 42], zoom: 2.05, pitch: 0, bearing: 0 },
  territories: featureCollection([
    polygonTerritory('region-west', [[-168, 72], [-104, 72], [-104, 15], [-128, 8], [-152, 32]], 'sophie', { status: 'leader', rank: 3, power: 78 }),
    polygonTerritory('region-central', [[-104, 72], [-78, 67], [-76, 10], [-104, 15]], 'leo', { status: 'leader', rank: 2, power: 86 }),
    polygonTerritory('region-east', [[-78, 67], [-48, 62], [-52, 12], [-76, 10]], 'mine', { status: 'leader', rank: 1, power: 94 }),
  ]),
  pins: featureCollection([
    previewPin('region-pin-west', [-122, 40], 'sophie', { label: '#3 WEST', rank: 3, metric: '1,080 km' }),
    previewPin('region-pin-central', [-93, 39], 'leo', { label: '#2 CENTRAL', rank: 2, metric: '1,405 km' }),
    previewPin('region-pin-east', [-70, 44], 'mine', { label: '#1 EAST', rank: 1, metric: '1,620 km', crown: true }),
  ]),
}

const contestedScene: RadiusPreviewScene = {
  id: 'contested',
  title: 'Contested overlap',
  eyebrow: 'RADIUS DOMINATION · LIVE CONTEST',
  summary: 'Overlapping parcels resolve deterministically by domination power while the owner pin shows the live comparison.',
  camera: { center: [2.302, 48.858], zoom: 12.55, pitch: 34, bearing: -10 },
  territories: featureCollection([
    parcelTerritory('contest-citydesk', [2.314, 48.857], 3.4, 'mine', { status: 'contested', power: 82, contested: true }),
    parcelTerritory('contest-skylar', [2.278, 48.861], 3.1, 'leo', { status: 'contested', power: 71, contested: true }),
  ]),
  pins: featureCollection([
    previewPin('contest-pin', [2.302, 48.858], 'mine', { label: 'CONTESTED · @CITYDESK', metric: '82 vs 71', crown: true }),
  ]),
}

const selectedRadiusScene: RadiusPreviewScene = {
  id: 'selected-radius',
  title: 'Selected radius',
  eyebrow: 'RADIUS DOMINATION · SELECTED',
  summary: 'Selection keeps the same parcel paint and identifies the owner with a point marker, never a radius halo.',
  camera: { center: [2.302, 48.856], zoom: 13.25, pitch: 36, bearing: -14 },
  territories: featureCollection([
    parcelTerritory('selected-mine', [2.298, 48.852], 1.62, 'mine', { status: 'mine', power: 88, selected: true }),
    parcelTerritory('selected-sophie', [2.322, 48.861], 1.05, 'sophie', { power: 66, wobble: 0.12, phase: 1.1 }),
    parcelTerritory('selected-leo', [2.278, 48.867], 1.1, 'leo', { power: 71, wobble: 0.1, phase: 2.2 }),
  ]),
  pins: featureCollection([
    previewPin('selected-pin', [2.298, 48.852], 'mine', { label: 'SELECTED RADIUS', metric: '2.7 km' }),
  ]),
}

const territoriesScene: RadiusPreviewScene = {
  id: 'territories',
  title: 'Territory patches',
  eyebrow: 'RADIUS DOMINATION · HELD GROUND',
  summary: 'Adjacent claims merge into readable clay patches; unclaimed ground stays neutral.',
  camera: { center: [2.302, 48.857], zoom: 12.75, pitch: 32, bearing: -12 },
  territories: featureCollection([
    parcelTerritory('territory-mine', [2.295, 48.862], 2.4, 'mine', { status: 'mine', power: 90, wobble: 0.18, phase: 0.2 }),
    parcelTerritory('territory-citydesk', [2.326, 48.848], 2.2, 'leo', { power: 84, wobble: 0.16, phase: 1.8 }),
    parcelTerritory('territory-unclaimed', [2.267, 48.844], 1.7, 'unclaimed', { status: 'unclaimed', wobble: 0.2, phase: 2.9 }),
  ]),
  pins: featureCollection([
    previewPin('territory-pin-mine', [2.295, 48.862], 'mine', { label: 'MY RADIUS', metric: '4.8 km' }),
    previewPin('territory-pin-citydesk', [2.326, 48.848], 'leo', { label: '@CITYDESK', metric: '3.9 km' }),
  ]),
}

const myPropertyScene: RadiusPreviewScene = {
  id: 'my-property',
  title: 'My territory',
  eyebrow: 'POPLUR PROPERTY · OWNER VIEW',
  summary: 'The coordinate leader owns this block, earns from verified foot traffic, and themes only the already-capped nearby buildings.',
  camera: { center: [2.2982, 48.8581], zoom: 17.15, pitch: 32, bearing: -12 },
  territories: featureCollection([
    parcelTerritory('property-mine', [2.2982, 48.8581], 0.34, 'mine', {
      status: 'mine',
      rank: 1,
      power: 88,
      selected: true,
      wobble: 0.08,
      phase: 0.4,
    }),
    parcelTerritory('property-leo', [2.304, 48.8603], 0.28, 'leo', {
      status: 'owned',
      rank: 2,
      power: 81,
      wobble: 0.08,
      phase: 1.7,
    }),
    parcelTerritory('property-sophie', [2.2938, 48.8548], 0.25, 'sophie', {
      status: 'owned',
      rank: 3,
      power: 74,
      wobble: 0.08,
      phase: 2.8,
    }),
  ]),
  pins: featureCollection([
    previewPin('property-pin-mine', [2.2982, 48.8581], 'mine', {
      label: '#1 · YOUR PROPERTY',
      rank: 1,
      metric: '3× local feed',
      crown: true,
    }),
  ]),
}

const worldTerritories: GeoJSON.Feature<GeoJSON.Polygon, RadiusPreviewTerritoryProperties>[] = [
  polygonTerritory('world-canada-west', [[-168, 72], [-112, 72], [-108, 49], [-141, 49]], 'mine', { power: 88 }),
  polygonTerritory('world-canada-east', [[-112, 72], [-52, 66], [-52, 45], [-108, 49]], 'milo', { power: 72 }),
  polygonTerritory('world-usa-west', [[-126, 49], [-104, 49], [-102, 25], [-122, 31]], 'sophie', { power: 79 }),
  polygonTerritory('world-usa-east', [[-104, 49], [-66, 47], [-81, 25], [-102, 25]], 'leo', { power: 85 }),
  polygonTerritory('world-mexico', [[-118, 32], [-86, 24], [-92, 14], [-105, 19]], 'orbit', { power: 62 }),
  polygonTerritory('world-south-america-north', [[-82, 12], [-50, 10], [-44, -10], [-76, -9]], 'luna', { power: 69 }),
  polygonTerritory('world-south-america-west', [[-80, -8], [-62, -10], [-65, -40], [-74, -52]], 'citydesk', { power: 64 }),
  polygonTerritory('world-south-america-east', [[-62, -10], [-44, -10], [-50, -35], [-65, -40]], 'milo', { power: 67 }),
  polygonTerritory('world-south-america-south', [[-65, -40], [-50, -35], [-57, -55], [-74, -52]], 'skylar', { power: 58 }),
  polygonTerritory('world-europe-west', [[-11, 59], [13, 60], [15, 37], [-10, 36]], 'mine', { power: 91 }),
  polygonTerritory('world-europe-central', [[13, 60], [32, 60], [30, 37], [15, 37]], 'skylar', { power: 83 }),
  polygonTerritory('world-europe-east', [[32, 60], [58, 56], [48, 35], [30, 37]], 'sophie', { power: 75 }),
  polygonTerritory('world-africa-north', [[-17, 36], [50, 35], [42, 12], [-12, 14]], 'citydesk', { power: 73 }),
  polygonTerritory('world-africa-west', [[-17, 14], [14, 14], [18, -10], [-8, -2]], 'leo', { power: 70 }),
  polygonTerritory('world-africa-east', [[14, 14], [50, 12], [42, -19], [18, -10]], 'mine', { power: 77 }),
  polygonTerritory('world-africa-south', [[18, -10], [42, -19], [31, -35], [12, -30]], 'milo', { power: 65 }),
  polygonTerritory('world-russia-west', [[35, 72], [95, 75], [89, 47], [43, 49]], 'luna', { power: 82 }),
  polygonTerritory('world-russia-east', [[95, 75], [178, 68], [155, 45], [89, 47]], 'milo', { power: 74 }),
  polygonTerritory('world-middle-east', [[35, 39], [67, 39], [61, 17], [37, 16]], 'sophie', { power: 66 }),
  polygonTerritory('world-central-asia', [[67, 49], [107, 52], [100, 30], [67, 32]], 'orbit', { power: 68 }),
  polygonTerritory('world-india', [[67, 31], [91, 29], [82, 7], [70, 8]], 'skylar', { power: 80 }),
  polygonTerritory('world-china', [[91, 47], [129, 50], [124, 20], [91, 29]], 'mine', { power: 89 }),
  polygonTerritory('world-east-asia', [[129, 50], [151, 47], [145, 20], [124, 20]], 'citydesk', { power: 76 }),
  polygonTerritory('world-southeast-asia', [[91, 20], [145, 20], [132, -10], [102, -7]], 'orbit', { power: 71 }),
  polygonTerritory('world-australia-west', [[112, -11], [133, -11], [133, -43], [112, -34]], 'sophie', { power: 78 }),
  polygonTerritory('world-australia-east', [[133, -11], [154, -10], [153, -39], [133, -43]], 'skylar', { power: 84 }),
]

const worldScene: RadiusPreviewScene = {
  id: 'world',
  title: 'World ownership',
  eyebrow: 'WORLD · ALL POSTS',
  summary: 'At the world end-stop, bounded coloured regions show many owners while only global leaders retain labels.',
  camera: { center: [5, 18], zoom: 1.15, pitch: 0, bearing: 0 },
  territories: featureCollection(worldTerritories),
  pins: featureCollection([
    previewPin('world-count-north-america', [-112, 57], 'mine', { label: '2.4K', metric: 'posts' }),
    previewPin('world-count-central', [-90, 46], 'leo', { label: '918', metric: 'posts' }),
    previewPin('world-count-europe', [24, 54], 'skylar', { label: '#2 SKYLAR', rank: 2, crown: true }),
    previewPin('world-count-africa', [25, 6], 'citydesk', { label: '612', metric: 'posts' }),
    previewPin('world-count-asia', [108, 54], 'sophie', { label: '1.7K', metric: 'posts' }),
    previewPin('world-luna', [137, 38], 'mine', { label: '#3 LUNA', rank: 3, crown: true }),
    previewPin('world-orbit', [83, 7], 'orbit', { label: '#4 ORBIT', rank: 4, crown: true }),
    previewPin('world-zenith', [-52, -33], 'sophie', { label: '#5 ZENITH', rank: 5, crown: true }),
    previewPin('world-australia', [137, -25], 'skylar', { label: '738', metric: 'posts' }),
  ]),
}

export const RADIUS_PREVIEW_SCENES: Readonly<Record<RadiusPreviewSceneId, RadiusPreviewScene>> = {
  'leader-pins': leaderPinsScene,
  'regional-leaders': regionalLeadersScene,
  contested: contestedScene,
  'selected-radius': selectedRadiusScene,
  territories: territoriesScene,
  'my-property': myPropertyScene,
  world: worldScene,
}

export const RADIUS_PREVIEW_THEMES: Readonly<Record<RadiusPreviewThemeId, RadiusPreviewTheme>> = {
  original: {
    id: 'original',
    label: 'Original',
    eyebrow: 'POPLUR MAP',
    className: 'original',
    decorations: [],
    chromeAccents: ['#EC3E91', '#34BEEB'],
  },
  christmas: {
    id: 'christmas',
    label: 'Christmas',
    eyebrow: 'CHRISTMAS MAP',
    className: 'christmas',
    decorations: ['❄', '🎄', '🎁'],
    chromeAccents: ['#E9415F', '#F7F2E8'],
  },
  halloween: {
    id: 'halloween',
    label: 'Halloween',
    eyebrow: 'HALLOWEEN MAP',
    className: 'halloween',
    decorations: ['🎃', '🦇', '🌙'],
    chromeAccents: ['#F28A25', '#6E3A91'],
  },
  'lunar-new-year': {
    id: 'lunar-new-year',
    label: 'Lunar New Year',
    eyebrow: 'LUNAR NEW YEAR MAP',
    className: 'lunarNewYear',
    decorations: ['🏮', '✨', '🧧'],
    chromeAccents: ['#D7372F', '#E8B84A'],
  },
  valentine: {
    id: 'valentine',
    label: "Valentine's",
    eyebrow: "VALENTINE'S MAP",
    className: 'valentine',
    decorations: ['♥', '💌', '♡'],
    chromeAccents: ['#F05A9D', '#FFD2E6'],
  },
  pride: {
    id: 'pride',
    label: 'Pride',
    eyebrow: 'PRIDE MAP',
    className: 'pride',
    decorations: ['♥', '✦', '●'],
    chromeAccents: ['#FF476F', '#FF9D28', '#F4D53E', '#58C56B', '#31AEEF', '#A45BE1'],
  },
}

export const RADIUS_PREVIEW_REFERENCES: readonly RadiusPreviewReference[] = [
  { id: 'leader-pins', sceneId: 'leader-pins', themeId: 'original', title: 'Leader pins', referenceNumber: 1 },
  { id: 'regional-leaders', sceneId: 'regional-leaders', themeId: 'original', title: 'Regional leaders', referenceNumber: 2 },
  { id: 'contested', sceneId: 'contested', themeId: 'original', title: 'Contested overlap', referenceNumber: 3 },
  { id: 'selected-radius', sceneId: 'selected-radius', themeId: 'original', title: 'Selected radius', referenceNumber: 4 },
  { id: 'territories', sceneId: 'territories', themeId: 'original', title: 'Territory patches', referenceNumber: 5 },
  { id: 'world', sceneId: 'world', themeId: 'original', title: 'World ownership', referenceNumber: 6 },
  { id: 'world-christmas', sceneId: 'world', themeId: 'christmas', title: 'Christmas world', referenceNumber: 7 },
  { id: 'world-halloween', sceneId: 'world', themeId: 'halloween', title: 'Halloween world', referenceNumber: 8 },
  { id: 'world-lunar-new-year', sceneId: 'world', themeId: 'lunar-new-year', title: 'Lunar New Year world', referenceNumber: 9 },
  { id: 'world-valentine', sceneId: 'world', themeId: 'valentine', title: "Valentine's world", referenceNumber: 10 },
  { id: 'world-pride', sceneId: 'world', themeId: 'pride', title: 'Pride world', referenceNumber: 11 },
  { id: 'my-property', sceneId: 'my-property', themeId: 'original', title: 'My territory economy', referenceNumber: 12 },
] as const

export function radiusPreviewData(sceneId: RadiusPreviewSceneId): RadiusPreviewScene {
  return RADIUS_PREVIEW_SCENES[sceneId]
}

export function radiusPreviewReferenceData(referenceId: string): {
  reference: RadiusPreviewReference
  scene: RadiusPreviewScene
  theme: RadiusPreviewTheme
} {
  const reference = RADIUS_PREVIEW_REFERENCES.find((candidate) => candidate.id === referenceId)
    ?? RADIUS_PREVIEW_REFERENCES[0]
  return {
    reference,
    scene: radiusPreviewData(reference.sceneId),
    theme: RADIUS_PREVIEW_THEMES[reference.themeId],
  }
}

export function isRadiusPreviewSceneId(value: string | null | undefined): value is RadiusPreviewSceneId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(RADIUS_PREVIEW_SCENES, value))
}

export function isRadiusPreviewThemeId(value: string | null | undefined): value is RadiusPreviewThemeId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(RADIUS_PREVIEW_THEMES, value))
}
