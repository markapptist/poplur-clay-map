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
  /** The metal, as one flat colour a label can be written in. Taken from the
   *  mid stop of the medal gradients the TV guide already strikes its top
   *  three in, so a radius label and a leaderboard medal are the same bronze.
   *  Platinum and diamond continue the run past them: a pale cool white, then
   *  the ice blue the map's radius label has always been written in — so the
   *  very top of the tower is where the old fixed colour turns out to have
   *  belonged all along. */
  color: string
}

export const RADIUS_TROPHIES: readonly RadiusTrophy[] = [
  { tier: 'bronze',   name: 'Bronze',   km: 1,               color: '#c87a3c', model: 'models/poplur_trophy_bronze.glb' },
  { tier: 'silver',   name: 'Silver',   km: 10,              color: '#c2cdd9', model: 'models/poplur_trophy_silver.glb' },
  { tier: 'gold',     name: 'Gold',     km: 100,             color: '#f0b429', model: 'models/poplur_trophy_gold.glb' },
  { tier: 'platinum', name: 'Platinum', km: 1_000,           color: '#e6f0ff', model: 'models/poplur_trophy_platinum.glb' },
  { tier: 'diamond',  name: 'Diamond',  km: EARTH_RADIUS_KM, color: '#7fe3ff', model: 'models/poplur_trophy_diamond.glb' },
]

/** The sprite view every trophy is baked at. One view, so the knob swaps
 *  trophies without the lighting or the angle jumping between tiers. */
export const RADIUS_TROPHY_SPRITE_VIEW = { yaw: 20, pitch: 12, size: 256 } as const

/** Bottom of the tower: a tenth of a kilometre. Anything below reads as 0. */
const FLOOR_KM = 0.1
const FLOOR_LOG = Math.log10(FLOOR_KM)
const CEILING_LOG = Math.log10(EARTH_RADIUS_KM)
/** The pure log rail put a one-kilometre pop a FIFTH of the way to the top of
 *  the world, which read as a lie on the meter ("0.6 mi should not reach that
 *  high"); a bias of 1.5 still put a 5 km pop a fifth of the way up, nearly
 *  on the silver rung ("5.0 km should not be that high if the world radius
 *  is 6,371", 5 Sep 2026). Biasing the log position keeps the decade trophies
 *  in order while pressing small radii toward the foot: bronze (1 km) rings
 *  at ~2%, 5 km sits at ~8%, silver (10 km) at ~12%, gold (100 km) at ~32%,
 *  platinum (1,000 km) at ~64%, and each decade is a visibly LONGER climb
 *  than the one before — the way a high striker gets harder near the bell. */
const METER_BIAS = 2.4

/** Where on the rail (0 = bottom, 1 = the top of the tower) a radius sits. */
export function radiusMeterLevel(radiusKm: number): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= FLOOR_KM) return 0
  const level = (Math.log10(radiusKm) - FLOOR_LOG) / (CEILING_LOG - FLOOR_LOG)
  return Math.pow(Math.max(0, Math.min(1, level)), METER_BIAS)
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

/**
 * What colour a radius is WRITTEN in: the highest trophy that radius has rung.
 *
 * A radius label is a statement about how much ground something holds, and
 * until now it said that in one fixed ice blue whatever the number was — the
 * colour of the top of the tower, worn by a 0.4 km pop. It now wears the metal
 * it has actually earned, so the label and the trophy on the striker rail
 * agree, and a radius climbing past a decade is visible as a change of metal
 * rather than only as a bigger number.
 *
 * BELOW BRONZE it is not silver-with-the-lights-off, it is YOUR COLOUR: a pop
 * too small to have rung anything is still yours, and the map already paints
 * your pins, your ground and your zoom rail in that one colour. `own` is that
 * colour — pass the viewer's takeover colour.
 */
export function radiusTrophyColor(radiusKm: number, own: string): string {
  if (!Number.isFinite(radiusKm)) return own
  return radiusTrophyFor(radiusKm)?.color ?? own
}
