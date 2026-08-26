import { describe, expect, it } from 'vitest'
import type { GameDirectorSession } from '../gameDirector'
import {
  POPLURGATCHI_SAVE_VERSION,
  applyElapsedDecay,
  createPoplurgatchiState,
  dailyQuest,
  lifeStageForLevel,
  levelForXp,
  moodForStats,
  performCareAction,
  preparePoplurgatchiDay,
  restorePoplurgatchiState,
} from '../poplurgatchiState'

const NOW = Date.UTC(2026, 7, 25, 16)
const DAY = '2026-08-25'

function director(overrides: Partial<GameDirectorSession> = {}): GameDirectorSession {
  return {
    version: 1,
    gameId: 'poplurgatchi',
    day: DAY,
    source: 'offline',
    title: 'Bright Start',
    theme: 'Rainbow morning',
    accentColor: '#ff389e',
    difficulty: 'easy',
    tempo: 0.92,
    powerUps: ['Star Treat', 'Cozy Crown'],
    rival: 'Sleepy Sprout',
    specialMechanic: 'Complete three different care actions',
    ...overrides,
  }
}

describe('Poplurgatchi state', () => {
  it('validates every persisted field and ignores unknown data', () => {
    const raw = JSON.stringify({
      version: POPLURGATCHI_SAVE_VERSION,
      updatedAt: NOW,
      stats: { food: 'full', happiness: 400, energy: -20, clean: 55, health: 75, cheat: 9_999 },
      xp: -4,
      coins: 'many',
      streak: 9_999,
      lastQuestDay: 'not-a-day',
      cooldowns: { play: NOW + 2_000, madeUp: NOW + 5_000 },
      daily: {
        day: DAY,
        actionCounts: { play: 500, madeUp: 30 },
        questRewarded: 'yes',
      },
      executable: 'never trusted',
    })

    const state = restorePoplurgatchiState(raw, null, NOW, DAY)

    expect(state.version).toBe(2)
    expect(state.stats).toEqual({ food: 65, happiness: 100, energy: 0, clean: 55, health: 75 })
    expect(state.xp).toBe(0)
    expect(state.coins).toBe(20)
    expect(state.streak).toBe(3_650)
    expect(state.lastQuestDay).toBeNull()
    expect(state.cooldowns).toEqual({ play: NOW + 2_000 })
    expect(state.daily.actionCounts.play).toBe(100)
    expect(state.daily.questRewarded).toBe(false)
    expect(Object.keys(state.stats)).not.toContain('cheat')
  })

  it('applies bounded elapsed-time decay and exposes genuinely low moods', () => {
    const source = createPoplurgatchiState(NOW - 24 * 60 * 60 * 1_000, DAY)
    const decayed = applyElapsedDecay(source, NOW)

    expect(decayed.stats.food).toBe(17)
    expect(decayed.stats.happiness).toBe(43.6)
    expect(decayed.stats.energy).toBe(50)
    expect(decayed.stats.clean).toBe(26)
    expect(decayed.stats.health).toBe(61.6)
    expect(moodForStats(decayed.stats)).toBe('NEEDS YOU')
    expect(decayed.updatedAt).toBe(NOW)
  })

  it('enforces cooldowns without counting or rewarding spam', () => {
    const mission = director({ specialMechanic: 'Play together three times' })
    const first = performCareAction(createPoplurgatchiState(NOW, DAY), 'play', mission, NOW)
    const spam = performCareAction(first.state, 'play', mission, NOW + 500)

    expect(first.accepted).toBe(true)
    expect(first.state.daily.actionCounts.play).toBe(1)
    expect(spam.accepted).toBe(false)
    expect(spam.message).toContain('recharging')
    expect(spam.state.daily.actionCounts.play).toBe(1)
    expect(dailyQuest(mission, spam.state).progress).toBe(1)

    const second = performCareAction(spam.state, 'play', mission, NOW + 6_001)
    expect(second.accepted).toBe(true)
    expect(second.state.daily.actionCounts.play).toBe(2)
  })

  it('completes a director-derived quest once and turns XP into growth', () => {
    const mission = director()
    const start = createPoplurgatchiState(NOW, DAY)
    const fed = performCareAction(start, 'feed', mission, NOW)
    const loved = performCareAction(fed.state, 'love', mission, NOW + 1)
    const healed = performCareAction(loved.state, 'medicine', mission, NOW + 2)

    expect(healed.accepted).toBe(true)
    expect(healed.questCompleted).toBe(true)
    expect(healed.state.daily.questRewarded).toBe(true)
    expect(healed.state.streak).toBe(1)
    expect(healed.state.coins).toBe(23)
    expect(levelForXp(healed.state.xp)).toBe(2)
    expect(lifeStageForLevel(levelForXp(healed.state.xp))).toBe('baby')
    expect(healed.message).toContain('Mission complete')

    const bathed = performCareAction(healed.state, 'bath', mission, NOW + 3)
    expect(bathed.questCompleted).toBe(false)
    expect(bathed.state.coins).toBe(23)
    expect(bathed.state.streak).toBe(1)
  })

  it('persists the first accepted mission and defers a late AI director until the next day', () => {
    const reviewed = director()
    const first = performCareAction(createPoplurgatchiState(NOW, DAY), 'feed', reviewed, NOW)
    expect(first.accepted).toBe(true)
    expect(first.state.daily.director).toEqual(reviewed)

    const lateAi = director({
      source: 'ai',
      title: 'Late Night Switch',
      difficulty: 'hard',
      powerUps: ['Late Prize', 'Late Spark'],
      specialMechanic: 'Play together three times',
    })
    const restored = restorePoplurgatchiState(JSON.stringify(first.state), null, NOW + 1, DAY)
    expect(restored.daily.director).toEqual(reviewed)
    expect(dailyQuest(lateAi, restored)).toMatchObject({
      kind: 'variety',
      label: reviewed.specialMechanic,
      rewardName: reviewed.powerUps[0],
    })

    const loved = performCareAction(restored, 'love', lateAi, NOW + 1)
    const healed = performCareAction(loved.state, 'medicine', lateAi, NOW + 2)
    expect(healed.questCompleted).toBe(true)
    expect(healed.message).toContain(reviewed.powerUps[0])
    expect(healed.message).not.toContain(lateAi.powerUps[0])

    const nextDay = '2026-08-26'
    const nextDirector = director({ ...lateAi, day: nextDay })
    const advanced = preparePoplurgatchiDay(healed.state, nextDay)
    expect(advanced.daily.director).toBeNull()
    expect(dailyQuest(nextDirector, advanced)).toMatchObject({
      kind: 'play',
      label: lateAi.specialMechanic,
      rewardName: lateAi.powerUps[0],
    })
  })

  it('migrates the old stats-only save into the versioned format', () => {
    const legacy = JSON.stringify({ hunger: 44, happiness: 33, energy: 22, clean: 11, health: 55, extra: 1_000 })
    const state = restorePoplurgatchiState(null, legacy, NOW, DAY)

    expect(state.version).toBe(2)
    expect(state.stats).toEqual({ food: 44, happiness: 33, energy: 22, clean: 11, health: 55 })
    expect(state.daily.day).toBe(DAY)
    expect(state.xp).toBe(0)
  })
})
