import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import MapRewardRollButton from '../MapRewardRollButton'
import {
  creditBalance,
  creditHistory,
  dailyMapRewardEntryId,
  grantDailyMapReward,
} from '../poplurCredits'
import {
  DAILY_RADIUS_ROLL_COOLDOWN_MS,
  LEGACY_RADIUS_REWARD_STORAGE_KEY,
  RADIUS_REWARD_STORAGE_KEY,
  RADIUS_REWARD_OUTCOMES,
  parseRadiusRewardClaim,
  previewCreditsAfterReward,
  radiusRewardAvailableAt,
  radiusRewardDayKey,
  selectRadiusRewardOutcome,
  serializeRadiusRewardClaim,
} from '../radiusRewardRoll'
import {
  RADIUS_REWARD_DICE_MODEL,
  RADIUS_REWARD_DICE_SPRITE,
  radiusRewardPreviewEnabled,
  readRadiusRewardDiceReadySignal,
  readRadiusRewardDiceRollSignal,
  readRadiusRewardNavigatorSignal,
} from '../radiusRewardNavigator'
import spritePrerender from '../spritePrerender.json'

describe('daily Radius reward roll', () => {
  it('maps the six equal faces deterministically and clamps malformed samples', () => {
    expect(RADIUS_REWARD_OUTCOMES.map(({ face }) => face)).toEqual([1, 2, 3, 4, 5, 6])
    expect(selectRadiusRewardOutcome(-1).face).toBe(1)
    expect(selectRadiusRewardOutcome(1 / 6).face).toBe(2)
    expect(selectRadiusRewardOutcome(0.999999).face).toBe(6)
    expect(selectRadiusRewardOutcome(Number.NaN).face).toBe(1)
  })

  it('keeps every outcome positive, transparent, and Credit-only', () => {
    for (const outcome of RADIUS_REWARD_OUTCOMES) {
      expect(outcome.credits).toBeGreaterThan(0)
      expect(outcome).not.toHaveProperty('radiusKm')
      expect(outcome).not.toHaveProperty('dominationPower')
      expect(outcome).not.toHaveProperty('ownerId')
    }
  })

  it('adds the reward without changing an invalid balance into debt', () => {
    const reward = RADIUS_REWARD_OUTCOMES[2]
    expect(previewCreditsAfterReward(42, reward)).toBe(52)
    expect(previewCreditsAfterReward(-100, reward)).toBe(10)
  })

  it('resets at the next UTC day boundary for the future server ledger', () => {
    const claimedAt = Date.UTC(2026, 7, 28, 23, 59, 30)
    expect(DAILY_RADIUS_ROLL_COOLDOWN_MS).toBe(86_400_000)
    expect(radiusRewardAvailableAt(claimedAt)).toBe(Date.UTC(2026, 7, 29))
    expect(radiusRewardDayKey(claimedAt)).toBe('2026-08-28')
  })

  it('persists one trusted table outcome across reloads for the same UTC day', () => {
    const now = Date.UTC(2026, 7, 28, 12)
    const reward = RADIUS_REWARD_OUTCOMES[4]
    const stored = serializeRadiusRewardClaim(reward, now)
    expect(RADIUS_REWARD_STORAGE_KEY).toBe('poplur.radius.reward.v1')
    expect(LEGACY_RADIUS_REWARD_STORAGE_KEY).toBe('poplur.radius.reward.preview.v1')
    expect(parseRadiusRewardClaim(stored, now)).toEqual(reward)
    expect(parseRadiusRewardClaim(stored, Date.UTC(2026, 7, 29))).toBeNull()
  })

  it('rejects malformed or tampered stored claims', () => {
    const now = Date.UTC(2026, 7, 28, 12)
    expect(parseRadiusRewardClaim(null, now)).toBeNull()
    expect(parseRadiusRewardClaim('{', now)).toBeNull()
    expect(parseRadiusRewardClaim(JSON.stringify({
      day: '2026-08-28',
      face: 9,
      credits: 999_999,
    }), now)).toBeNull()
    expect(parseRadiusRewardClaim(JSON.stringify({
      day: '2026-08-28',
      face: 3,
      claimedAtMs: Date.UTC(2026, 7, 27, 12),
    }), now)).toBeNull()
    expect(parseRadiusRewardClaim(JSON.stringify({
      day: '2026-08-28',
      face: 3,
    }), now)).toBeNull()
  })

  it('uses the baked Poplur dice sprite for the rail and the real model for the navigator', () => {
    expect(spritePrerender['poplur_dice_lite.glb|28|28|320']).toBe(
      RADIUS_REWARD_DICE_SPRITE,
    )
    expect(RADIUS_REWARD_DICE_MODEL).toBe('poplur_dice_lite.glb')
  })

  it('limits the reward side button to the interactive Radius preview route', () => {
    expect(radiusRewardPreviewEnabled('?view=map&radiusPreview=1')).toBe(true)
    expect(radiusRewardPreviewEnabled('?view=map')).toBe(false)
  })

  it('uses the approved reward dice control on the normal Map rail', () => {
    const onPress = vi.fn()
    const button = MapRewardRollButton({ active: false, onPress }) as unknown as {
      props: { onPointerDown: (event: { isPrimary: boolean; button: number }) => void }
    }
    button.props.onPointerDown({ isPrimary: true, button: 0 })
    expect(onPress).toHaveBeenCalledOnce()

    const markup = renderToStaticMarkup(button as never)
    expect(markup).toContain('data-map-reward-roll-button=""')
    expect(markup).toContain('aria-label="Open free Map reward roll"')
    expect(markup).toContain(RADIUS_REWARD_DICE_SPRITE)

    const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
    expect(home).not.toContain('MapRandomTourButton')
    expect(home).toMatch(/<MapDailyRewardController enabled=\{!RADIUS_REWARD_PREVIEW_ENABLED\}/)
    expect(home).toMatch(/<MapRewardRollButton[\s\S]*?announceRadiusRewardNavigator\(true\)/)
  })

  it('activates the reward dice on primary pointer-down without double-firing the pointer click', () => {
    const onPress = vi.fn()
    const button = MapRewardRollButton({ active: false, onPress }) as unknown as {
      props: {
        onPointerDown: (event: { isPrimary: boolean; button: number }) => void
        onClick: (event: { detail: number }) => void
      }
    }

    button.props.onPointerDown({ isPrimary: true, button: 2 })
    expect(onPress).not.toHaveBeenCalled()
    button.props.onPointerDown({ isPrimary: true, button: 0 })
    expect(onPress).toHaveBeenCalledOnce()
    button.props.onClick({ detail: 1 })
    expect(onPress).toHaveBeenCalledOnce()
    button.props.onClick({ detail: 0 })
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('grants a daily Map reward to the Credits ledger exactly once', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('CustomEvent', class {
      constructor(public type: string, public init?: unknown) {}
    })

    try {
      expect(dailyMapRewardEntryId('2026-08-30')).toBe('map-reward:2026-08-30')
      expect(grantDailyMapReward(10, '2026-08-30', 'Daily die')).toBe(true)
      expect(grantDailyMapReward(25, '2026-08-30', 'Repeated completion')).toBe(false)
      expect(creditBalance()).toBe(40)
      expect(creditHistory().filter(entry => entry.kind === 'map-reward')).toEqual([
        expect.objectContaining({ id: 'map-reward:2026-08-30', delta: 10 }),
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('dispatches the normal dice to the existing bounded random tour', () => {
    const mapApp = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    expect(mapApp).toMatch(/case 'randomTour':[\s\S]*?startRandomLandmarkTour\(\)/)
    expect(mapApp).toMatch(/const startRandomLandmarkTour[\s\S]*?startExplicitTourLoop\(0, undefined, order\)/)
    expect(clayMap).toContain('mapCamera.__startTour = startTour')
    expect(clayMap).toContain('const mapBaseSideControlCount = 10')
  })

  it('accepts only bounded navigator event shapes', () => {
    expect(readRadiusRewardNavigatorSignal({ active: true, changedAt: 42 })).toEqual({
      active: true,
      changedAt: 42,
    })
    expect(readRadiusRewardNavigatorSignal({ active: 'yes', changedAt: 42 })).toBeNull()
    expect(readRadiusRewardNavigatorSignal({ active: true, changedAt: Number.NaN })).toBeNull()
  })

  it('accepts only session-scoped ready and six-face roll signals', () => {
    expect(readRadiusRewardDiceReadySignal({ session: 42 })).toEqual({ session: 42 })
    expect(readRadiusRewardDiceReadySignal({ session: -1 })).toBeNull()
    expect(readRadiusRewardDiceReadySignal({ session: 1.5 })).toBeNull()

    expect(readRadiusRewardDiceRollSignal({ session: 42, pulse: 7, face: 6 })).toEqual({
      session: 42,
      pulse: 7,
      face: 6,
    })
    expect(readRadiusRewardDiceRollSignal({ session: 42, pulse: 7, face: 0 })).toBeNull()
    expect(readRadiusRewardDiceRollSignal({ session: 42, pulse: Number.NaN, face: 3 })).toBeNull()
    expect(readRadiusRewardDiceRollSignal({ session: '42', pulse: 7, face: 3 })).toBeNull()
  })
})
