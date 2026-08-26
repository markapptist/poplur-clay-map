import {
  offlineGameDirector,
  validateGameDirectorSession,
  type GameDirectorSession,
  type GameDifficulty,
} from './gameDirector'

export const POPLURGATCHI_SAVE_VERSION = 2 as const
export const POPLURGATCHI_SAVE_KEY = `poplur.poplurgatchi.v${POPLURGATCHI_SAVE_VERSION}`
export const POPLURGATCHI_LEGACY_KEY = 'poplur.poplurgatchi.stats'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const MAX_ELAPSED_MS = 7 * DAY_MS
// One varied easy mission is enough to hatch the egg; later stages take
// several days, so growth is visible without becoming a tap-to-max counter.
const XP_PER_LEVEL = 40
const MAX_LEVEL = 20
const MAX_XP = XP_PER_LEVEL * MAX_LEVEL - 1

export type PetStat = 'food' | 'happiness' | 'energy' | 'clean' | 'health'
export type LifeStage = 'egg' | 'baby' | 'teen' | 'adult'
export type PetMood = 'SUPER HAPPY' | 'HAPPY' | 'OKAY' | 'NEEDS YOU' | 'CRITICAL'
export type CareActionId = 'feed' | 'love' | 'medicine' | 'rest' | 'bath' | 'snack' | 'play' | 'friend'
export type QuestKind = 'variety' | 'play' | 'balanced' | 'care'

export interface PetStats {
  food: number
  happiness: number
  energy: number
  clean: number
  health: number
}

export interface DailyActivity {
  day: string
  actionCounts: Record<CareActionId, number>
  questRewarded: boolean
  /** The first accepted action freezes this reviewed session for the day. */
  director: GameDirectorSession | null
}

export interface PoplurgatchiState {
  version: typeof POPLURGATCHI_SAVE_VERSION
  updatedAt: number
  stats: PetStats
  xp: number
  coins: number
  streak: number
  lastQuestDay: string | null
  cooldowns: Partial<Record<CareActionId, number>>
  daily: DailyActivity
}

export interface CareActionDefinition {
  id: CareActionId
  name: string
  prompt: string
  success: string
  primary: PetStat
  allowAtCap?: boolean
  minEnergy?: number
  cost: number
  xp: number
  cooldownMs: number
  effects: Partial<Record<PetStat, number>>
}

export interface DailyQuest {
  day: string
  kind: QuestKind
  label: string
  progress: number
  target: number
  completed: boolean
  rewardName: string
  rewardCoins: number
  rewardXp: number
}

export interface CareActionResult {
  state: PoplurgatchiState
  accepted: boolean
  message: string
  cooldownRemainingMs: number
  questCompleted: boolean
  levelUp: boolean
}

export const CARE_ACTIONS: readonly CareActionDefinition[] = [
  {
    id: 'feed', name: 'Feed', prompt: 'A proper meal restores food.', success: 'Meal finished',
    primary: 'food', cost: 2, xp: 8, cooldownMs: 6_000, effects: { food: 22, clean: -2 },
  },
  {
    id: 'love', name: 'Love', prompt: 'A little affection lifts happiness.', success: 'Cuddle delivered',
    primary: 'happiness', cost: 0, xp: 6, cooldownMs: 4_500, effects: { happiness: 18 },
  },
  {
    id: 'medicine', name: 'Medicine', prompt: 'Medicine restores health when it is needed.', success: 'Medicine taken',
    primary: 'health', cost: 3, xp: 9, cooldownMs: 8_000, effects: { health: 22, energy: -2 },
  },
  {
    id: 'rest', name: 'Rest', prompt: 'Rest restores energy but time still makes food fall.', success: 'Nap complete',
    primary: 'energy', cost: 0, xp: 7, cooldownMs: 7_000, effects: { energy: 24, food: -4 },
  },
  {
    id: 'bath', name: 'Bath', prompt: 'A bath restores cleanliness.', success: 'All clean',
    primary: 'clean', cost: 0, xp: 7, cooldownMs: 6_000, effects: { clean: 25, happiness: -2 },
  },
  {
    id: 'snack', name: 'Snack', prompt: 'A small treat helps food and happiness.', success: 'Snack enjoyed',
    primary: 'food', cost: 1, xp: 6, cooldownMs: 5_000, effects: { food: 10, happiness: 8, health: -1 },
  },
  {
    id: 'play', name: 'Play', prompt: 'Play builds happiness and spends food and energy.', success: 'Playtime complete',
    primary: 'happiness', allowAtCap: true, minEnergy: 12, cost: 0, xp: 10, cooldownMs: 6_000,
    effects: { happiness: 18, energy: -9, food: -4 },
  },
  {
    id: 'friend', name: 'Friend', prompt: 'Friend time lifts happiness and uses a little energy.', success: 'Friend visit complete',
    primary: 'happiness', cost: 0, xp: 8, cooldownMs: 5_500, effects: { happiness: 14, energy: -3 },
  },
] as const

const ACTION_BY_ID = new Map(CARE_ACTIONS.map(action => [action.id, action]))
const ACTION_IDS = CARE_ACTIONS.map(action => action.id)

const DEFAULT_STATS: PetStats = {
  food: 65,
  happiness: 70,
  energy: 68,
  clean: 62,
  health: 82,
}

function emptyCounts(): Record<CareActionId, number> {
  return {
    feed: 0,
    love: 0,
    medicine: 0,
    rest: 0,
    bath: 0,
    snack: 0,
    play: 0,
    friend: 0,
  }
}

function dayOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

function clampStat(value: number): number {
  return rounded(Math.max(0, Math.min(100, value)))
}

function readStats(value: unknown, fallback = DEFAULT_STATS): PetStats {
  const source = record(value)
  if (!source) return { ...fallback }
  return {
    food: finite(source.food, fallback.food, 0, 100),
    happiness: finite(source.happiness, fallback.happiness, 0, 100),
    energy: finite(source.energy, fallback.energy, 0, 100),
    clean: finite(source.clean, fallback.clean, 0, 100),
    health: finite(source.health, fallback.health, 0, 100),
  }
}

function newDaily(day: string): DailyActivity {
  return { day, actionCounts: emptyCounts(), questRewarded: false, director: null }
}

export function createPoplurgatchiState(now = Date.now(), day = new Date(now).toISOString().slice(0, 10)): PoplurgatchiState {
  return {
    version: POPLURGATCHI_SAVE_VERSION,
    updatedAt: now,
    stats: { ...DEFAULT_STATS },
    xp: 0,
    coins: 20,
    streak: 0,
    lastQuestDay: null,
    cooldowns: {},
    daily: newDaily(day),
  }
}

export function levelForXp(xp: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1))
}

export function xpIntoLevel(xp: number): number {
  return levelForXp(xp) >= MAX_LEVEL ? XP_PER_LEVEL : Math.max(0, Math.floor(xp) % XP_PER_LEVEL)
}

export function xpPerLevel(): number {
  return XP_PER_LEVEL
}

export function lifeStageForLevel(level: number): LifeStage {
  if (level <= 1) return 'egg'
  if (level <= 3) return 'baby'
  if (level <= 6) return 'teen'
  return 'adult'
}

export function moodForStats(stats: PetStats): PetMood {
  const values = Object.values(stats)
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const lowest = Math.min(...values)
  if (lowest <= 10 || average < 25) return 'CRITICAL'
  if (lowest <= 30 || average < 45) return 'NEEDS YOU'
  if (lowest <= 48 || average < 65) return 'OKAY'
  if (average < 85) return 'HAPPY'
  return 'SUPER HAPPY'
}

/** Apply bounded real-time decay. Local code remains the sole authority over needs. */
export function applyElapsedDecay(state: PoplurgatchiState, now = Date.now()): PoplurgatchiState {
  const safeNow = Number.isFinite(now) ? now : state.updatedAt
  const elapsedMs = Math.max(0, Math.min(MAX_ELAPSED_MS, safeNow - state.updatedAt))
  // Preserve sub-minute time instead of causing a storage write for every rapid tap.
  if (elapsedMs < 60_000) return state
  const hours = elapsedMs / HOUR_MS
  const food = clampStat(state.stats.food - hours * 2)
  const happiness = clampStat(state.stats.happiness - hours * 1.1)
  const energy = clampStat(state.stats.energy - hours * 0.75)
  const clean = clampStat(state.stats.clean - hours * 1.5)
  const neglectedNeeds = [food, energy, clean].filter(value => value < 35).length
  const health = clampStat(state.stats.health - hours * (0.15 + neglectedNeeds * 0.35))
  return {
    ...state,
    updatedAt: safeNow,
    stats: { food, happiness, energy, clean, health },
  }
}

export function preparePoplurgatchiDay(state: PoplurgatchiState, day: string): PoplurgatchiState {
  const safeDay = dayOrFallback(day, state.daily.day)
  return state.daily.day === safeDay ? state : { ...state, daily: newDaily(safeDay) }
}

function readDaily(value: unknown, day: string): DailyActivity {
  const source = record(value)
  if (!source || dayOrFallback(source.day, day) !== day) return newDaily(day)
  const savedCounts = record(source.actionCounts)
  const counts = emptyCounts()
  for (const id of ACTION_IDS) counts[id] = Math.floor(finite(savedCounts?.[id], 0, 0, 100))
  return {
    day,
    actionCounts: counts,
    questRewarded: source.questRewarded === true,
    director: validateGameDirectorSession('poplurgatchi', source.director, day),
  }
}

function readCooldowns(value: unknown, now: number): Partial<Record<CareActionId, number>> {
  const source = record(value)
  const result: Partial<Record<CareActionId, number>> = {}
  if (!source) return result
  for (const id of ACTION_IDS) {
    const until = finite(source[id], 0, 0, now + DAY_MS)
    if (until > now) result[id] = until
  }
  return result
}

function migrateLegacy(raw: string | null, now: number, day: string): PoplurgatchiState | null {
  if (!raw) return null
  try {
    const source = record(JSON.parse(raw) as unknown)
    if (!source) return null
    const fallback = createPoplurgatchiState(now, day)
    return {
      ...fallback,
      stats: {
        food: finite(source.hunger, fallback.stats.food, 0, 100),
        happiness: finite(source.happiness, fallback.stats.happiness, 0, 100),
        energy: finite(source.energy, fallback.stats.energy, 0, 100),
        clean: finite(source.clean, fallback.stats.clean, 0, 100),
        health: finite(source.health, fallback.stats.health, 0, 100),
      },
    }
  } catch {
    return null
  }
}

/** Parse, validate, migrate and decay persisted state without trusting its shape. */
export function restorePoplurgatchiState(
  raw: string | null,
  legacyRaw: string | null,
  now = Date.now(),
  day = new Date(now).toISOString().slice(0, 10),
): PoplurgatchiState {
  const safeDay = dayOrFallback(day, new Date(now).toISOString().slice(0, 10))
  if (!raw) return migrateLegacy(legacyRaw, now, safeDay) ?? createPoplurgatchiState(now, safeDay)
  try {
    const source = record(JSON.parse(raw) as unknown)
    if (!source || source.version !== POPLURGATCHI_SAVE_VERSION) {
      return migrateLegacy(legacyRaw, now, safeDay) ?? createPoplurgatchiState(now, safeDay)
    }
    const defaultState = createPoplurgatchiState(now, safeDay)
    const updatedAt = finite(source.updatedAt, now, 1, now + 5 * 60_000)
    const lastQuestDay = source.lastQuestDay === null
      ? null
      : dayOrFallback(source.lastQuestDay, '') || null
    const restored: PoplurgatchiState = {
      version: POPLURGATCHI_SAVE_VERSION,
      updatedAt: updatedAt > now ? now : updatedAt,
      stats: readStats(source.stats, defaultState.stats),
      xp: Math.floor(finite(source.xp, 0, 0, MAX_XP)),
      coins: Math.floor(finite(source.coins, defaultState.coins, 0, 999_999)),
      streak: Math.floor(finite(source.streak, 0, 0, 3_650)),
      lastQuestDay,
      cooldowns: readCooldowns(source.cooldowns, now),
      daily: readDaily(source.daily, safeDay),
    }
    return applyElapsedDecay(restored, now)
  } catch {
    return migrateLegacy(legacyRaw, now, safeDay) ?? createPoplurgatchiState(now, safeDay)
  }
}

function questRewards(difficulty: GameDifficulty): { coins: number; xp: number } {
  if (difficulty === 'hard') return { coins: 16, xp: 42 }
  if (difficulty === 'medium') return { coins: 12, xp: 32 }
  return { coins: 8, xp: 24 }
}

function questKind(director: GameDirectorSession): QuestKind {
  const objective = director.specialMechanic.toLowerCase()
  if (/\bplay\b/.test(objective)) return 'play'
  if (/above|every need|keep|sixty|healthy|well[- ]?being/.test(objective)) return 'balanced'
  if (/different|variety|three care|care actions/.test(objective)) return 'variety'
  return 'care'
}

function sessionForDailyQuest(director: GameDirectorSession, state: PoplurgatchiState): GameDirectorSession {
  return state.daily.director
    ?? validateGameDirectorSession('poplurgatchi', director, state.daily.day)
    ?? offlineGameDirector('poplurgatchi', state.daily.day)
}

export function dailyQuest(requestedDirector: GameDirectorSession, state: PoplurgatchiState): DailyQuest {
  // A late AI response may replace the prop while the pet is already being
  // cared for. Once an accepted action has frozen the day's session, both the
  // visible mission and its rewards remain attached to that same contract.
  const director = sessionForDailyQuest(requestedDirector, state)
  const kind = questKind(director)
  const totalActions = Object.values(state.daily.actionCounts).reduce((sum, value) => sum + value, 0)
  const targets: Record<GameDifficulty, number> = { easy: 3, medium: 4, hard: 5 }
  let target = targets[director.difficulty]
  let progress = totalActions
  if (kind === 'variety') {
    target = 3
    progress = Object.values(state.daily.actionCounts).filter(value => value > 0).length
  } else if (kind === 'play') {
    target = 3
    progress = state.daily.actionCounts.play
  } else if (kind === 'balanced') {
    target = 5
    progress = totalActions > 0 ? Object.values(state.stats).filter(value => value >= 60).length : 0
  }
  const rewards = questRewards(director.difficulty)
  const completed = state.daily.questRewarded || progress >= target
  return {
    day: director.day,
    kind,
    label: director.specialMechanic.trim() || 'Complete today\'s care mission',
    progress: state.daily.questRewarded ? target : Math.min(target, progress),
    target,
    completed,
    rewardName: director.powerUps[0],
    rewardCoins: rewards.coins,
    rewardXp: rewards.xp,
  }
}

function streakAfterCompletion(state: PoplurgatchiState, day: string): number {
  if (state.lastQuestDay === day) return state.streak
  if (!state.lastQuestDay) return 1
  const previous = Date.parse(`${state.lastQuestDay}T00:00:00Z`)
  const current = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(previous) && Number.isFinite(current) && current - previous === DAY_MS
    ? Math.max(1, state.streak + 1)
    : 1
}

function statLabel(stat: PetStat): string {
  return stat === 'food' ? 'FOOD' : stat.toUpperCase()
}

export function performCareAction(
  sourceState: PoplurgatchiState,
  actionId: CareActionId,
  director: GameDirectorSession,
  now = Date.now(),
): CareActionResult {
  const action = ACTION_BY_ID.get(actionId)
  let state = preparePoplurgatchiDay(applyElapsedDecay(sourceState, now), director.day)
  const activeDirector = sessionForDailyQuest(director, state)
  if (!action) {
    return { state, accepted: false, message: 'That care action is unavailable.', cooldownRemainingMs: 0, questCompleted: false, levelUp: false }
  }

  const remaining = Math.max(0, (state.cooldowns[action.id] ?? 0) - now)
  if (remaining > 0) {
    return {
      state,
      accepted: false,
      message: `${action.name} is recharging — ${Math.ceil(remaining / 1_000)}s left. Try another kind of care.`,
      cooldownRemainingMs: remaining,
      questCompleted: false,
      levelUp: false,
    }
  }
  if (!action.allowAtCap && state.stats[action.primary] >= 98) {
    return {
      state,
      accepted: false,
      message: `${statLabel(action.primary)} is already full — nothing was spent.`,
      cooldownRemainingMs: 0,
      questCompleted: false,
      levelUp: false,
    }
  }
  if (action.minEnergy && state.stats.energy < action.minEnergy) {
    return {
      state,
      accepted: false,
      message: `Too tired for ${action.name.toLowerCase()}. Rest first — nothing was spent.`,
      cooldownRemainingMs: 0,
      questCompleted: false,
      levelUp: false,
    }
  }
  if (state.coins < action.cost) {
    return {
      state,
      accepted: false,
      message: `${action.name} needs ${action.cost} coins; you have ${state.coins}. Nothing was spent.`,
      cooldownRemainingMs: 0,
      questCompleted: false,
      levelUp: false,
    }
  }

  const nextStats = { ...state.stats }
  const changes: string[] = []
  for (const [stat, amount] of Object.entries(action.effects) as Array<[PetStat, number]>) {
    const before = nextStats[stat]
    const after = clampStat(before + amount)
    const actual = rounded(after - before)
    nextStats[stat] = after
    if (actual !== 0) changes.push(`${statLabel(stat)} ${actual > 0 ? '+' : ''}${Math.round(actual)}`)
  }
  if (changes.length === 0) {
    return {
      state,
      accepted: false,
      message: `${action.name} would not change any need right now — nothing was spent.`,
      cooldownRemainingMs: 0,
      questCompleted: false,
      levelUp: false,
    }
  }

  const levelBefore = levelForXp(state.xp)
  const actionCounts = { ...state.daily.actionCounts, [action.id]: state.daily.actionCounts[action.id] + 1 }
  state = {
    ...state,
    updatedAt: now,
    stats: nextStats,
    xp: Math.min(MAX_XP, state.xp + action.xp),
    coins: state.coins - action.cost,
    cooldowns: { ...state.cooldowns, [action.id]: now + action.cooldownMs },
    // Every accepted care action is recorded in the daily quest ledger. Freeze
    // the session at that first mutation so a slower AI response cannot rename
    // an earned offline mission or change its reward underneath the player.
    daily: { ...state.daily, actionCounts, director: activeDirector },
  }

  const quest = dailyQuest(activeDirector, state)
  let questCompleted = false
  if (quest.completed && !state.daily.questRewarded) {
    questCompleted = true
    state = {
      ...state,
      xp: Math.min(MAX_XP, state.xp + quest.rewardXp),
      coins: state.coins + quest.rewardCoins,
      streak: streakAfterCompletion(state, activeDirector.day),
      lastQuestDay: activeDirector.day,
      daily: { ...state.daily, questRewarded: true },
    }
  }

  const levelAfter = levelForXp(state.xp)
  const levelUp = levelAfter > levelBefore
  const costText = action.cost > 0 ? ` · -${action.cost} coin${action.cost === 1 ? '' : 's'}` : ''
  const questText = questCompleted
    ? ` Mission complete: ${quest.rewardName} · +${quest.rewardCoins} coins · +${quest.rewardXp} XP.`
    : ''
  const levelText = levelUp
    ? ` Level up — ${lifeStageForLevel(levelAfter).toUpperCase()}!`
    : ''
  return {
    state,
    accepted: true,
    message: `${action.success}: ${changes.join(' · ')}${costText}.${questText}${levelText}`,
    cooldownRemainingMs: action.cooldownMs,
    questCompleted,
    levelUp,
  }
}
