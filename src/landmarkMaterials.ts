import * as THREE from 'three'

export interface LandmarkMaterialIdentity {
  /** Multiplicative colour over the authored base-colour map. */
  tint: number
  /** Optional PBR adjustments for a legacy single-material landmark. */
  roughness?: number
  metalness?: number
}

/** Apply a material identity without replacing the authored texture graph. */
export function applyLandmarkMaterialIdentity(
  material: THREE.Material,
  identity: LandmarkMaterialIdentity,
): void {
  const pbr = material as THREE.MeshStandardMaterial
  if (!pbr.isMeshStandardMaterial) return
  pbr.color.setHex(identity.tint)
  if (identity.roughness != null) pbr.roughness = identity.roughness
  if (identity.metalness != null) pbr.metalness = identity.metalness
}

/**
 * Real material identity for every grounded world landmark.
 *
 * These values are shader-uniform tints over each GLB's existing compact
 * base-colour and normal maps. They add no texture allocation, draw call, or
 * animation. Toronto's two multi-material models use neutral white so their
 * named concrete, glass, steel and light zones remain intact.
 */
export const LANDMARK_MATERIAL_IDENTITIES = {
  'burj-khalifa': { tint: 0xdce4e6, metalness: 0.48, roughness: 0.3 },
  'cn-tower': { tint: 0xffffff },
  'rogers-centre': { tint: 0xffffff },
  // The approved Meshy game piece carries its pink, charcoal and white colour
  // separation in the authored base map. A neutral identity keeps those
  // colours intact; low metalness and soft gloss read as molded polymer clay.
  eiffel: { tint: 0xffffff, metalness: 0.18, roughness: 0.32 },
  'space-needle': { tint: 0xe2e1dc, metalness: 0.48, roughness: 0.34 },
  'golden-gate': { tint: 0xdd5b38, metalness: 0.38, roughness: 0.47 },
  'statue-liberty': { tint: 0x72aa91, metalness: 0.34, roughness: 0.5 },
  'big-ben': { tint: 0xb49a68, metalness: 0.04, roughness: 0.75 },
  giza: { tint: 0xd5b879, metalness: 0.01, roughness: 0.84 },
  'taj-mahal': { tint: 0xf3e7d8, metalness: 0.01, roughness: 0.48 },
  colosseum: { tint: 0xc8a27a, metalness: 0.01, roughness: 0.8 },
  'sydney-opera': { tint: 0xf2eee4, metalness: 0.08, roughness: 0.36 },
  'christ-redeemer': { tint: 0xe1d8ca, metalness: 0.01, roughness: 0.76 },
} as const satisfies Record<string, LandmarkMaterialIdentity>

export type MaterializedLandmarkId = keyof typeof LANDMARK_MATERIAL_IDENTITIES
