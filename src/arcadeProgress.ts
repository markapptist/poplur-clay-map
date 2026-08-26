import type {
  ArenaSpec,
  BattleKind,
  ChampionSpec,
  GameSpec,
  TeamMemberSpec,
  TrainerSpec,
} from './battleRules'

export const ARCADE_PROGRESS_VERSION = 2 as const
export const ARCADE_PROGRESS_KEY = 'poplur.arcade.cinder-isles.progress.v2'
export const LEGACY_ARCADE_PROGRESS_KEY = 'poplur.arcade.cinder-isles.progress.v1'

export interface ArcadePartyMember {
  species: string
  level: number
  /** Experience held toward the next level. */
  xp: number
}

export interface ArcadeProgress {
  version: typeof ARCADE_PROGRESS_VERSION
  party: ArcadePartyMember[]
  /** Total successful catches by species, including creatures sent to storage. */
  captures: Record<string, number>
  balls: number
  tonics: number
  revives: number
  /** All won battles, used only as a career statistic and never as an unlock. */
  wins: number
  /** Unique authored trainers cleared. Replays cannot farm campaign rewards. */
  trainersDefeated: string[]
  /** Arena ids in campaign order. Each maps to one named badge in the spec. */
  badges: string[]
  championDefeated: boolean
  /** Re-derived from badges at every trust boundary. */
  zoneIndex: number
}

export interface ArcadeBattleOutcome {
  kind: 'won' | 'caught' | 'ran' | 'lost'
  battleKind: BattleKind
  opponentId: string
  wildSpecies: string
  wildLevel: number
  activePartyIndex: number
  ballsRemaining: number
  tonicsRemaining: number
  revivesRemaining: number
}

export interface CampaignChallenge {
  kind: Exclude<BattleKind, 'wild'>
  id: string
  displayName: string
  title: string
  team: TeamMemberSpec[]
  badgeName?: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const integer = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback

function defaultStarter(spec: GameSpec): ArcadePartyMember | null {
  const starter = spec.starters
    .map(species => spec.creatures.find(creature => creature.species === species))
    .find(Boolean) ?? spec.creatures[0]
  return starter ? { species: starter.species, level: 8, xp: 0 } : null
}

function arenasOf(spec: GameSpec): ArenaSpec[] {
  return Array.isArray(spec.arenas) ? spec.arenas : []
}

function championOf(spec: GameSpec): ChampionSpec | null {
  return spec.champion && typeof spec.champion.id === 'string' ? spec.champion : null
}

export function zoneIndexForBadges(badgeCount: number, zoneCount: number): number {
  if (zoneCount <= 0) return 0
  return Math.min(zoneCount - 1, Math.max(0, Math.floor(badgeCount)))
}

export function createArcadeProgress(spec: GameSpec): ArcadeProgress {
  const starter = defaultStarter(spec)
  return {
    version: ARCADE_PROGRESS_VERSION,
    party: starter ? [starter] : [],
    captures: {},
    balls: 15,
    tonics: 3,
    revives: 1,
    wins: 0,
    trainersDefeated: [],
    badges: [],
    championDefeated: false,
    zoneIndex: 0,
  }
}

function safeParty(value: Record<string, unknown>, spec: GameSpec): ArcadePartyMember[] {
  const fallback = createArcadeProgress(spec).party
  const species = new Set(spec.creatures.map(creature => creature.species))
  const maxParty = Math.max(1, Math.min(6, integer(spec.partySize, 1, 1, 6)))
  const party: ArcadePartyMember[] = []
  if (Array.isArray(value.party)) {
    for (const candidate of value.party) {
      if (!candidate || typeof candidate !== 'object') continue
      const member = candidate as Record<string, unknown>
      if (typeof member.species !== 'string' || !species.has(member.species)) continue
      party.push({
        species: member.species,
        level: integer(member.level, 1, 1, 100),
        xp: integer(member.xp, 0, 0, 1_000_000),
      })
      if (party.length >= maxParty) break
    }
  }
  return party.length ? party : fallback
}

function safeCaptures(value: Record<string, unknown>, spec: GameSpec): Record<string, number> {
  const species = new Set(spec.creatures.map(creature => creature.species))
  const captures: Record<string, number> = {}
  if (value.captures && typeof value.captures === 'object' && !Array.isArray(value.captures)) {
    for (const [caughtSpecies, count] of Object.entries(value.captures as Record<string, unknown>)) {
      if (!species.has(caughtSpecies)) continue
      const safeCount = integer(count, 0, 0, 999_999)
      if (safeCount > 0) captures[caughtSpecies] = safeCount
    }
  }
  return captures
}

function safeBadges(value: Record<string, unknown>, spec: GameSpec): string[] {
  const requested = new Set(Array.isArray(value.badges)
    ? value.badges.filter((badge): badge is string => typeof badge === 'string')
    : [])
  const badges: string[] = []
  // Badges must be a prefix. A hand-edited save cannot jump straight to the
  // final arena while omitting the earlier campaign.
  for (const arena of arenasOf(spec)) {
    if (!requested.has(arena.id)) break
    badges.push(arena.id)
  }
  return badges
}

function safeTrainerIds(value: Record<string, unknown>, spec: GameSpec, badges: string[]): string[] {
  const requested = new Set(Array.isArray(value.trainersDefeated)
    ? value.trainersDefeated.filter((id): id is string => typeof id === 'string')
    : [])
  const trainerIds: string[] = []
  const currentZoneIndex = zoneIndexForBadges(badges.length, spec.zones.length)
  spec.zones.slice(0, currentZoneIndex + 1).forEach((zone, zoneIndex) => {
    for (const trainer of zone.trainers ?? []) {
      // An earned badge proves the completed route. On the current route only
      // a contiguous trainer prefix is accepted, preventing a forged second
      // trainer from being used to skip the first.
      if (zoneIndex < badges.length || requested.has(trainer.id)) trainerIds.push(trainer.id)
      else break
    }
  })
  return trainerIds
}

/** Treat local storage as untrusted input. Unknown species, forged badge order
 * and impossible counters are discarded or clamped before gameplay. */
export function validateArcadeProgress(raw: unknown, spec: GameSpec): ArcadeProgress {
  const fallback = createArcadeProgress(spec)
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Record<string, unknown>
  if (value.version !== ARCADE_PROGRESS_VERSION) return fallback

  const badges = safeBadges(value, spec)
  const allBadgesEarned = badges.length === arenasOf(spec).length && badges.length > 0
  return {
    version: ARCADE_PROGRESS_VERSION,
    party: safeParty(value, spec),
    captures: safeCaptures(value, spec),
    balls: integer(value.balls, fallback.balls, 0, 999),
    tonics: integer(value.tonics, fallback.tonics, 0, 99),
    revives: integer(value.revives, fallback.revives, 0, 99),
    wins: integer(value.wins, 0, 0, 999_999),
    trainersDefeated: safeTrainerIds(value, spec, badges),
    badges,
    championDefeated: allBadgesEarned && value.championDefeated === true,
    zoneIndex: zoneIndexForBadges(badges.length, spec.zones.length),
  }
}

/** Migrate the previous two-route win counter without discarding a player's
 * party or captures. Every two legacy wins become one sequential arena clear;
 * a remaining win becomes the first trainer on the current route. */
export function migrateLegacyArcadeProgress(raw: unknown, spec: GameSpec): ArcadeProgress {
  if (!raw || typeof raw !== 'object') return createArcadeProgress(spec)
  const value = raw as Record<string, unknown>
  if (value.version === ARCADE_PROGRESS_VERSION) return validateArcadeProgress(value, spec)
  if (value.version !== 1) return createArcadeProgress(spec)

  const legacyWins = integer(value.wins, 0, 0, 999_999)
  const earnedCount = Math.min(arenasOf(spec).length, Math.floor(legacyWins / 2))
  const badges = arenasOf(spec).slice(0, earnedCount).map(arena => arena.id)
  const completedZoneIds = new Set(arenasOf(spec).slice(0, earnedCount).map(arena => arena.zoneId))
  const trainersDefeated = spec.zones
    .filter(zone => completedZoneIds.has(zone.id))
    .flatMap(zone => zone.trainers?.map(trainer => trainer.id) ?? [])
  const currentZone = spec.zones[zoneIndexForBadges(badges.length, spec.zones.length)]
  if (legacyWins % 2 === 1 && currentZone?.trainers?.[0]) trainersDefeated.push(currentZone.trainers[0].id)

  return validateArcadeProgress({
    ...value,
    version: ARCADE_PROGRESS_VERSION,
    badges,
    trainersDefeated,
    tonics: 3,
    revives: 1,
    championDefeated: false,
  }, spec)
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadArcadeProgress(spec: GameSpec, storage: StorageLike | null = browserStorage()): ArcadeProgress {
  if (!storage) return createArcadeProgress(spec)
  try {
    const current = storage.getItem(ARCADE_PROGRESS_KEY)
    const loaded = current
      ? migrateLegacyArcadeProgress(JSON.parse(current), spec)
      : migrateLegacyArcadeProgress(JSON.parse(storage.getItem(LEGACY_ARCADE_PROGRESS_KEY) ?? 'null'), spec)
    if (!current) storage.setItem(ARCADE_PROGRESS_KEY, JSON.stringify(loaded))
    return loaded
  } catch {
    return createArcadeProgress(spec)
  }
}

export function saveArcadeProgress(progress: ArcadeProgress, spec: GameSpec, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(ARCADE_PROGRESS_KEY, JSON.stringify(validateArcadeProgress(progress, spec)))
  } catch {
    // Private browsing or a full quota still gets the in-memory campaign.
  }
}

export function xpToNextLevel(level: number): number {
  return Math.max(20, Math.min(2_000, Math.floor(level) * 20))
}

export function grantArcadeXp(member: ArcadePartyMember, amount: number): ArcadePartyMember {
  let level = integer(member.level, 1, 1, 100)
  let xp = integer(member.xp, 0, 0, 1_000_000) + integer(amount, 0, 0, 1_000_000)
  while (level < 100 && xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level)
    level += 1
  }
  if (level >= 100) xp = 0
  return { ...member, level, xp }
}

/** Apply only evolutions declared by the shipped spec. A visited set makes a
 * malformed evolution cycle harmless, while the loop permits a large XP award
 * to cross more than one valid threshold. */
export function evolveArcadeMember(member: ArcadePartyMember, spec: GameSpec): ArcadePartyMember {
  let evolved = { ...member }
  const visited = new Set<string>()
  while (!visited.has(evolved.species)) {
    visited.add(evolved.species)
    const current = spec.creatures.find(creature => creature.species === evolved.species)
    if (!current || !current.evolvesInto || current.evolveLevel <= 0 || evolved.level < current.evolveLevel) break
    const target = spec.creatures.find(creature => creature.species === current.evolvesInto)
    if (!target || visited.has(target.species)) break
    evolved = { ...evolved, species: target.species }
  }
  return evolved
}

function trainerChallenge(trainer: TrainerSpec): CampaignChallenge {
  return { kind: 'trainer', id: trainer.id, displayName: trainer.displayName, title: trainer.title, team: trainer.team }
}

function arenaChallenge(arena: ArenaSpec): CampaignChallenge {
  return {
    kind: 'arena',
    id: arena.id,
    displayName: arena.leaderName,
    title: arena.leaderTitle,
    team: arena.team,
    badgeName: arena.badgeName,
  }
}

function championChallenge(champion: ChampionSpec): CampaignChallenge {
  return { kind: 'champion', id: champion.id, displayName: champion.displayName, title: champion.title, team: champion.team }
}

/** The one authoritative campaign gate: two authored route trainers, then its
 * arena, then the next island. After all eight badges it yields the champion. */
export function nextCampaignChallenge(progress: ArcadeProgress, spec: GameSpec): CampaignChallenge | null {
  const safe = validateArcadeProgress(progress, spec)
  const arenas = arenasOf(spec)
  if (safe.badges.length < arenas.length) {
    const arena = arenas[safe.badges.length]
    const zone = spec.zones.find(candidate => candidate.id === arena.zoneId)
    const nextTrainer = zone?.trainers?.find(trainer => !safe.trainersDefeated.includes(trainer.id))
    return nextTrainer ? trainerChallenge(nextTrainer) : arenaChallenge(arena)
  }
  const champion = championOf(spec)
  return champion && !safe.championDefeated ? championChallenge(champion) : null
}

export function applyArcadeBattleOutcome(
  current: ArcadeProgress,
  outcome: ArcadeBattleOutcome,
  spec: GameSpec,
): ArcadeProgress {
  const progress = validateArcadeProgress(current, spec)
  const next: ArcadeProgress = {
    ...progress,
    party: progress.party.map(member => ({ ...member })),
    captures: { ...progress.captures },
    trainersDefeated: [...progress.trainersDefeated],
    badges: [...progress.badges],
    balls: integer(outcome.ballsRemaining, progress.balls, 0, 999),
    tonics: integer(outcome.tonicsRemaining, progress.tonics, 0, 99),
    revives: integer(outcome.revivesRemaining, progress.revives, 0, 99),
  }

  if (outcome.kind === 'won') {
    const expected = nextCampaignChallenge(progress, spec)
    next.wins += 1
    const active = integer(outcome.activePartyIndex, 0, 0, Math.max(0, next.party.length - 1))
    if (next.party[active]) {
      const multiplier = outcome.battleKind === 'champion' ? 18 : outcome.battleKind === 'arena' ? 14 : 8
      const experienced = grantArcadeXp(next.party[active], Math.max(12, integer(outcome.wildLevel, 1, 1, 100) * multiplier))
      next.party[active] = evolveArcadeMember(experienced, spec)
    }

    // Campaign rewards only apply to the exact next authored challenge. A
    // stale battle result or forged post cannot skip a trainer or arena.
    if (expected && expected.kind === outcome.battleKind && expected.id === outcome.opponentId) {
      if (expected.kind === 'trainer') {
        next.trainersDefeated.push(expected.id)
        next.tonics = Math.min(99, next.tonics + 1)
      } else if (expected.kind === 'arena') {
        next.badges.push(expected.id)
        next.balls = Math.min(999, next.balls + 5)
        next.tonics = Math.min(99, next.tonics + 2)
        next.revives = Math.min(99, next.revives + 1)
      } else if (expected.kind === 'champion') {
        next.championDefeated = true
      }
    }
  }

  if (outcome.kind === 'caught' && outcome.battleKind === 'wild'
    && spec.creatures.some(creature => creature.species === outcome.wildSpecies)) {
    next.captures[outcome.wildSpecies] = (next.captures[outcome.wildSpecies] ?? 0) + 1
    const maxParty = Math.max(1, Math.min(6, integer(spec.partySize, 1, 1, 6)))
    if (next.party.length < maxParty) {
      next.party.push({ species: outcome.wildSpecies, level: integer(outcome.wildLevel, 1, 1, 100), xp: 0 })
    }
  }

  next.zoneIndex = zoneIndexForBadges(next.badges.length, spec.zones.length)
  return validateArcadeProgress(next, spec)
}

export function captureTotal(progress: ArcadeProgress): number {
  return Object.values(progress.captures).reduce((total, count) => total + count, 0)
}

export function earnedBadgeNames(progress: ArcadeProgress, spec: GameSpec): string[] {
  const earned = new Set(validateArcadeProgress(progress, spec).badges)
  return arenasOf(spec).filter(arena => earned.has(arena.id)).map(arena => arena.badgeName)
}

export function arcadeObjective(progress: ArcadeProgress, spec: GameSpec): string {
  const challenge = nextCampaignChallenge(progress, spec)
  if (!challenge) {
    return progress.championDefeated
      ? `Cinder Champion — ${spec.championName} defeated`
      : 'Explore the isles and build your team'
  }
  if (challenge.kind === 'trainer') return `Defeat ${challenge.title} ${challenge.displayName}`
  if (challenge.kind === 'arena') return `Challenge ${challenge.displayName} for the ${challenge.badgeName}`
  return `Challenge ${challenge.displayName} for the Cinder Crown`
}
