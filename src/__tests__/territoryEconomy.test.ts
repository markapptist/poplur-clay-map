import { describe, expect, it } from 'vitest'
import {
  PREVIEW_COORDINATE_OWNER_RANKS,
  createPreviewTerritoryEconomy,
  earnedTerritoryBuildingLevel,
  purchaseAndEquipTerritoryTheme,
  rankCoordinateOwners,
  recordPreviewHostedPost,
  recordPreviewTerritoryUpkeep,
  recordPreviewTerritoryVisit,
  territoryStateAfterExpiry,
} from '../territoryEconomy'

describe('territory economy preview', () => {
  it('ranks each coordinate deterministically and gives rank one the largest compounding share', () => {
    const ranks = rankCoordinateOwners([
      { ownerId: 'challenger', ownerLabel: 'CHALLENGER', ownerColor: '#0af', radiusKm: 4, dominationPower: 80 },
      { ownerId: 'incumbent', ownerLabel: 'INCUMBENT', ownerColor: '#f08', radiusKm: 3, dominationPower: 80, incumbent: true },
      { ownerId: 'third', ownerLabel: 'THIRD', ownerColor: '#fa0', radiusKm: 5, dominationPower: 70 },
    ])

    expect(ranks.map(({ ownerId }) => ownerId)).toEqual(['incumbent', 'challenger', 'third'])
    expect(ranks.map(({ feedMultiplier }) => feedMultiplier)).toEqual([3, 1.8, 1.2])
    expect(ranks.map(({ postRadiusYieldKm }) => postRadiusYieldKm)).toEqual([0.08, 0.03, 0.01])
    expect(ranks.filter(({ ownsCoordinate }) => ownsCoordinate)).toHaveLength(1)
  })

  it('earns Credits from verified walk-ins without changing Radius or domination', () => {
    const before = createPreviewTerritoryEconomy()
    const result = recordPreviewTerritoryVisit(before)

    expect(result.changed).toBe(true)
    expect(result.state.demoCredits).toBe(before.demoCredits + 1)
    expect(result.state.qualifiedVisitsToday).toBe(before.qualifiedVisitsToday + 1)
    expect(result.state.radiusKm).toBe(before.radiusKm)
    expect(result.state.dominationPower).toBe(before.dominationPower)
    expect(result.message).toContain('3× owner-video priority')
  })

  it('compounds Radius when another user posts inside the held coordinate', () => {
    const before = createPreviewTerritoryEconomy()
    const result = recordPreviewHostedPost(before)

    expect(result.changed).toBe(true)
    expect(result.state.radiusKm).toBeCloseTo(before.radiusKm + PREVIEW_COORDINATE_OWNER_RANKS[0].postRadiusYieldKm)
    expect(result.state.dominationPower).toBe(before.dominationPower)
    expect(result.state.postsHostedToday).toBe(before.postsHostedToday + 1)
    expect(result.state.demoCredits).toBe(before.demoCredits)
    expect(result.state.coordinateOwnerRanks.map(({ radiusKm }) => radiusKm)).toEqual([
      2.78,
      3.13,
      2.41,
    ])
    expect(result.state.coordinateOwnerRanks.map(({ dominationPower }) => dominationPower)).toEqual([
      88,
      81,
      74,
    ])
    expect(result.message).toContain('#1 +0.08 km, #2 +0.03 km, #3 +0.01 km')
  })

  it('uses Credits for cosmetic themes without buying domination power', () => {
    const before = createPreviewTerritoryEconomy()
    const result = purchaseAndEquipTerritoryTheme(before, 'nightclub')

    expect(result.changed).toBe(true)
    expect(result.state.demoCredits).toBe(before.demoCredits - 15)
    expect(result.state.equippedThemeId).toBe('nightclub')
    expect(result.state.radiusKm).toBe(before.radiusKm)
    expect(result.state.dominationPower).toBe(before.dominationPower)
    expect(result.state.ownerId).toBe(before.ownerId)

    const repeated = purchaseAndEquipTerritoryTheme(result.state, 'nightclub')
    expect(repeated.changed).toBe(false)
    expect(repeated.state.demoCredits).toBe(result.state.demoCredits)
  })

  it('caps passive ownership payouts and hosted-post dividends per day', () => {
    const base = createPreviewTerritoryEconomy()
    const visitCapped = { ...base, qualifiedVisitsToday: base.dailyOwnershipCreditCap }
    const postCapped = { ...base, postsHostedToday: base.dailyHostedPostCap }

    expect(recordPreviewTerritoryVisit(visitCapped).changed).toBe(false)
    expect(recordPreviewHostedPost(postCapped).changed).toBe(false)
  })

  it('earns property levels through upkeep and fades expired territory before neutralizing it', () => {
    expect(earnedTerritoryBuildingLevel(1, 100)).toBe(0)
    expect(earnedTerritoryBuildingLevel(2, 0)).toBe(1)
    expect(earnedTerritoryBuildingLevel(5, 15)).toBe(2)
    expect(earnedTerritoryBuildingLevel(10, 50)).toBe(3)

    const base = createPreviewTerritoryEconomy()
    const maintained = recordPreviewTerritoryUpkeep(base, 7)
    expect(maintained.state.buildingLevel).toBe(1)
    expect(maintained.state.demoCredits).toBe(base.demoCredits)

    const fading = territoryStateAfterExpiry(maintained.state, 12)
    const neutral = territoryStateAfterExpiry(maintained.state, 24)
    expect(fading.status).toBe('fading')
    expect(neutral.status).toBe('neutral')
    expect(neutral.radiusKm).toBe(0)
  })
})
