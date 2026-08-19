/**
 * The battle simulation, with no rendering in it.
 *
 * Kept separate from the canvas so the rules can be reasoned about — and later
 * tested — without a drawing surface. The renderer asks this for state and
 * never computes an outcome itself.
 */

export type CreatureType =
  | 'ember' | 'tide' | 'bloom' | 'spark' | 'stone' | 'gale' | 'shade' | 'beast'

/** Hand-written, matching the generator's chart: each type beats two, loses to two. */
export const TYPE_CHART: Record<CreatureType, { strong: CreatureType[]; weak: CreatureType[] }> = {
  ember: { strong: ['bloom', 'gale'],   weak: ['tide', 'stone'] },
  tide:  { strong: ['ember', 'stone'],  weak: ['bloom', 'spark'] },
  bloom: { strong: ['tide', 'stone'],   weak: ['ember', 'gale'] },
  spark: { strong: ['tide', 'gale'],    weak: ['stone', 'bloom'] },
  stone: { strong: ['ember', 'spark'],  weak: ['tide', 'bloom'] },
  gale:  { strong: ['bloom', 'beast'],  weak: ['ember', 'spark'] },
  shade: { strong: ['beast', 'spark'],  weak: ['gale', 'ember'] },
  beast: { strong: ['shade', 'stone'],  weak: ['gale', 'shade'] },
}

/** Each element is drawn by the creature on Poplur's sheet that already looks
 *  like it: the rock golem is stone, the cloud is gale, the bat is shade. The
 *  art tells a player the matchup before the type name does. */
/** The effect sprite a move of each element throws. */
export const TYPE_FX: Record<CreatureType, string> = {
  ember: 'fire_burst',
  tide:  'water_orb_large',
  bloom: 'leaf_slash',
  spark: 'electric_dash',
  stone: 'ice_shard',
  gale:  'psychic_ring',
  shade: 'shadow_swipe',
  beast: 'fairy_flare',
}

export const TYPE_ART: Record<CreatureType, string> = {
  ember: 'galaxy_slug',    // fire and stars
  tide:  'blue_elephant',
  bloom: 'leaf_fox',
  spark: 'golden_bunny',
  stone: 'lava_golem',     // a rock brute
  gale:  'cloud_sheep',
  shade: 'shadow_bat',
  beast: 'pink_cat',
}

export interface MoveSpec {
  id: string; displayName: string; type: CreatureType
  power: number; accuracy: number; effect: string
}
export interface CreatureSpec {
  species: string; displayName: string; type: CreatureType
  baseHp: number; baseAttack: number; baseDefense: number; baseSpeed: number
  moves: string[]; rarity: string; catchRate: number
  evolvesInto: string; evolveLevel: number
}
export interface ZoneSpec {
  id: string; displayName: string; encounters: string[]; levelMin: number; levelMax: number
}
export interface GameSpec {
  title: string; description: string; rivalName: string; championName: string
  partySize: number; starters: string[]
  moves: MoveSpec[]; creatures: CreatureSpec[]; zones: ZoneSpec[]
}

export interface Mon {
  spec: CreatureSpec
  level: number
  hp: number
  maxHp: number
}

export function makeMon(spec: CreatureSpec, level: number): Mon {
  const maxHp = spec.baseHp + level * 2
  return { spec, level, hp: maxHp, maxHp }
}

const attackOf = (m: Mon) => m.spec.baseAttack + m.level
const defenceOf = (m: Mon) => m.spec.baseDefense + m.level

export interface HitResult {
  damage: number
  missed: boolean
  effectiveness: 'super' | 'weak' | 'neutral'
}

/**
 * One attack. The shape is the classic level/power/attack-over-defence curve —
 * familiar enough that a player's instincts about type advantage transfer.
 */
export function resolveHit(attacker: Mon, defender: Mon, move: MoveSpec, roll = Math.random): HitResult {
  const chart = TYPE_CHART[move.type]
  const effectiveness: HitResult['effectiveness'] =
    chart.strong.includes(defender.spec.type) ? 'super'
      : chart.weak.includes(defender.spec.type) ? 'weak' : 'neutral'

  if (roll() * 100 >= move.accuracy) return { damage: 0, missed: true, effectiveness }
  if (move.power === 0) return { damage: 0, missed: false, effectiveness }

  let dmg = Math.floor(
    ((2 * attacker.level / 5 + 2) * move.power * attackOf(attacker)) / Math.max(1, defenceOf(defender)) / 50,
  ) + 2
  if (effectiveness === 'super') dmg *= 2
  if (effectiveness === 'weak') dmg = Math.floor(dmg / 2)
  // Same-type bonus, then a little variance so identical turns are not identical.
  if (move.type === attacker.spec.type) dmg = Math.floor(dmg * 1.5)
  dmg = Math.floor(dmg * (0.9 + roll() * 0.2))
  return { damage: Math.max(1, dmg), missed: false, effectiveness }
}

/** Weaker and rarer creatures are harder; a hurt one is easier. */
export function catchOdds(wild: Mon): number {
  return Math.min(95, wild.spec.catchRate + ((wild.maxHp - wild.hp) / wild.maxHp) * 60)
}

export function movesOf(spec: GameSpec, mon: Mon): MoveSpec[] {
  return mon.spec.moves
    .map(id => spec.moves.find(m => m.id === id))
    .filter((m): m is MoveSpec => !!m)
}

export function rollEncounter(spec: GameSpec, zone: ZoneSpec, roll = Math.random): Mon {
  const species = zone.encounters[Math.floor(roll() * zone.encounters.length)]
  const found = spec.creatures.find(c => c.species === species)!
  const level = zone.levelMin + Math.floor(roll() * (zone.levelMax - zone.levelMin + 1))
  return makeMon(found, level)
}
