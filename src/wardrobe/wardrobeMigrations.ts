/**
 * Version migrations for persisted wardrobe scenes. One entry point,
 * migrateWardrobeScene, accepts whatever Firestore or localStorage hands back
 * and returns a CURRENT_SCENE_VERSION scene or throws WardrobeMigrationError.
 *
 * Migration never drops data: unknown keys ride through on spread so a scene
 * written by a newer minor build survives a round-trip through an older one.
 */
import { CURRENT_SCENE_VERSION, wardrobeId } from './wardrobeTypes'
import type { WardrobeScene, WardrobeTheme } from './wardrobeTypes'

export class WardrobeMigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WardrobeMigrationError'
  }
}

const FALLBACK_THEME: WardrobeTheme = {
  primaryColor: '#0B0B0E',
  secondaryColor: '#FF2D9A',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `type "${typeof value}"`
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFinite_(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readCanvas(record: Record<string, unknown>): Record<string, unknown> & { width: number, height: number } {
  const canvas = record.canvas
  if (!isRecord(canvas) || !finitePositive(canvas.width) || !finitePositive(canvas.height)) {
    throw new WardrobeMigrationError('scene canvas must carry positive numeric width and height')
  }
  return canvas as Record<string, unknown> & { width: number, height: number }
}

function readModules(record: Record<string, unknown>): unknown[] {
  if (!Array.isArray(record.modules)) {
    throw new WardrobeMigrationError('scene modules must be an array')
  }
  return record.modules
}

function readModuleRecord(entry: unknown, index: number): { module: Record<string, unknown>, label: string } {
  if (!isRecord(entry)) {
    throw new WardrobeMigrationError(`modules[${index}] is not an object`)
  }
  const label = typeof entry.id === 'string' && entry.id !== '' ? `module "${entry.id}"` : `modules[${index}]`
  return { module: entry, label }
}

function readTransform(module: Record<string, unknown>, label: string): Record<string, unknown> & { x: number, y: number, width: number, height: number } {
  const t = module.transform
  if (!isRecord(t) || !isFinite_(t.x) || !isFinite_(t.y) || !isFinite_(t.width) || !isFinite_(t.height)) {
    throw new WardrobeMigrationError(`${label} transform must carry numeric x, y, width and height`)
  }
  return t as Record<string, unknown> & { x: number, y: number, width: number, height: number }
}

function copyTheme(record: Record<string, unknown>): Record<string, unknown> {
  return isRecord(record.theme) ? { ...record.theme } : { ...FALLBACK_THEME }
}

/** v0 scenes carried absolute pixel transforms against canvas.width/height
    and no version field. Positions and sizes normalise to canvas fractions;
    everything else, known or not, is preserved. */
function migrateV0(record: Record<string, unknown>): WardrobeScene {
  const canvas = readCanvas(record)
  const modules = readModules(record).map((entry, index) => {
    const { module, label } = readModuleRecord(entry, index)
    const t = readTransform(module, label)
    return {
      ...module,
      transform: {
        ...t,
        x: t.x / canvas.width,
        y: t.y / canvas.height,
        width: t.width / canvas.width,
        height: t.height / canvas.height,
        rotation: isFinite_(t.rotation) ? t.rotation : 0,
      },
    }
  })
  const scene: Record<string, unknown> = {
    ...record,
    id: typeof record.id === 'string' && record.id !== '' ? record.id : wardrobeId('wardrobe'),
    name: typeof record.name === 'string' ? record.name : 'Wardrobe',
    version: CURRENT_SCENE_VERSION,
    canvas: { ...canvas },
    theme: copyTheme(record),
    modules,
  }
  return scene as unknown as WardrobeScene
}

/** Already-current input still gets its shape checked and comes back as a
    fresh copy, so callers can hold the result without aliasing raw storage. */
function copyCurrent(record: Record<string, unknown>): WardrobeScene {
  if (typeof record.id !== 'string' || record.id === '') {
    throw new WardrobeMigrationError('scene id must be a non-empty string')
  }
  if (typeof record.name !== 'string') {
    throw new WardrobeMigrationError('scene name must be a string')
  }
  const canvas = readCanvas(record)
  const modules = readModules(record).map((entry, index) => {
    const { module, label } = readModuleRecord(entry, index)
    const t = readTransform(module, label)
    const copy: Record<string, unknown> = { ...module, transform: { ...t } }
    if (isRecord(module.attachment)) copy.attachment = { ...module.attachment }
    return copy
  })
  const scene: Record<string, unknown> = {
    ...record,
    canvas: { ...canvas },
    theme: copyTheme(record),
    modules,
  }
  return scene as unknown as WardrobeScene
}

export function migrateWardrobeScene(raw: unknown): WardrobeScene {
  if (!isRecord(raw)) {
    throw new WardrobeMigrationError(`wardrobe scene must be an object, got ${describe(raw)}`)
  }
  const version = raw.version
  // v0 predates the version field; an explicit 0 is the same vintage.
  if (version === undefined || version === 0) return migrateV0(raw)
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new WardrobeMigrationError(`scene version must be a number, got ${describe(version)}`)
  }
  if (version > CURRENT_SCENE_VERSION) {
    throw new WardrobeMigrationError(`scene version ${version} is newer than this app understands`)
  }
  if (version === CURRENT_SCENE_VERSION) return copyCurrent(raw)
  throw new WardrobeMigrationError(`no migration path from scene version ${version}`)
}
