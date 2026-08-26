import { describe, expect, it } from 'vitest'
import {
  offlineGameDirector,
  parseGameDirectorConfig,
  validateGameDirectorSession,
} from '../gameDirector'

describe('game director contract', () => {
  it('selects a stable reviewed offline session for a game and day', () => {
    const first = offlineGameDirector('arcade', '2026-08-26')
    const second = offlineGameDirector('arcade', '2026-08-26')

    expect(second).toEqual(first)
    expect(first.source).toBe('offline')
    expect(first.gameId).toBe('arcade')
    expect(first.specialMechanic.length).toBeGreaterThan(10)
  })

  it('bounds and sanitizes model-authored fields before gameplay sees them', () => {
    const parsed = parseGameDirectorConfig('fps', {
      gameName: '  Neon   Run  ',
      theme: 'Signal vault',
      accentColor: 'javascript:red',
      difficulty: 'impossible',
      speed: 99_999,
      powerUps: ['A'.repeat(80), '', 'ignored third'],
      enemyType: 'Chrome Legion',
      specialMechanic: 'Chain eliminations',
    }, '2026-08-26')

    expect(parsed).not.toBeNull()
    expect(parsed?.title).toBe('Neon Run')
    expect(parsed?.accentColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(parsed?.difficulty).toBe('medium')
    expect(parsed?.tempo).toBe(1.2)
    expect(parsed?.powerUps).toHaveLength(2)
    expect(parsed?.powerUps[0]).toHaveLength(28)
  })

  it('rejects non-object provider output', () => {
    expect(parseGameDirectorConfig('poplurgatchi', 'not json', '2026-08-26')).toBeNull()
  })

  it('rejects a poisoned cached session before gameplay can read it', () => {
    const valid = offlineGameDirector('poplurgatchi', '2026-08-26')
    expect(validateGameDirectorSession('poplurgatchi', { ...valid, source: 'ai' }, valid.day)).not.toBeNull()
    expect(validateGameDirectorSession('poplurgatchi', {
      ...valid,
      source: 'ai',
      specialMechanic: null,
    }, valid.day)).toBeNull()
    expect(validateGameDirectorSession('poplurgatchi', {
      ...valid,
      source: 'ai',
      gameId: 'fps',
    }, valid.day)).toBeNull()
  })
})
