/**
 * Scene validation for the modular wardrobe. Pure data-in/issues-out: nothing
 * here throws, mutates, or touches the DOM, so the store can gate every
 * command and the repository can gate every save with the same function.
 */
import { WARDROBE_LIMITS } from './wardrobeTypes'
import type {
  WardrobeAssetDefinition,
  WardrobeModule,
  WardrobeModuleType,
  WardrobeScene,
  WardrobeValidationCode,
  WardrobeValidationIssue,
  WardrobeValidationResult,
} from './wardrobeTypes'

type WardrobeAssetRegistry = Record<string, WardrobeAssetDefinition>

const MODULE_TYPES: readonly WardrobeModuleType[] = [
  'wardrobeFrame', 'wardrobeDoor', 'divider', 'shelf', 'drawer', 'cabinet',
  'rail', 'hook', 'shoeRack', 'storageBox', 'mirror', 'rug',
  'hangingClothing', 'foldedClothing', 'shoe', 'hat', 'handbag', 'jewelry',
  'perfume', 'cosmetic', 'plant', 'decoration', 'trophy', 'light',
  'particleEffect', 'character', 'background', 'floor',
]

const MODULE_TYPE_SET = new Set<string>(MODULE_TYPES)

const CLOTHING_TYPES: readonly WardrobeModuleType[] = [
  'hangingClothing', 'foldedClothing', 'shoe', 'hat', 'handbag', 'jewelry',
]

const ANY_PARENT: WardrobeModuleType[] = [...MODULE_TYPES]
const NON_CLOTHING_PARENTS: WardrobeModuleType[] =
  MODULE_TYPES.filter((t) => !CLOTHING_TYPES.includes(t))

/** Allowed parent types per child type. Enforced at slot attachment
    (incompatible-attachment); also the table any re-parenting UI consults.
    Structural pieces and the character may sit under anything except worn
    clothing; clothing itself only mounts on the storage that suits it. */
export const PLACEMENT_RULES: Record<WardrobeModuleType, WardrobeModuleType[]> = {
  wardrobeFrame: NON_CLOTHING_PARENTS,
  wardrobeDoor: NON_CLOTHING_PARENTS,
  divider: NON_CLOTHING_PARENTS,
  shelf: NON_CLOTHING_PARENTS,
  drawer: NON_CLOTHING_PARENTS,
  cabinet: NON_CLOTHING_PARENTS,
  rail: NON_CLOTHING_PARENTS,
  hook: ANY_PARENT,
  shoeRack: NON_CLOTHING_PARENTS,
  storageBox: ANY_PARENT,
  mirror: NON_CLOTHING_PARENTS,
  rug: ANY_PARENT,
  hangingClothing: ['rail', 'hook'],
  foldedClothing: ['shelf', 'cabinet', 'drawer'],
  shoe: ['shelf', 'shoeRack', 'floor', 'storageBox'],
  hat: ['hook', 'shelf'],
  handbag: ['hook', 'rail', 'shelf'],
  jewelry: ['hook', 'drawer', 'shelf'],
  perfume: ANY_PARENT,
  cosmetic: ANY_PARENT,
  plant: ANY_PARENT,
  decoration: ANY_PARENT,
  trophy: ANY_PARENT,
  light: ANY_PARENT,
  particleEffect: ANY_PARENT,
  character: NON_CLOTHING_PARENTS,
  background: ANY_PARENT,
  floor: ANY_PARENT,
}

/* The default registry loads lazily, and only in a browser, so importing this
   module under node (vitest) never drags in wardrobeAssets — tests inject
   fixture registries. Until the import settles, asset-backed checks are
   skipped rather than failed. */
let defaultRegistry: WardrobeAssetRegistry | undefined
if (typeof window !== 'undefined') {
  import('./wardrobeAssets')
    .then((m) => { defaultRegistry = m.wardrobeAssetRegistry })
    .catch(() => { defaultRegistry = undefined })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFinite_(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function issue(
  code: WardrobeValidationCode,
  severity: 'error' | 'warning',
  message: string,
  moduleId?: string,
): WardrobeValidationIssue {
  return moduleId === undefined
    ? { code, severity, message }
    : { code, severity, message, moduleId }
}

function toResult(issues: WardrobeValidationIssue[]): WardrobeValidationResult {
  return { ok: issues.every((i) => i.severity !== 'error'), issues }
}

/** Locked is an editing gate, not a validity fact — validateScene stays quiet
    about it; store operations ask here before mutating a module. */
export function canEditModule(m: WardrobeModule): boolean {
  return m.locked !== true
}

/** Central edit guard used by every store mutation that can alter an existing
    module. `includeDescendants` is for operations such as moving/removing a
    parent, whose command also updates children even when the caller only
    names the parent. Keeping this in validation (rather than individual UI
    controls) means alternate panels and programmatic callers cannot bypass a
    lock. */
export function validateEditableModules(
  scene: WardrobeScene,
  ids: Iterable<string>,
  options?: { includeDescendants?: boolean, action?: string },
): WardrobeValidationResult {
  const requested = new Set(ids)
  const affected = new Set(requested)

  if (options?.includeDescendants) {
    // Follow structural parentage and slot attachments to a fixed point. The
    // module cap keeps this bounded, and the set terminates corrupt cycles.
    let changed = true
    while (changed) {
      changed = false
      for (const module of scene.modules) {
        const parentIds = [module.parentId, module.attachment?.parentId]
        if (!parentIds.some(parentId => parentId && affected.has(parentId)) || affected.has(module.id)) continue
        affected.add(module.id)
        changed = true
      }
    }
  }

  const action = options?.action ?? 'edit'
  const issues = scene.modules
    .filter(module => affected.has(module.id) && !canEditModule(module))
    .map(module => issue(
      'locked-module',
      'error',
      `cannot ${action} locked module "${module.id}"; unlock it first`,
      module.id,
    ))

  return toResult(issues)
}

/** Whether childType may occupy the named attachment point on parentAsset.
    Combines the point's own allow-list, the asset-level allow-list, and
    PLACEMENT_RULES. */
export function canAttach(
  childType: WardrobeModuleType,
  parentAsset: WardrobeAssetDefinition,
  pointId: string,
): boolean {
  const point = (parentAsset.attachmentPoints ?? []).find((p) => p.id === pointId)
  if (!point) return false
  if (!point.allowedTypes.includes(childType)) return false
  if (parentAsset.allowedAttachmentTypes && !parentAsset.allowedAttachmentTypes.includes(childType)) return false
  const allowedParents = PLACEMENT_RULES[childType]
  return !allowedParents || allowedParents.includes(parentAsset.type)
}

function parentLinkOf(m: WardrobeModule): string | undefined {
  return m.parentId ?? m.attachment?.parentId
}

/** True when walking start's parent chain arrives back at start. The visited
    set also stops the walk from orbiting a cycle start merely hangs off. */
function isInParentCycle(start: WardrobeModule, byId: Map<string, WardrobeModule>): boolean {
  const visited = new Set<string>([start.id])
  let next = parentLinkOf(start)
  while (next !== undefined) {
    if (next === start.id) return true
    if (visited.has(next)) return false
    visited.add(next)
    const parent = byId.get(next)
    if (!parent) return false
    next = parentLinkOf(parent)
  }
  return false
}

interface ModuleCheckContext {
  byId: Map<string, WardrobeModule>
  canvas: unknown
  registry: WardrobeAssetRegistry | undefined
  ownedPremium: Set<string>
  /** validatePlacement is geometry/compatibility only — ownership is checked
      where entitlements are actually known (validateScene callers). */
  checkPremium: boolean
  issues: WardrobeValidationIssue[]
}

function checkModule(entry: unknown, label: string, ctx: ModuleCheckContext): void {
  const { issues, registry } = ctx

  if (!isRecord(entry)) {
    issues.push(issue('malformed-scene', 'error', `${label} is not an object`))
    return
  }
  const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : undefined
  if (id === undefined) {
    issues.push(issue('malformed-scene', 'error', `${label} is missing a string id`))
    return
  }
  const t = entry.transform
  if (!isRecord(t) || !isFinite_(t.x) || !isFinite_(t.y) ||
      !isFinite_(t.width) || !isFinite_(t.height) || !isFinite_(t.rotation)) {
    issues.push(issue('malformed-scene', 'error',
      `module "${id}" transform must carry numeric x, y, width, height and rotation`, id))
    return
  }
  if (!isFinite_(entry.layer)) {
    issues.push(issue('malformed-scene', 'error', `module "${id}" is missing a numeric layer`, id))
  }
  if (typeof entry.assetId !== 'string' || entry.assetId === '') {
    issues.push(issue('malformed-scene', 'error', `module "${id}" is missing a string assetId`, id))
  }

  const type = entry.type
  const typeKnown = typeof type === 'string' && MODULE_TYPE_SET.has(type)
  if (!typeKnown) {
    issues.push(issue('unknown-module-type', 'warning',
      `module "${id}" has unknown type "${String(type)}"`, id))
  }

  if (registry && typeof entry.assetId === 'string' && entry.assetId !== '') {
    const asset = registry[entry.assetId]
    if (!asset) {
      issues.push(issue('missing-asset', 'warning',
        `module "${id}" references asset "${entry.assetId}" which is not in the registry`, id))
    } else if (ctx.checkPremium && asset.premium && !ctx.ownedPremium.has(entry.assetId)) {
      issues.push(issue('premium-not-owned', 'error',
        `module "${id}" uses premium asset "${entry.assetId}" that is not owned`, id))
    }
  }

  const module = entry as unknown as WardrobeModule

  if (module.parentId !== undefined) {
    if (typeof module.parentId !== 'string' || !ctx.byId.has(module.parentId)) {
      issues.push(issue('invalid-parent', 'error',
        `module "${id}" names missing parent "${String(module.parentId)}"`, id))
    }
  }
  if (isInParentCycle(module, ctx.byId)) {
    issues.push(issue('circular-parent', 'error',
      `module "${id}" is part of a circular parent chain`, id))
  }

  const attachment = entry.attachment
  if (attachment !== undefined) {
    if (!isRecord(attachment) || typeof attachment.parentId !== 'string' ||
        typeof attachment.pointId !== 'string') {
      issues.push(issue('malformed-scene', 'error',
        `module "${id}" attachment must carry string parentId and pointId`, id))
    } else {
      const parent = attachment.parentId === id ? undefined : ctx.byId.get(attachment.parentId)
      if (!parent) {
        issues.push(issue('invalid-attachment-parent', 'error',
          `module "${id}" attaches to missing module "${attachment.parentId}"`, id))
      } else {
        const allowedParents = typeKnown ? PLACEMENT_RULES[type as WardrobeModuleType] : undefined
        if (allowedParents && !allowedParents.includes(parent.type)) {
          issues.push(issue('incompatible-attachment', 'error',
            `module "${id}" (${String(type)}) may not attach to a ${parent.type}`, id))
        } else if (registry) {
          const parentAsset = registry[parent.assetId]
          if (parentAsset) {
            const point = (parentAsset.attachmentPoints ?? [])
              .find((p) => p.id === attachment.pointId)
            if (!point) {
              issues.push(issue('invalid-attachment-point', 'error',
                `module "${id}" attaches to point "${attachment.pointId}" which "${parent.id}" does not expose`, id))
            } else if (typeKnown && !canAttach(type as WardrobeModuleType, parentAsset, point.id)) {
              issues.push(issue('incompatible-attachment', 'error',
                `point "${point.id}" on "${parent.id}" does not accept ${String(type)} module "${id}"`, id))
            }
          }
        }
      }
    }
  }

  // safeAreaPadding reads as tolerance: an overhang no larger than the
  // safe-area inset still renders acceptably, so only spill beyond it flags.
  const pad = isRecord(ctx.canvas) && isFinite_(ctx.canvas.safeAreaPadding)
    ? ctx.canvas.safeAreaPadding
    : 0
  if (t.x < -pad || t.y < -pad || t.x + t.width > 1 + pad || t.y + t.height > 1 + pad) {
    issues.push(issue('out-of-bounds', 'warning',
      `module "${id}" extends beyond the canvas by more than the safe-area tolerance`, id))
  }
  // A light strip is intentionally thin on one axis while retaining a large,
  // usable selectable length. All other modules keep the general minimum on
  // both axes; a light still must have a positive thin dimension.
  const thinLight = type === 'light'
    && t.width > 0 && t.height > 0
    && Math.max(t.width, t.height) >= WARDROBE_LIMITS.minSize
  if ((t.width < WARDROBE_LIMITS.minSize || t.height < WARDROBE_LIMITS.minSize) && !thinLight) {
    issues.push(issue('below-minimum-size', 'error',
      `module "${id}" is smaller than the minimum size ${WARDROBE_LIMITS.minSize}`, id))
  }
  if (t.width > WARDROBE_LIMITS.maxSize || t.height > WARDROBE_LIMITS.maxSize) {
    issues.push(issue('above-maximum-size', 'error',
      `module "${id}" is larger than the maximum size ${WARDROBE_LIMITS.maxSize}`, id))
  }
}

function buildById(modules: unknown[]): Map<string, WardrobeModule> {
  const byId = new Map<string, WardrobeModule>()
  for (const entry of modules) {
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id !== '') {
      byId.set(entry.id, entry as unknown as WardrobeModule)
    }
  }
  return byId
}

export function validateScene(
  scene: WardrobeScene,
  opts?: { ownedPremium?: Set<string>, registry?: WardrobeAssetRegistry },
): WardrobeValidationResult {
  const issues: WardrobeValidationIssue[] = []

  if (!isRecord(scene)) {
    return toResult([issue('malformed-scene', 'error', 'scene is not an object')])
  }
  const raw = scene as unknown as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id === '') {
    issues.push(issue('malformed-scene', 'error', 'scene is missing a string id'))
  }
  if (typeof raw.name !== 'string') {
    issues.push(issue('malformed-scene', 'error', 'scene is missing a string name'))
  } else if (raw.name.length >= 100) {
    issues.push(issue('malformed-scene', 'error', 'scene name must be shorter than 100 characters'))
  }
  if (!isFinite_(raw.version)) {
    issues.push(issue('malformed-scene', 'error', 'scene is missing a numeric version'))
  }
  const canvas = raw.canvas
  if (!isRecord(canvas) || !isFinite_(canvas.width) || !isFinite_(canvas.height) ||
      canvas.width <= 0 || canvas.height <= 0) {
    issues.push(issue('malformed-scene', 'error', 'scene canvas must carry positive numeric width and height'))
  }
  if (!Array.isArray(raw.modules)) {
    issues.push(issue('malformed-scene', 'error', 'scene modules must be an array'))
    return toResult(issues)
  }

  const modules = raw.modules as unknown[]
  if (modules.length > WARDROBE_LIMITS.maxModules) {
    issues.push(issue('module-limit-exceeded', 'error',
      `scene has ${modules.length} modules — the limit is ${WARDROBE_LIMITS.maxModules}`))
  }

  const seen = new Set<string>()
  for (const entry of modules) {
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id !== '') {
      if (seen.has(entry.id)) {
        issues.push(issue('malformed-scene', 'error', `module id "${entry.id}" appears more than once`, entry.id))
      }
      seen.add(entry.id)
    }
  }

  const ctx: ModuleCheckContext = {
    byId: buildById(modules),
    canvas,
    registry: opts?.registry ?? defaultRegistry,
    ownedPremium: opts?.ownedPremium ?? new Set(),
    checkPremium: true,
    issues,
  }
  modules.forEach((entry, index) => checkModule(entry, `modules[${index}]`, ctx))

  return toResult(issues)
}

/** Validates one module against a scene it may not belong to yet (add, drop,
    re-parent previews). Ownership is out of scope here — see checkPremium. */
export function validatePlacement(
  scene: WardrobeScene,
  module: WardrobeModule,
): WardrobeValidationResult {
  const issues: WardrobeValidationIssue[] = []

  if (!isRecord(scene) || !Array.isArray((scene as unknown as Record<string, unknown>).modules)) {
    return toResult([issue('malformed-scene', 'error', 'scene modules must be an array')])
  }
  const raw = scene as unknown as Record<string, unknown>
  const byId = buildById(raw.modules as unknown[])
  if (isRecord(module) && typeof module.id === 'string' && module.id !== '') {
    byId.set(module.id, module)
  }

  const ctx: ModuleCheckContext = {
    byId,
    canvas: raw.canvas,
    registry: defaultRegistry,
    ownedPremium: new Set(),
    checkPremium: false,
    issues,
  }
  checkModule(module, 'module', ctx)

  return toResult(issues)
}
