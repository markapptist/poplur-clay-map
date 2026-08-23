import type {
  WardrobeAttachment,
  WardrobeAssetDefinition,
  WardrobeCommand,
  WardrobeModule,
  WardrobePrefab,
  WardrobeScene,
  WardrobeTheme,
  WardrobeTransform,
} from './wardrobeTypes'
import { wardrobeId } from './wardrobeTypes'
import { getWardrobeAsset } from './wardrobeAssets'
import { anchorOffset, collectDescendants, resolveAttachmentPoint } from './wardrobeTransforms'

// Every factory captures concrete before/after data at build time, so apply
// and revert are deterministic replays — a redo after five undos rebuilds the
// exact same scene JSON, regenerated ids included, because ids are minted in
// the factory, never inside apply().

function replaceModules(
  label: string,
  before: WardrobeModule[],
  after: WardrobeModule[],
): WardrobeCommand {
  return {
    label,
    apply: (scene: WardrobeScene) => ({ ...scene, modules: after }),
    revert: (scene: WardrobeScene) => ({ ...scene, modules: before }),
  }
}

function moduleMap(scene: WardrobeScene): Map<string, WardrobeModule> {
  return new Map(scene.modules.map(m => [m.id, m]))
}

function resolveAttachmentTransforms(
  scene: WardrobeScene,
  bases: Record<string, WardrobeTransform> | null = null,
): Record<string, WardrobeTransform> {
  const byId = moduleMap(scene)
  const resolved: Record<string, WardrobeTransform> = {}
  const resolving = new Set<string>()

  const resolve = (module: WardrobeModule): WardrobeTransform => {
    const cached = resolved[module.id]
    if (cached) return cached
    const base = bases?.[module.id] ?? module.transform
    const attachment = module.attachment
    if (!attachment || resolving.has(module.id)) {
      resolved[module.id] = base
      return base
    }

    resolving.add(module.id)
    const parent = byId.get(attachment.parentId)
    const parentAsset = parent ? getWardrobeAsset(parent.assetId) : undefined
    const point = parentAsset?.attachmentPoints?.find(candidate => candidate.id === attachment.pointId)
    let next = base
    if (parent && point && !resolving.has(parent.id)) {
      const worldPoint = resolveAttachmentPoint(resolve(parent), point, parentAsset?.anchor)
      next = { ...base, x: worldPoint.x, y: worldPoint.y }
    }
    resolving.delete(module.id)
    resolved[module.id] = next
    return next
  }

  for (const module of scene.modules) resolve(module)
  return resolved
}

function effectiveBox(
  transform: WardrobeTransform,
  anchor: WardrobeAssetDefinition['anchor'],
): { left: number, top: number, width: number, height: number, cx: number, cy: number } {
  const offset = anchorOffset(anchor, transform)
  const width = transform.width * (transform.scaleX ?? 1)
  const height = transform.height * (transform.scaleY ?? 1)
  const left = transform.x - offset.x
  const top = transform.y - offset.y
  return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 }
}

function unrotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  degrees: number,
): { x: number, y: number } {
  const radians = (-degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  degrees: number,
): { x: number, y: number } {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Applies a parent's old→new local-space mapping to one structural child.
    Mapping the child's visual centre (rather than its top-left anchor) keeps
    grouped objects rigid around the group centre when rotation changes. */
function transformStructuralChild(
  child: WardrobeTransform,
  oldParent: WardrobeTransform,
  newParent: WardrobeTransform,
  childAnchor: WardrobeAssetDefinition['anchor'],
  parentAnchor: WardrobeAssetDefinition['anchor'],
): WardrobeTransform {
  const oldParentBox = effectiveBox(oldParent, parentAnchor)
  const newParentBox = effectiveBox(newParent, parentAnchor)
  if (oldParentBox.width === 0 || oldParentBox.height === 0) return child

  const childBox = effectiveBox(child, childAnchor)
  const unrotatedCenter = unrotatePoint(
    childBox.cx,
    childBox.cy,
    oldParentBox.cx,
    oldParentBox.cy,
    oldParent.rotation,
  )
  const u = (unrotatedCenter.x - oldParentBox.left) / oldParentBox.width
  const v = (unrotatedCenter.y - oldParentBox.top) / oldParentBox.height
  const mappedUnrotated = {
    x: newParentBox.left + u * newParentBox.width,
    y: newParentBox.top + v * newParentBox.height,
  }
  const mappedCenter = rotatePoint(
    mappedUnrotated.x,
    mappedUnrotated.y,
    newParentBox.cx,
    newParentBox.cy,
    newParent.rotation,
  )
  const widthRatio = newParentBox.width / oldParentBox.width
  const heightRatio = newParentBox.height / oldParentBox.height
  const next: WardrobeTransform = {
    ...child,
    width: child.width * widthRatio,
    height: child.height * heightRatio,
    rotation: ((child.rotation + newParent.rotation - oldParent.rotation) % 360 + 360) % 360,
  }
  const nextBox = effectiveBox({ ...next, x: 0, y: 0 }, childAnchor)
  const nextOffset = anchorOffset(childAnchor, next)
  next.x = mappedCenter.x - nextBox.width / 2 + nextOffset.x
  next.y = mappedCenter.y - nextBox.height / 2 + nextOffset.y
  return next
}

/**
 * Materialised world transforms for a scene. `overrides` applies an editor
 * gesture/command to explicitly patched modules; every unpatched structural
 * descendant is then mapped through its parent's old→new local transform,
 * preserving grouped/nested relative positions through move, resize, scale,
 * and rotation. Attachment x/y remains point-derived and is applied last, so
 * this extends hierarchy semantics without changing attachment behaviour.
 * Invalid/cyclic links fall back to stored world data rather than hanging.
 */
export function resolveWardrobeTransforms(
  scene: WardrobeScene,
  overrides: Record<string, WardrobeTransform> | null = null,
): Record<string, WardrobeTransform> {
  const byId = moduleMap(scene)
  const oldWorld = resolveAttachmentTransforms(scene)
  if (!overrides || Object.keys(overrides).length === 0) return oldWorld

  const resolved: Record<string, WardrobeTransform> = {}
  const resolving = new Set<string>()
  const resolve = (module: WardrobeModule): WardrobeTransform => {
    const cached = resolved[module.id]
    if (cached) return cached
    const fallback = overrides[module.id] ?? oldWorld[module.id] ?? module.transform
    if (resolving.has(module.id)) return fallback
    resolving.add(module.id)

    let next = fallback
    if (!(module.id in overrides) && module.parentId) {
      const parent = byId.get(module.parentId)
      if (parent && !resolving.has(parent.id)) {
        const oldParent = oldWorld[parent.id] ?? parent.transform
        const newParent = resolve(parent)
        next = transformStructuralChild(
          oldWorld[module.id] ?? module.transform,
          oldParent,
          newParent,
          getWardrobeAsset(module.assetId)?.anchor,
          getWardrobeAsset(parent.assetId)?.anchor,
        )
      }
    }

    if (module.attachment) {
      const parent = byId.get(module.attachment.parentId)
      const parentAsset = parent ? getWardrobeAsset(parent.assetId) : undefined
      const point = parentAsset?.attachmentPoints?.find(
        candidate => candidate.id === module.attachment?.pointId,
      )
      if (parent && point && !resolving.has(parent.id)) {
        const worldPoint = resolveAttachmentPoint(resolve(parent), point, parentAsset?.anchor)
        next = { ...next, x: worldPoint.x, y: worldPoint.y }
      }
    }

    resolving.delete(module.id)
    resolved[module.id] = next
    return next
  }
  for (const module of scene.modules) resolve(module)
  return resolved
}

function sameTransform(a: WardrobeTransform, b: WardrobeTransform): boolean {
  return a === b || (
    a.x === b.x && a.y === b.y &&
    a.width === b.width && a.height === b.height &&
    a.rotation === b.rotation &&
    (a.scaleX ?? 1) === (b.scaleX ?? 1) &&
    (a.scaleY ?? 1) === (b.scaleY ?? 1)
  )
}

interface Box { minX: number, minY: number, maxX: number, maxY: number }

function bboxOf(transforms: WardrobeTransform[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of transforms) {
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + t.width)
    maxY = Math.max(maxY, t.y + t.height)
  }
  return { minX, minY, maxX, maxY }
}

export function addModuleCommand(scene: WardrobeScene, module: WardrobeModule): WardrobeCommand {
  return replaceModules('Add module', scene.modules, [...scene.modules, module])
}

/** Children of removed parents are DETACHED, not deleted — a shelf outlives
    its cabinet so nothing the player placed silently vanishes. Attachments
    onto a removed parent are cleared the same way. */
export function removeModulesCommand(scene: WardrobeScene, ids: string[]): WardrobeCommand | null {
  const removed = new Set(ids.filter(id => scene.modules.some(m => m.id === id)))
  if (removed.size === 0) return null
  const world = resolveWardrobeTransforms(scene)
  const after = scene.modules
    .filter(m => !removed.has(m.id))
    .map(m => {
      const orphaned = m.parentId !== undefined && removed.has(m.parentId)
      const unhooked = m.attachment !== undefined && removed.has(m.attachment.parentId)
      if (!orphaned && !unhooked) return m
      const next = { ...m }
      if (orphaned) next.parentId = undefined
      if (unhooked) {
        next.attachment = undefined
        next.transform = world[m.id] ?? m.transform
      }
      return next
    })
  return replaceModules('Remove modules', scene.modules, after)
}

/** Clones the selection plus every descendant, preserving parentage and
    attachments between cloned modules. A clone whose parent is OUTSIDE the
    cloned set keeps that external parent; an attachment onto an external
    parent is dropped — the point is already occupied by the original. */
export function duplicateModulesCommand(
  scene: WardrobeScene,
  ids: string[],
): { command: WardrobeCommand, newIds: string[] } | null {
  const byId = moduleMap(scene)
  const cloneIds = new Set<string>()
  for (const id of ids) {
    if (!byId.has(id)) continue
    cloneIds.add(id)
    for (const descendant of collectDescendants(scene, id)) cloneIds.add(descendant)
  }
  if (cloneIds.size === 0) return null
  const idMap: Record<string, string> = {}
  for (const id of cloneIds) idMap[id] = wardrobeId(byId.get(id)!.type)
  const clones = scene.modules
    .filter(m => cloneIds.has(m.id))
    .map(m => ({
      ...m,
      id: idMap[m.id],
      parentId: m.parentId !== undefined && idMap[m.parentId] ? idMap[m.parentId] : m.parentId,
      attachment: m.attachment && idMap[m.attachment.parentId]
        ? { parentId: idMap[m.attachment.parentId], pointId: m.attachment.pointId }
        : undefined,
      transform: { ...m.transform, x: m.transform.x + 0.03, y: m.transform.y + 0.03 },
      properties: m.properties ? { ...m.properties } : undefined,
    }))
  return {
    command: replaceModules('Duplicate modules', scene.modules, [...scene.modules, ...clones]),
    newIds: clones.map(m => m.id),
  }
}

/** One command per gesture. Explicit transforms stay authoritative; every
    unpatched structural descendant is mapped through its parent's local
    old→new transform, then attachment coordinates are derived. The complete
    world result is captured in this single command for deterministic history. */
export function updateTransformsCommand(
  scene: WardrobeScene,
  patch: Record<string, WardrobeTransform>,
  label = 'Transform',
): WardrobeCommand | null {
  const byId = moduleMap(scene)
  const explicit: Record<string, WardrobeTransform> = {}
  for (const [id, next] of Object.entries(patch)) {
    if (byId.has(id)) explicit[id] = next
  }
  if (Object.keys(explicit).length === 0) return null

  const world = resolveWardrobeTransforms(scene, explicit)
  const before: Record<string, WardrobeTransform> = {}
  const after: Record<string, WardrobeTransform> = {}
  for (const module of scene.modules) {
    const next = world[module.id]
    if (!next) continue
    if (!(module.id in explicit) && sameTransform(next, module.transform)) continue
    before[module.id] = module.transform
    after[module.id] = next
  }
  const withTransforms = (map: Record<string, WardrobeTransform>) => (scene2: WardrobeScene) => ({
    ...scene2,
    modules: scene2.modules.map(m => (map[m.id] ? { ...m, transform: map[m.id] } : m)),
  })
  return { label, apply: withTransforms(after), revert: withTransforms(before) }
}

/** The store validates via canAttach and resolves the snapped transform
    before building this command; the command itself only records data. */
export function attachModuleCommand(
  scene: WardrobeScene,
  id: string,
  attachment: WardrobeAttachment,
  snapped?: WardrobeTransform,
): WardrobeCommand | null {
  const module = scene.modules.find(m => m.id === id)
  if (!module) return null
  const linked: WardrobeScene = {
    ...scene,
    modules: scene.modules.map(m =>
      m.id === id ? { ...m, attachment, transform: snapped ?? m.transform } : m),
  }
  const world = resolveWardrobeTransforms(linked)
  const after = linked.modules.map(m => (
    m.id === id ? { ...m, transform: world[id] ?? m.transform } : m
  ))
  return replaceModules('Attach', scene.modules, after)
}

/** Detaching keeps the last derived transform — the module stays where it
    hung instead of jumping. */
export function detachModuleCommand(scene: WardrobeScene, id: string): WardrobeCommand | null {
  const module = scene.modules.find(m => m.id === id)
  if (!module || !module.attachment) return null
  const world = resolveWardrobeTransforms(scene)
  const after = scene.modules.map(m => (m.id === id
    ? { ...m, attachment: undefined, transform: world[id] ?? m.transform }
    : m))
  return replaceModules('Detach', scene.modules, after)
}

export function setParentCommand(
  scene: WardrobeScene,
  id: string,
  parentId: string | undefined,
): WardrobeCommand | null {
  const module = scene.modules.find(m => m.id === id)
  if (!module || module.parentId === parentId) return null
  const after = scene.modules.map(m => (m.id === id ? { ...m, parentId } : m))
  return replaceModules('Set parent', scene.modules, after)
}

export function setLayerCommand(
  scene: WardrobeScene,
  ids: string[],
  delta: number,
): WardrobeCommand | null {
  const targets = new Set(ids)
  if (delta === 0 || !scene.modules.some(m => targets.has(m.id))) return null
  const after = scene.modules.map(m =>
    targets.has(m.id) ? { ...m, layer: m.layer + delta } : m)
  return replaceModules('Reorder layers', scene.modules, after)
}

export function setModulePropsCommand(
  scene: WardrobeScene,
  id: string,
  patch: Partial<Pick<WardrobeModule, 'opacity' | 'visible' | 'locked' | 'tint' | 'assetId' | 'animation' | 'properties'>>,
): WardrobeCommand | null {
  const module = scene.modules.find(m => m.id === id)
  if (!module) return null
  const after = scene.modules.map(m => (m.id === id ? { ...m, ...patch } : m))
  return replaceModules('Edit module', scene.modules, after)
}

/** Grouping wraps the members in a synthetic container spanning their bbox.
    'divider' + 'group_container' is the reserved synthetic pairing — the
    renderer draws nothing for it, the layers panel nests by it. */
export function groupModulesCommand(
  scene: WardrobeScene,
  ids: string[],
): { command: WardrobeCommand, groupId: string } | null {
  const members = scene.modules.filter(m => ids.includes(m.id))
  if (members.length === 0) return null
  const box = bboxOf(members.map(m => m.transform))
  const groupId = wardrobeId('group')
  const memberIds = new Set(members.map(m => m.id))
  const group: WardrobeModule = {
    id: groupId,
    type: 'divider',
    assetId: 'group_container',
    transform: {
      x: box.minX,
      y: box.minY,
      width: box.maxX - box.minX,
      height: box.maxY - box.minY,
      rotation: 0,
    },
    layer: Math.min(...members.map(m => m.layer)),
    properties: { isGroup: true },
  }
  const after = [
    ...scene.modules.map(m => (memberIds.has(m.id) ? { ...m, parentId: groupId } : m)),
    group,
  ]
  return { command: replaceModules('Group modules', scene.modules, after), groupId }
}

/** Members are re-parented to the group's own parent (usually none), then the
    container is deleted. Ids that are not isGroup containers are ignored. */
export function ungroupModulesCommand(scene: WardrobeScene, ids: string[]): WardrobeCommand | null {
  const byId = moduleMap(scene)
  const groups = ids
    .map(id => byId.get(id))
    .filter((m): m is WardrobeModule => m !== undefined && m.properties?.isGroup === true)
  if (groups.length === 0) return null
  const groupIds = new Set(groups.map(g => g.id))
  const after = scene.modules
    .filter(m => !groupIds.has(m.id))
    .map(m => (m.parentId !== undefined && groupIds.has(m.parentId)
      ? { ...m, parentId: byId.get(m.parentId)!.parentId }
      : m))
  return replaceModules('Ungroup modules', scene.modules, after)
}

/** Instantiates a prefab: fresh ids from temporaryIds, internal parentage and
    attachments remapped, the whole prefab bbox re-centred on `at`. */
export function applyPrefabCommand(
  scene: WardrobeScene,
  prefab: WardrobePrefab,
  at: { x: number, y: number },
): { command: WardrobeCommand, newIds: string[] } | null {
  if (prefab.modules.length === 0) return null
  const idMap: Record<string, string> = {}
  for (const pm of prefab.modules) idMap[pm.temporaryId] = wardrobeId(pm.type)
  const box = bboxOf(prefab.modules.map(pm => pm.transform))
  const dx = at.x - (box.minX + box.maxX) / 2
  const dy = at.y - (box.minY + box.maxY) / 2
  const created: WardrobeModule[] = prefab.modules.map(pm => ({
    id: idMap[pm.temporaryId],
    type: pm.type,
    assetId: pm.assetId,
    parentId: pm.parentTemporaryId !== undefined ? idMap[pm.parentTemporaryId] : undefined,
    attachment: pm.attachment && idMap[pm.attachment.parentTemporaryId]
      ? { parentId: idMap[pm.attachment.parentTemporaryId], pointId: pm.attachment.pointId }
      : undefined,
    transform: { ...pm.transform, x: pm.transform.x + dx, y: pm.transform.y + dy },
    layer: pm.layer,
    properties: pm.properties ? { ...pm.properties } : undefined,
  }))
  return {
    command: replaceModules('Apply prefab', scene.modules, [...scene.modules, ...created]),
    newIds: created.map(m => m.id),
  }
}

export function applyThemeCommand(scene: WardrobeScene, theme: WardrobeTheme): WardrobeCommand {
  const before = scene.theme
  return {
    label: 'Apply theme',
    apply: (scene2: WardrobeScene) => ({ ...scene2, theme }),
    revert: (scene2: WardrobeScene) => ({ ...scene2, theme: before }),
  }
}
