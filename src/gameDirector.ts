import { authToken, requestAuthToken } from './nativeAuth'
import { isNativeShell } from './nativeBridge'
import { webAuth } from './webFirebase'

export type ShippedGameId = 'poplurgatchi' | 'arcade' | 'fps'
export type GameDifficulty = 'easy' | 'medium' | 'hard'

/**
 * The only AI-authored data gameplay is allowed to consume. The model directs
 * a session; local, reviewed code still owns physics, rewards, damage and save
 * data. Keeping this contract small means a surprising model response can
 * change today's mission without ever becoming executable game code.
 */
export interface GameDirectorSession {
  version: 1
  gameId: ShippedGameId
  day: string
  source: 'ai' | 'offline'
  title: string
  theme: string
  accentColor: string
  difficulty: GameDifficulty
  tempo: number
  powerUps: [string, string]
  rival: string
  specialMechanic: string
}

const DEFAULT_ENDPOINT = 'https://us-central1-poplur2025.cloudfunctions.net/poplurAiApi'
const REQUEST_TIMEOUT_MS = 8_000
const CACHE_VERSION = 1

const PROMPTS: Record<ShippedGameId, string> = {
  poplurgatchi:
    'Direct one daily session for a virtual-pet care game. Make specialMechanic a short care objective, enemyType a playful pet mood, and powerUps two tiny reward names. Keep it warm and actionable.',
  arcade:
    'Direct one daily session for Cinder Isles, a creature-collecting adventure. Make specialMechanic a short exploration or capture objective, enemyType a rival-trainer title, and powerUps two field rewards.',
  fps:
    'Direct one replayable mission for a three-level neon raycasting FPS. Make specialMechanic a short combat modifier, enemyType a hostile faction name, and powerUps two tactical bonuses. Keep it skill-based.',
}

const OFFLINE: Record<ShippedGameId, Array<Omit<GameDirectorSession, 'version' | 'gameId' | 'day' | 'source'>>> = {
  poplurgatchi: [
    { title: 'Bright Start', theme: 'Rainbow morning', accentColor: '#ff389e', difficulty: 'easy', tempo: 0.92, powerUps: ['Star Treat', 'Cozy Crown'], rival: 'Sleepy Sprout', specialMechanic: 'Complete three different care actions' },
    { title: 'Best-Friend Day', theme: 'Bubblegum garden', accentColor: '#b06cf0', difficulty: 'medium', tempo: 1, powerUps: ['Friendship Pin', 'Happy Spark'], rival: 'Mischief Mood', specialMechanic: 'Play together three times' },
    { title: 'Glow-Up Challenge', theme: 'Neon bedtime', accentColor: '#33ccff', difficulty: 'hard', tempo: 1.08, powerUps: ['Moon Snack', 'Dream Badge'], rival: 'Grumpy Cloud', specialMechanic: 'Keep every need above sixty' },
  ],
  arcade: [
    { title: 'Meadow Survey', theme: 'Sunlit Cinder meadow', accentColor: '#ffd84d', difficulty: 'easy', tempo: 0.94, powerUps: ['Scout Ball', 'Field Tonic'], rival: 'Ranger Vale', specialMechanic: 'Discover and catch one new creature' },
    { title: 'Rival Route', theme: 'Stormglass trail', accentColor: '#b06cf0', difficulty: 'medium', tempo: 1, powerUps: ['Type Charm', 'Swift Boots'], rival: 'Captain Vexa', specialMechanic: 'Win two encounters without fleeing' },
    { title: 'Cinder Mastery', theme: 'Ember-lit highlands', accentColor: '#ff6b4a', difficulty: 'hard', tempo: 1.08, powerUps: ['Rare Ball', 'Champion Crest'], rival: 'Warden Pyre', specialMechanic: 'Catch a creature after weakening it below half health' },
  ],
  fps: [
    { title: 'Arcade Sweep', theme: 'Electric pink arcade', accentColor: '#ff4db8', difficulty: 'easy', tempo: 0.9, powerUps: ['Armor Surge', 'Ammo Echo'], rival: 'Pixel Raiders', specialMechanic: 'Clear rooms while keeping armor intact' },
    { title: 'Neon Lockdown', theme: 'Cyan signal vault', accentColor: '#33ccff', difficulty: 'medium', tempo: 1, powerUps: ['Quick Reload', 'Score Chain'], rival: 'Signal Jackals', specialMechanic: 'Chain eliminations before the banner fades' },
    { title: 'Overlord Protocol', theme: 'Crimson tower breach', accentColor: '#ff5349', difficulty: 'hard', tempo: 1.12, powerUps: ['Glass Cannon', 'Boss Bounty'], rival: 'Chrome Legion', specialMechanic: 'Bosses hit harder but award a score bounty' },
  ],
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

export function offlineGameDirector(gameId: ShippedGameId, day = utcDay()): GameDirectorSession {
  const choices = OFFLINE[gameId]
  const choice = choices[hash(`${gameId}:${day}`) % choices.length]
  return { version: 1, gameId, day, source: 'offline', ...choice }
}

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : fallback
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : null
}

/** Revalidate cached/postMessage data instead of trusting a TypeScript cast. */
export function validateGameDirectorSession(
  gameId: ShippedGameId,
  raw: unknown,
  expectedDay?: string,
): GameDirectorSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || value.gameId !== gameId) return null
  if (typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return null
  if (expectedDay && value.day !== expectedDay) return null
  if (value.source !== 'ai' && value.source !== 'offline') return null
  if (value.difficulty !== 'easy' && value.difficulty !== 'medium' && value.difficulty !== 'hard') return null
  if (typeof value.tempo !== 'number' || !Number.isFinite(value.tempo) || value.tempo < 0.8 || value.tempo > 1.2) return null
  if (typeof value.accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.accentColor)) return null
  if (!Array.isArray(value.powerUps) || value.powerUps.length !== 2) return null

  const title = requiredText(value.title, 40)
  const theme = requiredText(value.theme, 70)
  const firstPowerUp = requiredText(value.powerUps[0], 28)
  const secondPowerUp = requiredText(value.powerUps[1], 28)
  const rival = requiredText(value.rival, 40)
  const specialMechanic = requiredText(value.specialMechanic, 110)
  if (!title || !theme || !firstPowerUp || !secondPowerUp || !rival || !specialMechanic) return null

  return {
    version: 1,
    gameId,
    day: value.day,
    source: value.source,
    title,
    theme,
    accentColor: value.accentColor.toLowerCase(),
    difficulty: value.difficulty,
    tempo: value.tempo,
    powerUps: [firstPowerUp, secondPowerUp],
    rival,
    specialMechanic,
  }
}

export function parseGameDirectorConfig(
  gameId: ShippedGameId,
  raw: unknown,
  day: string,
): GameDirectorSession | null {
  if (!raw || typeof raw !== 'object') return null
  const config = raw as Record<string, unknown>
  const fallback = offlineGameDirector(gameId, day)
  const difficulty: GameDifficulty = config.difficulty === 'easy' || config.difficulty === 'hard'
    ? config.difficulty
    : 'medium'
  const speed = typeof config.speed === 'number' && Number.isFinite(config.speed)
    ? Math.max(200, Math.min(380, config.speed))
    : 290
  const generatedPowerUps = Array.isArray(config.powerUps)
    ? config.powerUps.map(value => text(value, '', 28)).filter(Boolean).slice(0, 2)
    : []
  const accent = typeof config.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(config.accentColor)
    ? config.accentColor
    : fallback.accentColor

  return {
    version: 1,
    gameId,
    day,
    source: 'ai',
    title: text(config.gameName, fallback.title, 40),
    theme: text(config.theme, fallback.theme, 70),
    accentColor: accent,
    difficulty,
    tempo: Number((0.84 + ((speed - 200) / 180) * 0.36).toFixed(2)),
    powerUps: [
      generatedPowerUps[0] ?? fallback.powerUps[0],
      generatedPowerUps[1] ?? fallback.powerUps[1],
    ],
    rival: text(config.enemyType, fallback.rival, 40),
    specialMechanic: text(config.specialMechanic, fallback.specialMechanic, 110),
  }
}

function endpoint(): string {
  const configured = (import.meta.env.VITE_POPLUR_AI_ENDPOINT as string | undefined)?.replace(/\/+$/, '')
  if (!configured) return DEFAULT_ENDPOINT
  try {
    const url = new URL(configured)
    const localDevelopment = import.meta.env.DEV && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    return url.protocol === 'https:' || localDevelopment ? configured : DEFAULT_ENDPOINT
  } catch {
    return DEFAULT_ENDPOINT
  }
}

async function nativeToken(signal?: AbortSignal): Promise<string | null> {
  const existing = authToken()
  if (existing) return existing
  if (!isNativeShell()) return null
  requestAuthToken()
  return await new Promise(resolve => {
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('poplur-native-auth-token', onToken)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onToken = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string }>).detail
      finish(typeof detail?.token === 'string' && detail.token ? detail.token : null)
    }
    const onAbort = () => finish(null)
    const timer = window.setTimeout(() => finish(authToken()), 1_200)
    window.addEventListener('poplur-native-auth-token', onToken)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function firebaseIdToken(signal?: AbortSignal): Promise<string | null> {
  const fromNative = await nativeToken(signal)
  if (fromNative || signal?.aborted) return fromNative
  try {
    return await webAuth().currentUser?.getIdToken() ?? null
  } catch {
    return null
  }
}

function cacheKey(gameId: ShippedGameId, day: string): string {
  return `poplur.game-ai.v${CACHE_VERSION}.${gameId}.${day}`
}

function cached(gameId: ShippedGameId, day: string): GameDirectorSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(gameId, day)) ?? 'null') as unknown
    const saved = validateGameDirectorSession(gameId, value, day)
    return saved?.source === 'ai' ? saved : null
  } catch {
    return null
  }
}

function store(session: GameDirectorSession): void {
  try {
    window.localStorage.setItem(cacheKey(session.gameId, session.day), JSON.stringify(session))
  } catch { /* private browsing still gets the in-memory session */ }
}

/**
 * Ask Poplur's deployed, server-keyed Anthropic endpoint for one bounded daily
 * session. Authentication and model credentials never enter durable browser
 * storage. Failure is deliberately non-fatal: a reviewed daily preset keeps
 * the game playable offline and the next signed-in launch can try again.
 */
export async function loadGameDirector(
  gameId: ShippedGameId,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<GameDirectorSession> {
  const day = utcDay()
  if (!options.force) {
    const hit = cached(gameId, day)
    if (hit) return hit
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const token = await firebaseIdToken(controller.signal)
    if (!token || controller.signal.aborted) return offlineGameDirector(gameId, day)

    const response = await fetch(`${endpoint()}/games/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mode: 'maker', prompt: PROMPTS[gameId] }),
      signal: controller.signal,
    })
    if (!response.ok) return offlineGameDirector(gameId, day)
    const body = await response.json() as { config?: unknown }
    const session = parseGameDirectorConfig(gameId, body.config, day)
    if (!session) return offlineGameDirector(gameId, day)
    store(session)
    return session
  } catch {
    return offlineGameDirector(gameId, day)
  } finally {
    window.clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
