import type { MaterializedLandmarkId } from './landmarkMaterials'
import {
  MAP_LANDMARK_3D_MIN_ZOOM,
  landmarkRevealZoomForFrame,
  subtleLandmarkPitch,
} from './mapPresentationPolicy'

export interface WorldLandmarkPresentation {
  id: MaterializedLandmarkId
  /** Optional custom-layer root for a tightly coupled nearby piece. The
   * presentation keeps its own search/tour camera frame, but its GLB is added
   * to the root landmark's single Three scene and WebGL renderer. */
  rendererRootId?: MaterializedLandmarkId
  coords: [number, number]
  heightM: number
  frameSpanM: number
  color: number
  /** Explicit clockwise local-Y rotation. Keeping zeroes in the catalog makes
   * orientation an audited property rather than an accidental loader default. */
  yaw: number
  clearDepth?: boolean
  nearKm?: number
  frameCenter?: [number, number]
  framePitch: number
  frameZoom?: number
  /** Tour-only hero frame. Search/tap navigation keeps the quieter shared
   * frame above, while the finite showcase can size unlike silhouettes with
   * deliberate visual weight. */
  tourZoom?: number
  tourOffset?: [number, number]
  revealZoom?: number
  frameBearing: number
}

/** Small location icons belong only to the calm, top-down world band. They
 * disappear before regional/city framing so the grounded GLB remains the sole
 * close landmark presentation. */
export const WORLD_LANDMARK_ICON_MAX_ZOOM = 5.5

export function worldLandmarkIconsVisible(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom < WORLD_LANDMARK_ICON_MAX_ZOOM
}

/** Transparent 96px renders baked from the exact shipped landmark GLBs.
 * `src/worldLandmarkIconManifest.json` records each source/output hash.
 * Reusing these images keeps the world overview faithful to the provided
 * models without decoding twelve GLBs or keeping another WebGL renderer awake. */
export const WORLD_LANDMARK_GLB_SPRITES: Readonly<
  Partial<Record<MaterializedLandmarkId, string>>
> = {
  'big-ben': 'sprites/world-landmarks/big-ben-glb-s96.png',
  'burj-khalifa': 'sprites/world-landmarks/burj-khalifa-glb-s96.png',
  'christ-redeemer': 'sprites/world-landmarks/christ-redeemer-glb-s96.png',
  'cn-tower': 'sprites/world-landmarks/cn-tower-glb-s96.png',
  colosseum: 'sprites/world-landmarks/colosseum-glb-s96.png',
  eiffel: 'sprites/world-landmarks/eiffel-glb-s96.png',
  giza: 'sprites/world-landmarks/giza-glb-s96.png',
  'golden-gate': 'sprites/world-landmarks/golden-gate-glb-s96.png',
  'space-needle': 'sprites/world-landmarks/space-needle-glb-s96.png',
  'statue-liberty': 'sprites/world-landmarks/statue-liberty-glb-s96.png',
  'sydney-opera': 'sprites/world-landmarks/sydney-opera-glb-s96.png',
  'taj-mahal': 'sprites/world-landmarks/taj-mahal-glb-s96.png',
}

/** User-approved coloured Poplur game pieces. The source sheet, crop boxes,
 * and output hashes are locked in `src/worldLandmarkPieceManifest.json`.
 * Landmarks not represented in that sheet deliberately retain the exact-GLB
 * render above until matching approved artwork exists. */
export const WORLD_LANDMARK_USER_PIECE_IDS = [
  'big-ben',
  'cn-tower',
  'eiffel',
  'golden-gate',
  'statue-liberty',
  'sydney-opera',
] as const satisfies readonly MaterializedLandmarkId[]

/** World-scale landmark art: coloured pieces where supplied, faithful GLB
 * renders elsewhere. These are static PNGs so the fully zoomed-out map does
 * not need another renderer or decode the landmark models. */
export const WORLD_LANDMARK_OVERVIEW_SPRITES: Readonly<
  Partial<Record<MaterializedLandmarkId, string>>
> = {
  ...WORLD_LANDMARK_GLB_SPRITES,
  'big-ben': 'sprites/world-landmarks/pieces/big-ben-piece-s96.png',
  'cn-tower': 'sprites/world-landmarks/pieces/cn-tower-piece-s96.png',
  eiffel: 'sprites/world-landmarks/pieces/eiffel-piece-s96.png',
  'golden-gate': 'sprites/world-landmarks/pieces/golden-gate-piece-s96.png',
  'statue-liberty': 'sprites/world-landmarks/pieces/statue-liberty-piece-s96.png',
  'sydney-opera': 'sprites/world-landmarks/pieces/sydney-opera-piece-s96.png',
}

/** The zoom slider uses the same approved visual identity as the overview at
 * a larger source resolution. The six unsupplied landmarks keep their
 * existing 320px renders, avoiding invented art. */
export const WORLD_LANDMARK_THUMB_SPRITES: Readonly<
  Partial<Record<MaterializedLandmarkId, string>>
> = {
  'big-ben': 'sprites/world-landmarks/pieces/big-ben-piece-s320.png',
  'burj-khalifa': 'sprites/burj-khalifa_y18_p10_s320.png',
  'christ-redeemer': 'sprites/christ-redeemer_y18_p10_s320.png',
  'cn-tower': 'sprites/world-landmarks/pieces/cn-tower-piece-s320.png',
  colosseum: 'sprites/colosseum_y18_p10_s320.png',
  eiffel: 'sprites/world-landmarks/pieces/eiffel-piece-s320.png',
  giza: 'sprites/giza_y18_p10_s320.png',
  'golden-gate': 'sprites/world-landmarks/pieces/golden-gate-piece-s320.png',
  'space-needle': 'sprites/space-needle_y18_p10_s320.png',
  'statue-liberty': 'sprites/world-landmarks/pieces/statue-liberty-piece-s320.png',
  'sydney-opera': 'sprites/world-landmarks/pieces/sydney-opera-piece-s320.png',
  'taj-mahal': 'sprites/taj-mahal_y18_p10_s320.png',
}

/**
 * Grounded presentation data for every shipped landmark GLB.
 *
 * The long-axis objects have site-authored yaws (bridge, stadium, opera
 * house); rotational towers and monuments are explicitly zero. Every entry
 * gets the same shallow, ground-revealing camera ceiling on phones.
 */
export const WORLD_LANDMARK_PRESENTATIONS: readonly WorldLandmarkPresentation[] = [
  { id: 'burj-khalifa', coords: [55.2744, 25.1972], heightM: 828, frameSpanM: 828, color: 0xdce4e6, yaw: 0, framePitch: 42, tourZoom: 14.65, tourOffset: [0, 50], frameBearing: 0 },
  {
    id: 'cn-tower', coords: [-79.3871, 43.6426], heightM: 553,
    frameSpanM: 553, color: 0xc9c6c2, yaw: 0, nearKm: 0.9,
    frameCenter: [-79.38677, 43.64418],
    framePitch: 42, frameZoom: 15.6, tourZoom: 15.25, revealZoom: 15.0, frameBearing: 22,
  },
  {
    id: 'rogers-centre', coords: [-79.38918212, 43.64161058], heightM: 60,
    rendererRootId: 'cn-tower',
    frameSpanM: 553, color: 0xe4e6e8, yaw: 15.9, clearDepth: false, nearKm: 0.5,
    frameCenter: [-79.38834927, 43.64200635],
    framePitch: 42, frameZoom: 15.3, revealZoom: 15.0, frameBearing: 0,
  },
  { id: 'eiffel', coords: [2.2945, 48.8584], heightM: 330, frameSpanM: 330, color: 0x76543a, yaw: 0, framePitch: 42, tourZoom: 15.45, tourOffset: [0, 80], frameBearing: 0 },
  { id: 'space-needle', coords: [-122.3493, 47.6205], heightM: 184, frameSpanM: 184, color: 0xe2e1dc, yaw: 0, framePitch: 42, tourZoom: 16.3, tourOffset: [0, 75], frameBearing: 0 },
  // The bridge mesh is authored along local X. Rotate that axis onto the
  // Golden Gate's real north-west/south-east footprint.
  { id: 'golden-gate', coords: [-122.4783, 37.8199], heightM: 227, frameSpanM: 556, color: 0xdd5b38, yaw: 102, framePitch: 42, tourZoom: 14.9, tourOffset: [0, 30], frameBearing: 0 },
  { id: 'statue-liberty', coords: [-74.0445, 40.6892], heightM: 93, frameSpanM: 93, color: 0x72aa91, yaw: 0, framePitch: 42, tourZoom: 17.35, tourOffset: [0, 70], frameBearing: 0 },
  { id: 'big-ben', coords: [-0.1246, 51.5007], heightM: 96, frameSpanM: 96, color: 0xb49a68, yaw: 0, framePitch: 42, tourZoom: 17.15, tourOffset: [0, 75], frameBearing: 0 },
  { id: 'giza', coords: [31.1342, 29.9792], heightM: 139, frameSpanM: 300, color: 0xd5b879, yaw: 0, framePitch: 42, tourZoom: 15.95, tourOffset: [0, 30], frameBearing: 0 },
  { id: 'taj-mahal', coords: [78.0421, 27.1751], heightM: 73, frameSpanM: 85, color: 0xf3e7d8, yaw: 0, framePitch: 42, tourZoom: 17.5, tourOffset: [0, 45], frameBearing: 0 },
  { id: 'colosseum', coords: [12.4922, 41.8902], heightM: 48, frameSpanM: 95, color: 0xc8a27a, yaw: 0, framePitch: 42, tourZoom: 16.9, tourOffset: [0, 25], frameBearing: 0 },
  // The opera-house mesh is also authored along local X; 90 degrees follows
  // the Bennelong Point site instead of laying the sails across the harbour.
  { id: 'sydney-opera', coords: [151.2153, -33.8568], heightM: 65, frameSpanM: 150, color: 0xf2eee4, yaw: 90, framePitch: 42, tourZoom: 17.05, tourOffset: [0, 30], frameBearing: 0 },
  { id: 'christ-redeemer', coords: [-43.2105, -22.9519], heightM: 38, frameSpanM: 38, color: 0xe1d8ca, yaw: 0, framePitch: 42, tourZoom: 18.75, tourOffset: [0, 60], frameBearing: 0 },
]

/** Resolve the custom-layer owner without changing a landmark's public
 * identity. Rogers Centre therefore remains independently searchable and
 * frameable while CN Tower owns the one Toronto landmark renderer. */
export function landmarkRendererRootId(id: MaterializedLandmarkId): MaterializedLandmarkId {
  return WORLD_LANDMARK_PRESENTATIONS.find(candidate => candidate.id === id)?.rendererRootId ?? id
}

/** Return only the companion presentations owned by a renderer root. */
export function landmarkRendererCompanions(
  rootId: MaterializedLandmarkId,
): readonly WorldLandmarkPresentation[] {
  return WORLD_LANDMARK_PRESENTATIONS.filter(candidate => candidate.rendererRootId === rootId)
}

/** The twelve landmark-tour destinations shown on the world overview. Rogers
 * Centre remains a full close-range 3D landmark, but it is categorized as an
 * arena and sits only ~220m from CN Tower—far below one screen pixel at world
 * zoom—so a second icon would completely cover the CN landmark icon. */
export const WORLD_LANDMARK_ICON_IDS = WORLD_LANDMARK_PRESENTATIONS
  .filter(landmark => Boolean(WORLD_LANDMARK_OVERVIEW_SPRITES[landmark.id]))
  .map(landmark => landmark.id)

const LANDMARK_REFERENCE_HEIGHT_M = 330
const LANDMARK_MIN_FRAME_ZOOM = 13.5
const LANDMARK_MAX_FRAME_ZOOM = 16.0
const LANDMARK_TOUR_MIN_FRAME_ZOOM = 14.1
const LANDMARK_TOUR_MAX_FRAME_ZOOM = 17.6
const LANDMARK_REVEAL_ZOOM_BUFFER = 0.3

function landmarkCameraZoom(
  frameSpanM: number,
  minZoom = LANDMARK_MIN_FRAME_ZOOM,
  maxZoom = LANDMARK_MAX_FRAME_ZOOM,
): number {
  const scaled = 15.3 - Math.log2(Math.max(1, frameSpanM) / LANDMARK_REFERENCE_HEIGHT_M)
  return Math.max(minZoom, Math.min(maxZoom, scaled))
}

export interface LandmarkCameraFrame {
  zoom: number
  pitch: number
  center?: [number, number]
  bearing?: number
  offset?: [number, number]
}

export function landmarkCameraFrame(id: string): LandmarkCameraFrame | null {
  const landmark = WORLD_LANDMARK_PRESENTATIONS.find(candidate => candidate.id === id)
  if (!landmark) return null
  return {
    zoom: landmark.frameZoom ?? landmarkCameraZoom(landmark.frameSpanM),
    center: landmark.frameCenter,
    bearing: landmark.frameBearing,
    pitch: subtleLandmarkPitch(landmark.framePitch),
  }
}

export function landmarkTourCameraFrame(id: string): LandmarkCameraFrame | null {
  const landmark = WORLD_LANDMARK_PRESENTATIONS.find(candidate => candidate.id === id)
  const frame = landmarkCameraFrame(id)
  if (!landmark || !frame) return null
  return {
    ...frame,
    zoom: landmark.tourZoom ?? landmark.frameZoom ?? landmarkCameraZoom(
      landmark.frameSpanM,
      LANDMARK_TOUR_MIN_FRAME_ZOOM,
      LANDMARK_TOUR_MAX_FRAME_ZOOM,
    ),
    offset: landmark.tourOffset,
  }
}

export function landmarkRevealZoom(id: string): number | null {
  const landmark = WORLD_LANDMARK_PRESENTATIONS.find(candidate => candidate.id === id)
  if (!landmark) return null
  return landmarkRevealZoomForFrame(
    landmarkCameraZoom(landmark.frameSpanM),
    landmark.revealZoom,
    LANDMARK_REVEAL_ZOOM_BUFFER,
  )
}

export function landmarkNearZoom(id: string): number {
  return landmarkRevealZoom(id) ?? MAP_LANDMARK_3D_MIN_ZOOM
}
