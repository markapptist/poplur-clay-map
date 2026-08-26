import { describe, expect, it } from 'vitest'
import cinderSpecData from '../../public/games/arcade/cinder-isles.json'
import {
  TYPE_CHART,
  TYPE_ART,
  makeBattleOpponent,
  makeMon,
  movesOf,
  rollEncounter,
  type BattleKind,
  type CreatureSpec,
  type GameSpec,
} from '../battleRules'
import {
  ARCADE_PROGRESS_KEY,
  LEGACY_ARCADE_PROGRESS_KEY,
  applyArcadeBattleOutcome,
  arcadeObjective,
  createArcadeProgress,
  earnedBadgeNames,
  loadArcadeProgress,
  migrateLegacyArcadeProgress,
  nextCampaignChallenge,
  validateArcadeProgress,
  type ArcadeBattleOutcome,
  type ArcadeProgress,
} from '../arcadeProgress'

const creatures: CreatureSpec[] = [
  {
    species: 'starter', displayName: 'Starter', type: 'ember',
    baseHp: 40, baseAttack: 40, baseDefense: 40, baseSpeed: 40,
    moves: [], rarity: 'common', catchRate: 50,
    evolvesInto: 'wild', evolveLevel: 9,
  },
  {
    species: 'wild', displayName: 'Wild', type: 'tide',
    baseHp: 40, baseAttack: 40, baseDefense: 40, baseSpeed: 40,
    moves: [], rarity: 'common', catchRate: 50,
    evolvesInto: '', evolveLevel: 0,
  },
]

const zones = Array.from({ length: 9 }, (_, index) => ({
  id: `zone_${index + 1}`,
  displayName: index === 8 ? 'Champion Summit' : `Route ${index + 1}`,
  encounters: ['wild'],
  levelMin: index * 5 + 2,
  levelMax: index * 5 + 4,
  trainers: index < 8 ? [0, 1].map(slot => ({
    id: `trainer_${index + 1}_${slot + 1}`,
    displayName: `Trainer ${index + 1}-${slot + 1}`,
    title: 'Islander',
    team: [{ species: 'wild', level: index * 5 + slot + 3 }],
  })) : [],
}))

const spec: GameSpec = {
  title: 'Test Isles', description: 'Test', rivalName: 'Rival', championName: 'Champion',
  partySize: 2, starters: ['starter'], moves: [], creatures, zones,
  arenas: Array.from({ length: 8 }, (_, index) => ({
    id: `arena_${index + 1}`,
    zoneId: `zone_${index + 1}`,
    leaderName: `Leader ${index + 1}`,
    leaderTitle: 'Arena Keeper',
    badgeName: `Badge ${index + 1}`,
    specialty: 'ember' as const,
    team: [{ species: 'starter', level: index * 5 + 5 }],
  })),
  champion: {
    id: 'champion', displayName: 'Champion', title: 'Cinder Champion',
    team: [{ species: 'starter', level: 55 }, { species: 'wild', level: 54 }],
  },
}

const shippedSpec = cinderSpecData as unknown as GameSpec

const outcome = (
  battleKind: BattleKind,
  opponentId: string,
  overrides: Partial<ArcadeBattleOutcome> = {},
): ArcadeBattleOutcome => ({
  kind: 'won',
  battleKind,
  opponentId,
  wildSpecies: 'wild',
  wildLevel: 5,
  activePartyIndex: 0,
  ballsRemaining: 15,
  tonicsRemaining: 3,
  revivesRemaining: 1,
  ...overrides,
})

describe('Cinder Isles authoritative campaign', () => {
  it('ships a complete original eight-badge campaign with a champion endgame', () => {
    const species = new Set(shippedSpec.creatures.map(creature => creature.species))
    const referenced = [
      ...shippedSpec.zones.flatMap(zone => [
        ...zone.encounters,
        ...(zone.trainers ?? []).flatMap(trainer => trainer.team.map(member => member.species)),
      ]),
      ...(shippedSpec.arenas ?? []).flatMap(arena => arena.team.map(member => member.species)),
      ...(shippedSpec.champion?.team ?? []).map(member => member.species),
    ]
    expect(shippedSpec.zones).toHaveLength(9)
    expect(shippedSpec.arenas).toHaveLength(8)
    expect(shippedSpec.zones.flatMap(zone => zone.trainers ?? [])).toHaveLength(16)
    expect(new Set((shippedSpec.arenas ?? []).map(arena => arena.badgeName)).size).toBe(8)
    expect(shippedSpec.champion?.team).toHaveLength(6)
    expect(referenced.every(member => species.has(member))).toBe(true)
  })

  it('keeps the beast matchup internally consistent', () => {
    expect(TYPE_CHART.beast.strong.filter(type => TYPE_CHART.beast.weak.includes(type))).toEqual([])
    expect(new Set(Object.values(TYPE_ART)).size).toBe(8)
    expect(Object.values(TYPE_ART).every(name => name.endsWith('_v2'))).toBe(true)
  })

  it('uses a reviewed fallback move and safely rejects malformed battles', () => {
    expect(movesOf(spec, makeMon(creatures[0], 8)).map(move => move.id)).toEqual(['struggle'])
    expect(rollEncounter(spec, { ...spec.zones[0], encounters: ['missing'] }, () => 0)).toBeNull()
    expect(rollEncounter(spec, spec.zones[0], () => 0)?.spec.species).toBe('wild')
    expect(makeBattleOpponent(spec, {
      id: 'bad', kind: 'trainer', displayName: 'Bad', title: 'Broken',
      team: [{ species: 'missing', level: 999 }],
    })).toBeNull()
    expect(makeBattleOpponent(spec, {
      id: 'safe', kind: 'trainer', displayName: 'Safe', title: 'Bounded',
      team: [{ species: 'wild', level: 999 }],
    })?.team[0].level).toBe(100)
  })

  it('validates inventory, badge order, trainer order and route derivation', () => {
    const loaded = validateArcadeProgress({
      version: 2,
      party: [{ species: 'missing', level: 999, xp: -4 }],
      captures: { wild: 2, missing: 80 },
      balls: -10,
      tonics: 1_000,
      revives: -4,
      wins: 3,
      badges: ['arena_1', 'arena_3'],
      trainersDefeated: ['trainer_2_2'],
      championDefeated: true,
      zoneIndex: 99,
    }, spec)

    expect(loaded.party).toEqual([{ species: 'starter', level: 8, xp: 0 }])
    expect(loaded.captures).toEqual({ wild: 2 })
    expect(loaded.balls).toBe(0)
    expect(loaded.tonics).toBe(99)
    expect(loaded.revives).toBe(0)
    expect(loaded.badges).toEqual(['arena_1'])
    expect(loaded.trainersDefeated).toEqual(['trainer_1_1', 'trainer_1_2'])
    expect(loaded.zoneIndex).toBe(1)
    expect(loaded.championDefeated).toBe(false)
    expect(nextCampaignChallenge(loaded, spec)?.id).toBe('trainer_2_1')
  })

  it('migrates v1 party/captures and writes a durable v2 save', () => {
    const legacy = {
      version: 1,
      party: [{ species: 'starter', level: 12, xp: 4 }],
      captures: { wild: 2 },
      balls: 7,
      wins: 3,
      zoneIndex: 1,
    }
    const migrated = migrateLegacyArcadeProgress(legacy, spec)
    expect(migrated.version).toBe(2)
    expect(migrated.badges).toEqual(['arena_1'])
    expect(migrated.trainersDefeated).toContain('trainer_2_1')
    expect(migrated.party[0]).toEqual({ species: 'starter', level: 12, xp: 4 })
    expect(migrated.captures).toEqual({ wild: 2 })

    const values = new Map([[LEGACY_ARCADE_PROGRESS_KEY, JSON.stringify(legacy)]])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    expect(loadArcadeProgress(spec, storage).version).toBe(2)
    expect(JSON.parse(values.get(ARCADE_PROGRESS_KEY) ?? '{}').version).toBe(2)
  })

  it('requires every trainer and awards all eight badges before the champion', () => {
    let progress = createArcadeProgress(spec)
    expect(nextCampaignChallenge(progress, spec)?.id).toBe('trainer_1_1')

    // A forged arena victory cannot jump the first trainer.
    progress = applyArcadeBattleOutcome(progress, outcome('arena', 'arena_1'), spec)
    expect(progress.badges).toEqual([])

    for (let route = 1; route <= 8; route += 1) {
      for (let trainer = 1; trainer <= 2; trainer += 1) {
        const id = `trainer_${route}_${trainer}`
        expect(nextCampaignChallenge(progress, spec)?.id).toBe(id)
        progress = applyArcadeBattleOutcome(progress, outcome('trainer', id, {
          ballsRemaining: progress.balls,
          tonicsRemaining: progress.tonics,
          revivesRemaining: progress.revives,
        }), spec)
      }
      expect(nextCampaignChallenge(progress, spec)?.id).toBe(`arena_${route}`)
      progress = applyArcadeBattleOutcome(progress, outcome('arena', `arena_${route}`, {
        ballsRemaining: progress.balls,
        tonicsRemaining: progress.tonics,
        revivesRemaining: progress.revives,
      }), spec)
      expect(progress.badges).toHaveLength(route)
      expect(progress.zoneIndex).toBe(route)
    }

    expect(earnedBadgeNames(progress, spec)).toEqual(Array.from({ length: 8 }, (_, index) => `Badge ${index + 1}`))
    expect(nextCampaignChallenge(progress, spec)?.id).toBe('champion')
    expect(arcadeObjective(progress, spec)).toContain('Cinder Crown')
    expect(progress.balls).toBe(55)
    expect(progress.tonics).toBe(35)
    expect(progress.revives).toBe(9)

    progress = applyArcadeBattleOutcome(progress, outcome('champion', 'champion', {
      ballsRemaining: progress.balls,
      tonicsRemaining: progress.tonics,
      revivesRemaining: progress.revives,
    }), spec)
    expect(progress.championDefeated).toBe(true)
    expect(nextCampaignChallenge(progress, spec)).toBeNull()
    expect(arcadeObjective(progress, spec)).toContain('Cinder Champion')
  })

  it('keeps wild training/captures useful without bypassing campaign gates', () => {
    const initial = createArcadeProgress(spec)
    const trained = applyArcadeBattleOutcome(initial, outcome('wild', 'wild:zone_1:wild', {
      wildLevel: 20,
    }), spec)
    expect(trained.party[0].level).toBe(9)
    expect(trained.party[0].species).toBe('wild')
    expect(nextCampaignChallenge(trained, spec)?.id).toBe('trainer_1_1')

    const caught = applyArcadeBattleOutcome(trained, outcome('wild', 'wild:zone_1:wild', {
      kind: 'caught',
      wildLevel: 5,
      ballsRemaining: 14,
    }), spec)
    expect(caught.captures).toEqual({ wild: 1 })
    expect(caught.party.map(member => member.species)).toEqual(['wild', 'wild'])
    expect(caught.balls).toBe(14)
    expect(nextCampaignChallenge(caught, spec)?.id).toBe('trainer_1_1')
  })

  it('never mutates the caller save while applying an outcome', () => {
    const progress: ArcadeProgress = createArcadeProgress(spec)
    const snapshot = JSON.stringify(progress)
    applyArcadeBattleOutcome(progress, outcome('trainer', 'trainer_1_1'), spec)
    expect(JSON.stringify(progress)).toBe(snapshot)
  })
})
