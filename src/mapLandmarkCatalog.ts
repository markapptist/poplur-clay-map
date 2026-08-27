import type { MaterializedLandmarkId } from './landmarkMaterials'
import {
  MAP_LANDMARK_3D_MIN_ZOOM,
  landmarkRevealZoomForFrame,
  subtleLandmarkPitch,
} from './mapPresentationPolicy'

export interface WorldLandmarkPresentation {
  id: MaterializedLandmarkId
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
  revealZoom?: number
  frameBearing: number
}

/**
 * Grounded presentation data for every shipped landmark GLB.
 *
 * The long-axis objects have site-authored yaws (bridge, stadium, opera
 * house); rotational towers and monuments are explicitly zero. Every entry
 * gets the same shallow, ground-revealing camera ceiling on phones.
 */
export const WORLD_LANDMARK_PRESENTATIONS: readonly WorldLandmarkPresentation[] = [
  { id: 'burj-khalifa', coords: [55.2744, 25.1972], heightM: 828, frameSpanM: 828, color: 0xdce4e6, yaw: 0, framePitch: 42, frameBearing: 0 },
  {
    id: 'cn-tower', coords: [-79.3871, 43.6426], heightM: 553,
    frameSpanM: 553, color: 0xc9c6c2, yaw: 0, nearKm: 0.9,
    frameCenter: [-79.38677, 43.64418],
    framePitch: 42, frameZoom: 15.6, revealZoom: 15.0, frameBearing: 22,
  },
  {
    id: 'rogers-centre', coords: [-79.38918212, 43.64161058], heightM: 60,
    frameSpanM: 553, color: 0xe4e6e8, yaw: 15.9, clearDepth: false, nearKm: 0.5,
    frameCenter: [-79.38834927, 43.64200635],
    framePitch: 42, frameZoom: 15.3, revealZoom: 15.0, frameBearing: 0,
  },
  { id: 'eiffel', coords: [2.2945, 48.8584], heightM: 330, frameSpanM: 330, color: 0x76543a, yaw: 0, framePitch: 42, frameBearing: 0 },
  { id: 'space-needle', coords: [-122.3493, 47.6205], heightM: 184, frameSpanM: 184, color: 0xe2e1dc, yaw: 0, framePitch: 42, frameBearing: 0 },
  // The bridge mesh is authored along local X. Rotate that axis onto the
  // Golden Gate's real north-west/south-east footprint.
  { id: 'golden-gate', coords: [-122.4783, 37.8199], heightM: 227, frameSpanM: 556, color: 0xdd5b38, yaw: 102, framePitch: 42, frameBearing: 0 },
  { id: 'statue-liberty', coords: [-74.0445, 40.6892], heightM: 93, frameSpanM: 93, color: 0x72aa91, yaw: 0, framePitch: 42, frameBearing: 0 },
  { id: 'big-ben', coords: [-0.1246, 51.5007], heightM: 96, frameSpanM: 96, color: 0xb49a68, yaw: 0, framePitch: 42, frameBearing: 0 },
  { id: 'giza', coords: [31.1342, 29.9792], heightM: 139, frameSpanM: 300, color: 0xd5b879, yaw: 0, framePitch: 42, frameBearing: 0 },
  { id: 'taj-mahal', coords: [78.0421, 27.1751], heightM: 73, frameSpanM: 85, color: 0xf3e7d8, yaw: 0, framePitch: 42, frameBearing: 0 },
  { id: 'colosseum', coords: [12.4922, 41.8902], heightM: 48, frameSpanM: 95, color: 0xc8a27a, yaw: 0, framePitch: 42, frameBearing: 0 },
  // The opera-house mesh is also authored along local X; 90 degrees follows
  // the Bennelong Point site instead of laying the sails across the harbour.
  { id: 'sydney-opera', coords: [151.2153, -33.8568], heightM: 65, frameSpanM: 150, color: 0xf2eee4, yaw: 90, framePitch: 42, frameBearing: 0 },
  { id: 'christ-redeemer', coords: [-43.2105, -22.9519], heightM: 38, frameSpanM: 38, color: 0xe1d8ca, yaw: 0, framePitch: 42, frameBearing: 0 },
]

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
    zoom: landmark.frameZoom ?? landmarkCameraZoom(
      landmark.frameSpanM,
      LANDMARK_TOUR_MIN_FRAME_ZOOM,
      LANDMARK_TOUR_MAX_FRAME_ZOOM,
    ),
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
