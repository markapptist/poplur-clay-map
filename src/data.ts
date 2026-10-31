import { feedUrl } from './assetPacks'
import { activeHoliday } from './seasonalCalendar'

export const PALETTE = {
  bg: '#050407',
  charcoal: '#111014',
  road: '#09080A',
  roadHighlight: '#2A252B',
  pink: '#F63B9A',
  pinkHot: '#FF4BA1',
  pinkSoft: '#FF8AC6',
  water: '#2577c9', // vivid toy blue, matching the clay globe reference
  land: '#62B548',
  greenDark: '#2F6E35',
  white: '#FFF2F8',
  labelBg: 'rgba(12, 12, 14, 0.86)',
}

export const CENTER: [number, number] = [-79.3832, 43.6532]

// ── Map themes matching the app's cube skins (CubeSkinStore) ────────────────
export interface MapTheme {
  id: string
  name: string
  accent: string      // stitches, caps, labels — the skin's hero colour
  accentHot: string   // brighter accent for highlights
  accentDeep: string  // darker accent for building variants
  land: string
  park: string
  water: string
  road: string
  roadRim: string
  buildingDark: string
  /** Ground for the night daypart. Without it night uses the shared dusk
   *  palette; a holiday keeps its own colours after dark. */
  night?: Pick<MapTheme, 'land' | 'park' | 'water' | 'road' | 'roadRim' | 'buildingDark'>
}

export const MAP_THEMES: MapTheme[] = [
  {
    id: 'clay', name: 'Poplur Clay',
    accent: '#F63B9A', accentHot: '#FF4BA1', accentDeep: '#c72e7e',
    land: '#4da42f', park: '#66c342', water: '#2b82dd',
    road: '#09080A', roadRim: '#2A252B', buildingDark: '#161116',
  },
  {
    id: 'standard', name: 'Rubber Blue',
    accent: '#29a6e6', accentHot: '#2ee0ff', accentDeep: '#1d7cb3',
    land: '#3f9e46', park: '#57bd5e', water: '#1c66c9',
    road: '#09080A', roadRim: '#252a2e', buildingDark: '#12151a',
  },
  {
    id: 'gold', name: 'Gold',
    accent: '#f0c22e', accentHot: '#ffd94d', accentDeep: '#b8862f',
    land: '#7a9e2f', park: '#96bd43', water: '#1c6fb8',
    road: '#0a0906', roadRim: '#2e2a1c', buildingDark: '#1a150e',
  },
  {
    id: 'toy', name: 'Toy Red',
    accent: '#f23535', accentHot: '#ff5a4d', accentDeep: '#b32424',
    land: '#52ab3a', park: '#6cc94e', water: '#1e78d6',
    road: '#09080A', roadRim: '#2e2222', buildingDark: '#181112',
  },
  {
    id: 'camo', name: 'Camo',
    accent: '#8fa63e', accentHot: '#b5cc55', accentDeep: '#5d7028',
    land: '#3e6e28', park: '#547f35', water: '#2f5f56',
    road: '#0a0a08', roadRim: '#262a1e', buildingDark: '#141610',
  },
  {
    id: 'ice', name: 'Ice',
    accent: '#8fdcff', accentHot: '#c8f0ff', accentDeep: '#4fa8d6',
    land: '#7cc2b8', park: '#9adcd2', water: '#1d5f9e',
    road: '#0a0c0e', roadRim: '#26303a', buildingDark: '#131a20',
  },
]

// ── Holiday maps ────────────────────────────────────────────────────────────
// The live map wears these on their holidays (seasonalCalendar.ts). Colours
// follow the holiday building themes and preview palettes already in the app
// (buildingOwnershipTheme.ts, radiusPreviewMapPresentation.ts). Claimed ground
// still wears its owner's colour, exactly as on the clay map.
export const HOLIDAY_MAP_THEMES: MapTheme[] = [
  {
    id: 'halloween', name: 'Halloween',
    accent: '#F28A25', accentHot: '#FF9D31', accentDeep: '#B8621A',
    land: '#4A3260', park: '#55702A', water: '#231B55',
    road: '#09080A', roadRim: '#3A2440', buildingDark: '#1A1024',
    night: {
      land: '#24173A', park: '#26381F', water: '#0E0C2A',
      road: '#07060C', roadRim: '#4A2A50', buildingDark: '#120A1C',
    },
  },
  {
    id: 'christmas', name: 'Christmas',
    accent: '#E9415F', accentHot: '#FF6B7F', accentDeep: '#A82B44',
    land: '#C9D8D2', park: '#2F6E50', water: '#2B6FB3',
    road: '#09080A', roadRim: '#2A2F2E', buildingDark: '#1B2A24',
    night: {
      land: '#3A4A5C', park: '#1D3A30', water: '#0B234F',
      road: '#090812', roadRim: '#3C4654', buildingDark: '#111A20',
    },
  },
  {
    id: 'valentine', name: "Valentine's",
    accent: '#F05A9D', accentHot: '#FF8FC6', accentDeep: '#B83A74',
    land: '#C7AFC2', park: '#D98CAD', water: '#5B4A9E',
    road: '#09080A', roadRim: '#4A2A3C', buildingDark: '#2A1420',
  },
  {
    id: 'lunar-new-year', name: 'Lunar New Year',
    accent: '#E8B84A', accentHot: '#FFD35B', accentDeep: '#B0862C',
    land: '#9B2A2E', park: '#B8443A', water: '#2A3F7A',
    road: '#09080A', roadRim: '#3A2418', buildingDark: '#2A0E10',
  },
  {
    id: 'pride', name: 'Pride',
    accent: '#F4D53E', accentHot: '#FFD95A', accentDeep: '#C9A82A',
    land: '#4da42f', park: '#66c342', water: '#2b82dd',
    road: '#09080A', roadRim: '#2A252B', buildingDark: '#161116',
  },
]

/** The map palette for today: the holiday's on a holiday, else clay. The live
 *  map has no per-person map theme yet, so there is nothing to override. */
export function seasonalMapTheme(now?: Date): MapTheme {
  const holiday = activeHoliday(now)
  return (holiday && HOLIDAY_MAP_THEMES.find(theme => theme.id === holiday.mapThemeId))
    ?? MAP_THEMES[0]
}

export interface POI {
  id: string
  name: string
  distance: string
  likes: number
  /** The pop's takeover radius on the map, in km. */
  radiusKm: number
  category: 'food' | 'park' | 'shop' | 'arts' | 'nightlife'
  coords: [number, number]
  /** The FEED channel this pop posted to (FeedTwin CHANNELS id). An
   *  engagement on the pop opens the feed tuned here. August (real data):
   *  a post will carry its channel natively; this is that field, spoofed. */
  channel: string
}

export const POIS: POI[] = [
  // radiusKm is the pop's TAKEOVER on the map — the ground it currently holds.
  // It scales with reach (likes here, real engagement later), which is the
  // product model: a pop earns radius and radius decays.
  { id: 'liberty',     name: 'Liberty Village',    distance: '3.2 km', likes: 47, radiusKm: 12.4, category: 'nightlife', coords: [-79.4208, 43.6383], channel: 'music' },
  { id: 'kensington',  name: 'Kensington Market',  distance: '1.8 km', likes: 83, radiusKm: 28.6, category: 'food',      coords: [-79.4005, 43.6547], channel: 'food' },
  { id: 'queen',       name: 'Queen St W',          distance: '950 m',  likes: 24, radiusKm: 6.1,  category: 'shop',      coords: [-79.3975, 43.6483], channel: 'shopping' },
  { id: 'trinity',     name: 'Trinity Bellwoods',   distance: '2.1 km', likes: 61, radiusKm: 18.9, category: 'park',      coords: [-79.4118, 43.6482], channel: 'kids' },
  { id: 'distillery',  name: 'Distillery District', distance: '1.2 km', likes: 38, radiusKm: 9.7,  category: 'arts',      coords: [-79.3590, 43.6503], channel: 'cartoon' },
]

/**
 * Somebody ELSE's takeover.
 *
 * The map used to be a map of your own pops, which quietly said the world is
 * empty apart from you. A takeover only means something against other people's
 * — "who is in the lead here" is unanswerable on a one-player map. These are
 * the other holders, and each carries its OWN colour: on a shared map the
 * colour is how you read two overlapping claims apart, so it belongs to the
 * pop, not to the app's one takeover pink.
 *
 * Spoofed like the rest of the twin, and deliberately so: handles and avatars
 * are reused from the feed's channel posters (the same stills FeedTwin and
 * ProfileTwin already ship), never invented artwork. Real accounts replace this
 * list wholesale in Aug 2026 — the shape is what the real feed will hand over.
 */
export interface OtherPop {
  id: string
  /** the poster, matching a FeedTwin channel user so their profile resolves */
  user: string
  name: string
  radiusKm: number
  coords: [number, number]
  /** this pop's takeover colour — theirs, not the app's */
  color: string
  /** face for the pin's head — the same still their feed posts use */
  avatar: string
  /** the FeedTwin channel it posted to */
  channel: string
  /** The post standing on this ground — what the intercept window plays when
   *  the camera arrives. A clip where the pop has one, otherwise its still. */
  video?: string
  /** True for the handful of holders whose reach spans a whole region. They
   *  are what the world board is FOR: zoomed out you should be reading who
   *  owns each part of the planet, not a scattering of equal dots. */
  world?: boolean
}


// ── The world board ─────────────────────────────────────────────────────────
// Zoomed out, the map has to answer "who owns the planet". Toronto alone made
// the globe read as one lit city on a dark world — technically your rivals,
// but not a board. These are the holders dominating each region: bigger radii
// than the city-level pops so they survive being drawn at planet scale, spread
// so no continent is empty.
//
// Same spoofing rule as the Toronto set and for the same reason: handles,
// faces and clips are the feed's own shipped assets, never invented artwork.
// Real accounts replace this list wholesale in Aug 2026.
const WORLD_POPS: OtherPop[] = [
  { id: 'w-nyc',       user: '@citydesk',       name: 'New York',      radiusKm: 340, coords: [-74.0060, 40.7128],  color: '#FF5F8F', avatar: feedUrl('posters/ad-comedy.jpg'),    channel: 'news',     video: feedUrl('ad-comedy.mp4'),    world: true },
  { id: 'w-la',        user: '@hauls',          name: 'Los Angeles',   radiusKm: 300, coords: [-118.2437, 34.0522], color: '#FFD24B', avatar: feedUrl('posters/ad-shopping.jpg'),  channel: 'shopping', video: feedUrl('ad-shopping.mp4'),  world: true },
  { id: 'w-mexico',    user: '@vibra.cdmx',     name: 'Mexico City',   radiusKm: 290, coords: [-99.1332, 19.4326],  color: '#FF8A3D', avatar: feedUrl('posters/ad-spanish-1.jpg'), channel: 'spanish',  video: feedUrl('ad-spanish-1.mp4'), world: true },
  { id: 'w-saopaulo',  user: '@mercado',        name: 'São Paulo',     radiusKm: 310, coords: [-46.6333, -23.5505], color: '#7CE04F', avatar: feedUrl('posters/ad-spanish-2.jpg'), channel: 'spanish',  video: feedUrl('ad-spanish-2.mp4'), world: true },
  { id: 'w-london',    user: '@pitchside',      name: 'London',        radiusKm: 320, coords: [-0.1276, 51.5072],   color: '#4FD6B8', avatar: feedUrl('posters/ad-sports.jpg'),    channel: 'sports',   video: feedUrl('ad-sports.mp4'),    world: true },
  { id: 'w-paris',     user: '@boulangerie',    name: 'Paris',         radiusKm: 280, coords: [2.3522, 48.8566],    color: '#A97BFF', avatar: feedUrl('posters/ad-french.jpg'),    channel: 'french',   video: feedUrl('ad-french.mp4'),    world: true },
  { id: 'w-lagos',     user: '@basement.set',   name: 'Lagos',         radiusKm: 270, coords: [3.3792, 6.5244],     color: '#FF4BA1', avatar: feedUrl('posters/ad-music.jpg'),     channel: 'music',    video: feedUrl('ad-music.mp4'),     world: true },
  { id: 'w-cairo',     user: '@localwire',      name: 'Cairo',         radiusKm: 260, coords: [31.2357, 30.0444],   color: '#F0C22E', avatar: feedUrl('posters/ad-sports.jpg'),    channel: 'news',     video: feedUrl('ad-sports.mp4'),    world: true },
  { id: 'w-mumbai',    user: '@fitcheckdaily',  name: 'Mumbai',        radiusKm: 300, coords: [72.8777, 19.0760],   color: '#FF8AC6', avatar: feedUrl('posters/ad-cartoon.jpg'),   channel: 'fashion',  video: feedUrl('ad-cartoon.mp4'),   world: true },
  { id: 'w-tokyo',     user: '@doodlecast',     name: 'Tokyo',         radiusKm: 330, coords: [139.6917, 35.6895],  color: '#5FB0FF', avatar: feedUrl('posters/ad-cartoon.jpg'),   channel: 'cartoon',  video: feedUrl('ad-cartoon.mp4'),   world: true },
  { id: 'w-seoul',     user: '@bpm',            name: 'Seoul',         radiusKm: 280, coords: [126.9780, 37.5665],  color: '#29A6E6', avatar: feedUrl('posters/ad-music.jpg'),     channel: 'music',    video: feedUrl('ad-music.mp4'),     world: true },
  { id: 'w-shanghai',  user: '@shipit',         name: 'Shanghai',      radiusKm: 300, coords: [121.4737, 31.2304],  color: '#2EE0FF', avatar: feedUrl('posters/ad-kids.jpg'),      channel: 'tech',     video: feedUrl('ad-kids.mp4'),      world: true },
  { id: 'w-sydney',    user: '@bitmerchant',    name: 'Sydney',        radiusKm: 290, coords: [151.2093, -33.8688], color: '#F23535', avatar: feedUrl('posters/ad-comedy.jpg'),    channel: 'comedy',   video: feedUrl('ad-comedy.mp4'),    world: true },
  { id: 'w-madrid',    user: '@alpastor',       name: 'Madrid',        radiusKm: 250, coords: [-3.7038, 40.4168],   color: '#FB7185', avatar: feedUrl('posters/ad-spanish-3.jpg'), channel: 'spanish',  video: feedUrl('ad-spanish-3.mp4'), world: true },
  { id: 'w-berlin',    user: '@warehouse',      name: 'Berlin',        radiusKm: 240, coords: [13.4050, 52.5200],   color: '#8FA63E', avatar: feedUrl('posters/ad-music.jpg'),     channel: 'music',    video: feedUrl('ad-music.mp4'),     world: true },
  { id: 'w-vancouver', user: '@playtime',       name: 'Vancouver',     radiusKm: 230, coords: [-123.1207, 49.2827], color: '#7CE04F', avatar: feedUrl('posters/ad-kids.jpg'),      channel: 'kids',     video: feedUrl('ad-kids.mp4'),      world: true },
  { id: 'w-buenos',    user: '@openmic',        name: 'Buenos Aires',  radiusKm: 250, coords: [-58.3816, -34.6037], color: '#FFD24B', avatar: feedUrl('posters/ad-comedy.jpg'),    channel: 'comedy',   video: feedUrl('ad-comedy.mp4'),    world: true },
  { id: 'w-joburg',    user: '@harbourfront',   name: 'Johannesburg',  radiusKm: 240, coords: [28.0473, -26.2041],  color: '#FF6FB1', avatar: feedUrl('posters/ad-french.jpg'),    channel: 'news',     video: feedUrl('ad-french.mp4'),    world: true },
  { id: 'w-dubai',     user: '@atelier',        name: 'Dubai',         radiusKm: 260, coords: [55.2708, 25.2048],   color: '#E8A83F', avatar: feedUrl('posters/ad-shopping.jpg'),  channel: 'fashion',  video: feedUrl('ad-shopping.mp4'),  world: true },
  { id: 'w-singapore', user: '@benchmark',      name: 'Singapore',     radiusKm: 220, coords: [103.8198, 1.3521],   color: '#4FD6B8', avatar: feedUrl('posters/ad-kids.jpg'),      channel: 'tech',     video: feedUrl('ad-kids.mp4'),      world: true },
]

// The city-level board — the rivals you meet at street zoom.
const CITY_POPS: OtherPop[] = [
  { id: 'other-sauceboss',  user: '@sauceboss',    name: 'St. Lawrence',    radiusKm: 21.5, coords: [-79.3717, 43.6487], color: '#FF8A3D', avatar: feedUrl('posters/ad-food.jpg'), channel: 'food' },
  { id: 'other-pitchside',  user: '@pitchside',    name: 'BMO Field',       radiusKm: 33.2, coords: [-79.4185, 43.6332], color: '#4FD6B8', avatar: feedUrl('posters/ad-sports.jpg'), channel: 'sports' },
  { id: 'other-basement',   user: '@basement.set', name: 'The Junction',    radiusKm: 15.8, coords: [-79.4680, 43.6653], color: '#A97BFF', avatar: feedUrl('posters/ad-music.jpg'), channel: 'music' },
  { id: 'other-hauls',      user: '@hauls',        name: 'Yorkdale',        radiusKm: 26.4, coords: [-79.4522, 43.7256], color: '#FFD24B', avatar: feedUrl('posters/ad-shopping.jpg'), channel: 'shopping' },
  { id: 'other-doodlecast', user: '@doodlecast',   name: 'Leslieville',     radiusKm: 11.3, coords: [-79.3320, 43.6640], color: '#5FB0FF', avatar: feedUrl('posters/ad-cartoon.jpg'), channel: 'cartoon' },
  { id: 'other-playtime',   user: '@playtime',     name: 'High Park',       radiusKm: 19.7, coords: [-79.4637, 43.6465], color: '#7CE04F', avatar: feedUrl('posters/ad-kids.jpg'), channel: 'kids' },
  { id: 'other-bitmerchant',user: '@bitmerchant',  name: 'The Beaches',     radiusKm: 24.9, coords: [-79.2960, 43.6710], color: '#FF5F8F', avatar: feedUrl('posters/ad-comedy.jpg'), channel: 'comedy', video: feedUrl('ad-comedy.mp4') },
]

/** Everyone else on the board: the world's dominant holders first (they are
 *  what the zoomed-out map is about), then the city rivals. Order matters —
 *  the pin renderer ranks by it when it caps how many faces stand at once. */
export const OTHER_POPS: OtherPop[] = [...WORLD_POPS, ...CITY_POPS]

/**
 * Which pops the map is showing. Your own takeover, everyone else's, or the
 * whole board — on ALL the two sets are drawn together and the bigger radius
 * simply wins the ground where they overlap, which is what "who is in the
 * lead" looks like on a map.
 */
export type PopLevel = 'mine' | 'others' | 'all'

export const POP_LEVELS: Array<{ id: PopLevel; label: string; blurb: string }> = [
  { id: 'mine',   label: 'Level 1 · My pops',    blurb: 'One layer — the ground you hold' },
  { id: 'others', label: 'Level 2 · Other pops', blurb: 'Two layers — everyone else’s takeovers' },
  { id: 'all',    label: 'Level 3 · All pops',   blurb: 'Three layers — the whole board' },
]

// GeoJSON paths connecting POIs for the clay road overlay
export const CLAY_ROUTES = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-79.4208, 43.6383], // Liberty Village
          [-79.4100, 43.6430],
          [-79.4005, 43.6547], // Kensington Market
          [-79.3975, 43.6500],
          [-79.3975, 43.6483], // Queen St W
        ],
      },
    },
    {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-79.3975, 43.6483], // Queen St W
          [-79.4000, 43.6480],
          [-79.4118, 43.6482], // Trinity Bellwoods
        ],
      },
    },
    {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-79.3832, 43.6532], // center / downtown
          [-79.3700, 43.6520],
          [-79.3590, 43.6503], // Distillery District
        ],
      },
    },
    {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-79.3975, 43.6483], // Queen St W
          [-79.3900, 43.6510],
          [-79.3832, 43.6532], // center
        ],
      },
    },
  ],
}
