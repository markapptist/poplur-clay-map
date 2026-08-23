/**
 * Pure geometry and hierarchy math for the wardrobe editor. No React, no
 * side effects — every function returns fresh objects and never mutates the
 * scene, so the store can replay commands and the gesture layer can preview
 * transforms without committing them.
 *
 * Coordinate convention: a transform's x/y is the module's anchor position;
 * unless a caller passes the asset's anchor kind, these helpers assume the
 * default 'topLeft' (anchorOffset converts for the others). Rotation is
 * degrees clockwise on screen (y-down) about the box's center. scaleX/scaleY
 * multiply width/height about the box's top-left.
 */

import { WARDROBE_LIMITS } from './wardrobeTypes'
import type {
  WardrobeAssetDefinition,
  WardrobeAttachmentPointDef,
  WardrobeScene,
  WardrobeTransform,
} from './wardrobeTypes'
import { getWardrobeAsset } from './wardrobeAssets'

/** Normalised distance within which a dragged module snaps to a point. */
export const SNAP_RADIUS = 0.06

/** Modules may hang up to 10% of the canvas past each edge. */
const OVERHANG = 0.1

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function effectiveSize(t: WardrobeTransform): { w: number, h: number } {
  return { w: t.width * (t.scaleX ?? 1), h: t.height * (t.scaleY ?? 1) }
}

/** Offset from the module box's top-left corner to the transform's x/y
    reference point, in scene units (scale-aware). The renderer subtracts it
    to find where the box actually starts. */
export function anchorOffset(
  anchor: WardrobeAssetDefinition['anchor'],
  t: WardrobeTransform,
): { x: number, y: number } {
  const { w, h } = effectiveSize(t)
  if (anchor === 'center') return { x: w / 2, y: h / 2 }
  if (anchor === 'bottomCenter') return { x: w / 2, y: h }
  return { x: 0, y: 0 }
}

/** Absolute scene position of an attachment point defined within the parent's
    box, honoring the parent's scale and its rotation about the box center. */
export function resolveAttachmentPoint(
  parent: WardrobeTransform,
  point: WardrobeAttachmentPointDef,
  parentAnchor: WardrobeAssetDefinition['anchor'] = 'topLeft',
): { x: number, y: number } {
  const { w, h } = effectiveSize(parent)
  const off = anchorOffset(parentAnchor, parent)
  const left = parent.x - off.x
  const top = parent.y - off.y
  const cx = left + w / 2
  const cy = top + h / 2
  const dx = left + point.x * w - cx
  const dy = top + point.y * h - cy
  const rad = (parent.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // In y-down screen space this matrix turns positive degrees clockwise,
  // matching WardrobeTransform's rotation contract.
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Every module below `id` through structural parentage AND slot attachment,
    breadth-first. Safe on corrupt scenes: cycles and self-links terminate. */
export function collectDescendants(scene: WardrobeScene, id: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const m of scene.modules) {
    for (const p of [m.parentId, m.attachment?.parentId]) {
      if (!p || p === m.id) continue
      const list = childrenOf.get(p)
      if (!list) childrenOf.set(p, [m.id])
      else if (!list.includes(m.id)) list.push(m.id)
    }
  }
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const next = queue.shift() as string
    for (const child of childrenOf.get(next) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** Transform patch shifting the given modules plus all their descendants by
    dx/dy. Returns fresh transforms only — the scene is untouched, so the
    caller decides between previewTransforms and a committed command. */
export function moveModules(
  scene: WardrobeScene,
  ids: string[],
  dx: number,
  dy: number,
): Record<string, WardrobeTransform> {
  const targets = new Set<string>()
  for (const id of ids) {
    targets.add(id)
    for (const d of collectDescendants(scene, id)) targets.add(d)
  }
  const patch: Record<string, WardrobeTransform> = {}
  for (const m of scene.modules) {
    if (!targets.has(m.id)) continue
    patch[m.id] = { ...m.transform, x: m.transform.x + dx, y: m.transform.y + dy }
  }
  return patch
}

/** Nearest attachment point within SNAP_RADIUS of the dragged module's anchor
    (t.x/t.y), across every other module whose asset exposes points accepting
    the module's type. The module itself and its descendants are excluded so a
    drag can never snap into its own subtree. `lookup` exists so tests inject
    a registry; production callers omit it. */
export function findSnapCandidate(
  scene: WardrobeScene,
  moduleId: string,
  t: WardrobeTransform,
  lookup: (assetId: string) => WardrobeAssetDefinition | undefined = getWardrobeAsset,
): { parentId: string, pointId: string, x: number, y: number } | null {
  const moving = scene.modules.find(m => m.id === moduleId)
  if (!moving) return null
  const excluded = new Set([moduleId, ...collectDescendants(scene, moduleId)])
  let best: { parentId: string, pointId: string, x: number, y: number } | null = null
  let bestDist = Infinity
  for (const m of scene.modules) {
    if (excluded.has(m.id)) continue
    const asset = lookup(m.assetId)
    if (!asset?.attachmentPoints?.length) continue
    for (const point of asset.attachmentPoints) {
      if (!point.allowedTypes.includes(moving.type)) continue
      const abs = resolveAttachmentPoint(m.transform, point, asset.anchor)
      const dist = Math.hypot(abs.x - t.x, abs.y - t.y)
      if (dist > SNAP_RADIUS || dist >= bestDist) continue
      bestDist = dist
      best = { parentId: m.id, pointId: point.id, x: abs.x, y: abs.y }
    }
  }
  return best
}

/** True when making childId the parent of parentId's subtree would loop —
    i.e. parentId is childId itself or already sits below it (through either
    link kind). */
export function wouldCreateCycle(
  scene: WardrobeScene,
  childId: string,
  parentId: string,
): boolean {
  if (childId === parentId) return true
  return collectDescendants(scene, childId).includes(parentId)
}

/** Defensive normalisation of a transform before it enters the scene:
    non-finite numbers are zeroed first (a NaN position must never poison the
    renderer), then everything is clamped — position into the canvas plus
    overhang, size into WARDROBE_LIMITS, scale so the EFFECTIVE footprint
    also respects those limits, rotation wrapped to [0, 360) and forced to 0
    for non-rotatable assets. */
export function clampTransform(
  t: WardrobeTransform,
  asset?: WardrobeAssetDefinition,
): WardrobeTransform {
  const width = clampNumber(finite(t.width), WARDROBE_LIMITS.minSize, WARDROBE_LIMITS.maxSize)
  const height = clampNumber(finite(t.height), WARDROBE_LIMITS.minSize, WARDROBE_LIMITS.maxSize)
  const rotation = asset && !asset.rotatable
    ? 0
    : ((finite(t.rotation) % 360) + 360) % 360
  const out: WardrobeTransform = {
    x: clampNumber(finite(t.x), -OVERHANG, 1 + OVERHANG),
    y: clampNumber(finite(t.y), -OVERHANG, 1 + OVERHANG),
    width,
    height,
    rotation,
  }
  if (t.scaleX !== undefined) {
    out.scaleX = clampNumber(finite(t.scaleX), WARDROBE_LIMITS.minSize / width, WARDROBE_LIMITS.maxSize / width)
  }
  if (t.scaleY !== undefined) {
    out.scaleY = clampNumber(finite(t.scaleY), WARDROBE_LIMITS.minSize / height, WARDROBE_LIMITS.maxSize / height)
  }
  return out
}
