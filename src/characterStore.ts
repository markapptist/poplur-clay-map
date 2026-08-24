import { isNativeShell, postNativeEvent } from './nativeBridge'

// v1 of this store wrapped Ready Player Me (rpmUrl + iframe editor). Netflix
// bought RPM in Dec 2025 and shut the whole service down 31 Jan 2026 — every
// *.readyplayer.me host is NXDOMAIN now — so the character is described by
// appearance parameters rendered in-house (ClayCharacter), not a vendor GLB.
// The v1 key is abandoned rather than migrated: nothing recoverable lives in
// an rpmUrl that no longer resolves.
const STORAGE_KEY = 'poplur.character.v2'

import type { PartSlot } from './characterParts'

export type HairStyle = 'short' | 'long' | 'buzz' | 'curly'
export type BodyShape = 'slim' | 'athletic' | 'curvy'
export type FaceStyle = 'smile' | 'wink' | 'freckles'

export interface PoplurCharacter {
  gender: 'male' | 'female'
  skinTone: string
  hairColor: string
  hairStyle: HairStyle
  bodyShape?: BodyShape
  /** User-controlled stature multipliers, centred at 1. */
  heightScale?: number
  statureScale?: number
  faceStyle?: FaceStyle
  eyeColor: string
  topColor: string
  bottomColor: string
  /** Chosen part ids per slot for the layered art renderer (characterParts).
      Colour fields above drive the SVG fallback; once the art library's core
      slots have parts, these ids pick which part sheet each slot wears. */
  outfit?: Partial<Record<PartSlot, string>>
  updatedAt: number
}

export const SKIN_TONES = ['#F5C4B3', '#EDA98E', '#C98B62', '#9C6742', '#6E4630', '#4A2F21']
export const HAIR_COLORS = ['#2C2C2A', '#5F4632', '#8B6C4A', '#C7A35C', '#B0402F', '#888780', '#D4537E']
export const EYE_COLORS = ['#2C2C2A', '#4A3524', '#185FA5', '#3B6D11', '#5F5E5A']
export const TOP_COLORS = ['#FFFFFF', '#378ADD', '#D4537E', '#639922', '#EF9F27', '#2C2C2A', '#7F77DD']
export const BOTTOM_COLORS = ['#185FA5', '#2C2C2A', '#5F5E5A', '#712B13', '#3C3489']
export const HAIR_STYLES: HairStyle[] = ['short', 'long', 'buzz', 'curly']

export function defaultCharacter(): PoplurCharacter {
  return {
    gender: 'male',
    skinTone: SKIN_TONES[0],
    hairColor: HAIR_COLORS[0],
    hairStyle: 'short',
    eyeColor: EYE_COLORS[0],
    topColor: TOP_COLORS[0],
    bottomColor: BOTTOM_COLORS[0],
    updatedAt: 0,
  }
}

let cached: PoplurCharacter | null = null

export function readCharacter(): PoplurCharacter | null {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PoplurCharacter
    // A v1 record under the old key never reaches this parse; a malformed or
    // foreign object under the new key must not crash every render that asks.
    if (typeof parsed?.skinTone !== 'string' || typeof parsed?.gender !== 'string') return null
    cached = parsed
    return cached
  } catch { return null }
}

export function saveCharacter(character: PoplurCharacter): void {
  cached = character
  localStorage.setItem(STORAGE_KEY, JSON.stringify(character))
  window.dispatchEvent(new CustomEvent('poplur-character-changed', { detail: character }))
  if (isNativeShell()) {
    postNativeEvent({ type: 'characterUpdated' })
  }
}

export function clearCharacter(): void {
  cached = null
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('poplur-character-changed', { detail: null }))
}

export function hasCharacter(): boolean {
  return readCharacter() !== null
}

export function onCharacterChange(fn: () => void): () => void {
  const handler = () => fn()
  window.addEventListener('poplur-character-changed', handler)
  return () => window.removeEventListener('poplur-character-changed', handler)
}
