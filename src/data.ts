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

export interface POI {
  id: string
  name: string
  distance: string
  likes: number
  category: 'food' | 'park' | 'shop' | 'arts' | 'nightlife'
  coords: [number, number]
}

export const POIS: POI[] = [
  { id: 'liberty',     name: 'Liberty Village',    distance: '3.2 km', likes: 47, category: 'nightlife', coords: [-79.4208, 43.6383] },
  { id: 'kensington',  name: 'Kensington Market',  distance: '1.8 km', likes: 83, category: 'food',      coords: [-79.4005, 43.6547] },
  { id: 'queen',       name: 'Queen St W',          distance: '950 m',  likes: 24, category: 'shop',      coords: [-79.3975, 43.6483] },
  { id: 'trinity',     name: 'Trinity Bellwoods',   distance: '2.1 km', likes: 61, category: 'park',      coords: [-79.4118, 43.6482] },
  { id: 'distillery',  name: 'Distillery District', distance: '1.2 km', likes: 38, category: 'arts',      coords: [-79.3590, 43.6503] },
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
