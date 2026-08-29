import { describe, expect, it } from 'vitest'
import {
  DAILY_RADIUS_ROLL_COOLDOWN_MS,
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
    expect(RADIUS_REWARD_STORAGE_KEY).toContain('preview')
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
