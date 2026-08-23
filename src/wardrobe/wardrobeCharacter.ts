/**
 * Bridge between the app-wide character (characterStore.PoplurCharacter) and
 * the wardrobe scene's WardrobeCharacterAppearance.
 *
 * Scene data must stay RENDERER-AGNOSTIC: appearance fields are opaque ids
 * ('skin:#F5C4B3', 'hair:short:#2C2C2A'), never hexes the scene shape assigns
 * meaning to. That lets the renderer behind CharacterModule swap to layered
 * 2D sheets, sprites, 3D, or a server-rendered image later by introducing new
 * id formats — existing scenes keep loading with no migration, because only
 * the id INTERPRETER changes, not the stored shape.
 *
 * Both directions are total functions: null input and foreign/future ids
 * resolve to defaultCharacter() fields instead of throwing, so a scene
 * authored against a newer id scheme still opens on an older build.
 *
 * Gender is encoded in characterId (`poplur:male|female`). Layered outfit
 * choices use `part:<slot>:<url-encoded-id>` entries in accessoryIds; that
 * array is the appearance contract's extensible id collection, not a promise
 * that every entry is visually worn as jewelry. updatedAt is intentionally
 * not scene data — callers stamp it only when the app-wide character changes.
 */
import { defaultCharacter, HAIR_STYLES } from '../characterStore'
import type { HairStyle, PoplurCharacter } from '../characterStore'
import type { PartSlot } from '../characterParts'
import type { WardrobeCharacterAppearance, WardrobeScene } from './wardrobeTypes'

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const PART_SLOTS: PartSlot[] = [
  'body', 'bottom', 'shoes', 'top', 'face', 'hairBack', 'hairFront', 'glasses', 'accessory',
]
const PART_SLOT_SET = new Set<string>(PART_SLOTS)

/** 'prefix:#hex' → hex, anything else (foreign renderer id, junk) → fallback. */
function hexFromId(id: unknown, prefix: string, fallback: string): string {
  if (typeof id !== 'string') return fallback
  const parts = id.split(':')
  if (parts.length !== 2 || parts[0] !== prefix) return fallback
  return HEX_COLOR.test(parts[1]) ? parts[1] : fallback
}

/** 'hair:style:#hex' — each segment falls back independently, so a known
    style with a foreign colour id (or vice versa) keeps what it can. */
function hairFromId(id: unknown, base: PoplurCharacter): { hairStyle: HairStyle, hairColor: string } {
  if (typeof id !== 'string') return { hairStyle: base.hairStyle, hairColor: base.hairColor }
  const parts = id.split(':')
  if (parts.length !== 3 || parts[0] !== 'hair') return { hairStyle: base.hairStyle, hairColor: base.hairColor }
  const style = (HAIR_STYLES as readonly string[]).includes(parts[1])
    ? parts[1] as HairStyle
    : base.hairStyle
  const color = HEX_COLOR.test(parts[2]) ? parts[2] : base.hairColor
  return { hairStyle: style, hairColor: color }
}

function genderFromId(id: unknown, fallback: PoplurCharacter['gender']): PoplurCharacter['gender'] {
  if (id === 'poplur:male') return 'male'
  if (id === 'poplur:female') return 'female'
  return fallback
}

function outfitIds(outfit: PoplurCharacter['outfit']): string[] {
  if (!outfit) return []
  const ids: string[] = []
  for (const slot of PART_SLOTS) {
    const id = outfit[slot]
    if (typeof id === 'string' && id.length > 0) {
      ids.push(`part:${slot}:${encodeURIComponent(id)}`)
    }
  }
  return ids
}

function outfitFromIds(ids: unknown): PoplurCharacter['outfit'] {
  if (!Array.isArray(ids)) return undefined
  const outfit: NonNullable<PoplurCharacter['outfit']> = {}
  for (const value of ids) {
    if (typeof value !== 'string' || !value.startsWith('part:')) continue
    const separator = value.indexOf(':', 5)
    if (separator < 0) continue
    const slot = value.slice(5, separator)
    if (!PART_SLOT_SET.has(slot)) continue
    try {
      const id = decodeURIComponent(value.slice(separator + 1))
      if (id) outfit[slot as PartSlot] = id
    } catch {
      // A malformed future/foreign id is ignored, like every other opaque id.
    }
  }
  return Object.keys(outfit).length > 0 ? outfit : undefined
}

export function appearanceFromPoplur(c: PoplurCharacter | null): WardrobeCharacterAppearance {
  const source = c ?? defaultCharacter()
  return {
    characterId: `poplur:${source.gender}`,
    skinToneId: `skin:${source.skinTone}`,
    faceId: 'face:default',
    hairId: `hair:${source.hairStyle}:${source.hairColor}`,
    eyeId: `eye:${source.eyeColor}`,
    eyebrowId: 'brow:default',
    topId: `top:${source.topColor}`,
    bottomId: `bottom:${source.bottomColor}`,
    shoeId: 'shoe:default',
    accessoryIds: outfitIds(source.outfit),
    poseId: 'stand',
    expressionId: 'smile',
  }
}

export function poplurFromAppearance(a: WardrobeCharacterAppearance): PoplurCharacter {
  const base = defaultCharacter()
  // Scene documents come from Firestore, so `a` may be missing despite the
  // type — guard rather than trust, this function must never throw.
  const source = (a ?? {}) as Partial<WardrobeCharacterAppearance>
  return {
    ...base,
    gender: genderFromId(source.characterId, base.gender),
    skinTone: hexFromId(source.skinToneId, 'skin', base.skinTone),
    ...hairFromId(source.hairId, base),
    eyeColor: hexFromId(source.eyeId, 'eye', base.eyeColor),
    topColor: hexFromId(source.topId, 'top', base.topColor),
    bottomColor: hexFromId(source.bottomId, 'bottom', base.bottomColor),
    outfit: outfitFromIds(source.accessoryIds),
  }
}

/** Clone a scene with every character module pointed at the live app-wide
    appearance. A scene with no character stays character-free — deleting the
    module must remain meaningful. */
export function sceneWithPoplurCharacter(
  scene: WardrobeScene,
  character: PoplurCharacter | null,
): WardrobeScene {
  const appearance = appearanceFromPoplur(character)
  let changed = false
  const modules = scene.modules.map(module => {
    if (module.type !== 'character') return module
    changed = true
    return {
      ...module,
      properties: { ...module.properties, appearance },
    }
  })
  return changed ? { ...scene, modules } : scene
}
