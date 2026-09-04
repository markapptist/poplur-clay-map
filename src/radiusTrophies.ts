// ── The radius high striker ──────────────────────────────────────────────────
//
// Selecting a pin turns the map's zoom rail into a radius measurement: the
// puck shoots up from the bottom and rings each trophy it passes on the way
// to the post's radius, the way a carnival high striker rings its bells. The
// tiers are the supplied clay trophies, bronze to diamond, and the top of the
// tower is the Earth's radius — the ceiling every other radius surface uses
// (see worldRadius.ts). Diamond is the whole world.
//
// The tower is logarithmic. Radius is earned in metres and topped out in
// thousands of kilometres, so a linear rail would put a 5 km pop at 0.08% and
// every real post in the bottom pixel. On a log rail the five tiers sit
// evenly spaced, one decade apart, and a pop's climb reads as progress
// rather than as rounding error.

import { EARTH_RADIUS_KM } from './worldRadius'

export type RadiusTrophyTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'

export interface RadiusTrophy {
  tier: RadiusTrophyTier
  name: string
  /** The radius (km) at which this trophy rings. */
  km: number
  /** Authoring GLB the pre-render pass bakes the knob sprite from. It lives
   *  under public/models/, which never ships to a phone; only the baked
   *  sprite does. */
  model: string
}

export const RADIUS_TROPHIES: readonly RadiusTrophy[] = [
  { tier: 'bronze',   name: 'Bronze',   km: 1,               model: 'models/poplur_trophy_bronze.glb' },
  { tier: 'silver',   name: 'Silver',   km: 10,              model: 'models/poplur_trophy_silver.glb' },
  { tier: 'gold',     name: 'Gold',     km: 100,             model: 'models/poplur_trophy_gold.glb' },
  { tier: 'platinum', name: 'Platinum', km: 1_000,           model: 'models/poplur_trophy_platinum.glb' },
  { tier: 'diamond',  name: 'Diamond',  km: EARTH_RADIUS_KM, model: 'models/poplur_trophy_diamond.glb' },
]

/** The sprite view every trophy is baked at. One view, so the knob swaps
 *  trophies without the lighting or the angle jumping between tiers. */
export const RADIUS_TROPHY_SPRITE_VIEW = { yaw: 20, pitch: 12, size: 256 } as const

/** Bottom of the tower: a tenth of a kilometre. Anything below reads as 0. */
const FLOOR_KM = 0.1
const FLOOR_LOG = Math.log10(FLOOR_KM)
const CEILING_LOG = Math.log10(EARTH_RADIUS_KM)

/** Where on the rail (0 = bottom, 1 = the top of the tower) a radius sits. */
export function radiusMeterLevel(radiusKm: number): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= FLOOR_KM) return 0
  const level = (Math.log10(radiusKm) - FLOOR_LOG) / (CEILING_LOG - FLOOR_LOG)
  return Math.max(0, Math.min(1, level))
}

/** The rail level at which a trophy rings. */
export function radiusTrophyLevel(trophy: RadiusTrophy): number {
  return radiusMeterLevel(trophy.km)
}

/** The highest trophy a radius has reached, or null below bronze. */
export function radiusTrophyFor(radiusKm: number): RadiusTrophy | null {
  let best: RadiusTrophy | null = null
  for (const trophy of RADIUS_TROPHIES) {
    if (radiusKm >= trophy.km) best = trophy
  }
  return best
}

/** Every trophy a climb from 0 to `radiusKm` rings, in order. */
export function radiusTrophiesRung(radiusKm: number): RadiusTrophy[] {
  return RADIUS_TROPHIES.filter(trophy => radiusKm >= trophy.km)
}

/** The money counter's easing: hard at the start, then a precise click onto
 *  the final amount rather than a coast past it. Shared with the counter so
 *  the number on the card and the puck on the rail arrive together. */
export function strikerEase(raw: number): number {
  const t = Math.max(0, Math.min(1, raw))
  return 1 - Math.pow(1 - t, 2.35)
}

export const STRIKER_MS = 880
