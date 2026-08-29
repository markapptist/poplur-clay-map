import type { RadiusPreviewThemeId } from './radiusDominationPreview'

/**
 * Demo-only territory economy used by the radius-domination preview.
 *
 * The production Credits ledger is transferable and cash-out capable, while
 * Radius is earned from posts and engagement. This model intentionally keeps
 * those systems separate: Credits can license cosmetic building themes, but
 * they can never change ownership, radius, domination power, upkeep, shields,
 * or a contest result.
 */

export type TerritoryStewardshipStatus = 'held' | 'contested' | 'fading' | 'neutral'
export type TerritoryBuildingLevel = 0 | 1 | 2 | 3

export type TerritoryBuildingThemeId =
  | 'classic'
  | 'pop-pink'
  | 'candy-district'
  | 'nightclub'
  | Exclude<RadiusPreviewThemeId, 'original'>

export interface TerritoryBuildingThemeLicense {
  id: TerritoryBuildingThemeId
  label: string
  icon: string
  creditCost: number
  description: string
}

export const TERRITORY_BUILDING_THEMES: readonly TerritoryBuildingThemeLicense[] = [
  {
    id: 'classic',
    label: 'Poplur Classic',
    icon: '✦',
    creditCost: 0,
    description: 'Owner-colour clay with a clean cream roof.',
  },
  {
    id: 'pop-pink',
    label: 'Pop Pink',
    icon: '★',
    creditCost: 0,
    description: 'Owner-colour walls with Poplur pink roof caps.',
  },
  {
    id: 'candy-district',
    label: 'Candy District',
    icon: '🍬',
    creditCost: 10,
    description: 'Bubblegum caps and soft candy-coloured neutral blocks.',
  },
  {
    id: 'nightclub',
    label: 'Nightclub',
    icon: '◈',
    creditCost: 15,
    description: 'Dark roofs with bright owner-colour walls.',
  },
  {
    id: 'christmas',
    label: 'Christmas',
    icon: '🎄',
    creditCost: 12,
    description: 'Snow caps and evergreen neutral buildings.',
  },
  {
    id: 'halloween',
    label: 'Halloween',
    icon: '🎃',
    creditCost: 12,
    description: 'Pumpkin roofs and midnight neutral buildings.',
  },
  {
    id: 'lunar-new-year',
    label: 'Lunar New Year',
    icon: '🏮',
    creditCost: 12,
    description: 'Gold roofs and deep-red neutral buildings.',
  },
  {
    id: 'valentine',
    label: "Valentine's",
    icon: '♥',
    creditCost: 12,
    description: 'Pearl-pink roofs and warm plum neutral buildings.',
  },
  {
    id: 'pride',
    label: 'Pride',
    icon: '🌈',
    creditCost: 12,
    description: 'Golden caps over the full owner-colour district palette.',
  },
] as const

export interface TerritoryEconomyState {
  territoryId: string
  ownerId: string
  ownerLabel: string
  ownerColor: string
  status: TerritoryStewardshipStatus
  radiusKm: number
  dominationPower: number
  demoCredits: number
  ownedThemeIds: readonly TerritoryBuildingThemeId[]
  equippedThemeId: TerritoryBuildingThemeId
  upkeepCycles: number
  uniqueLocalInteractions: number
  buildingLevel: TerritoryBuildingLevel
  leaseHoursRemaining: number
  upkeepHoursRemaining: number
  qualifiedVisitsToday: number
  ownershipCreditsEarned: number
  dailyOwnershipCreditCap: number
  ownerFeedMultiplier: number
  postsHostedToday: number
  radiusEarnedFromHostedPosts: number
  dailyHostedPostCap: number
  coordinateOwnerRanks: readonly CoordinateOwnershipRank[]
}

export interface TerritoryEconomyResult {
  state: TerritoryEconomyState
  changed: boolean
  message: string
}

export interface CoordinateOwnershipCandidate {
  ownerId: string
  ownerLabel: string
  ownerColor: string
  radiusKm: number
  dominationPower: number
  incumbent?: boolean
}

export interface CoordinateOwnershipRank extends CoordinateOwnershipCandidate {
  rank: number
  ownsCoordinate: boolean
  feedMultiplier: number
  postRadiusYieldKm: number
}

const COORDINATE_FEED_MULTIPLIERS = [3, 1.8, 1.2] as const
const COORDINATE_POST_RADIUS_YIELDS_KM = [0.08, 0.03, 0.01] as const

export const TERRITORY_BUILDING_LEVEL_NAMES: Readonly<Record<TerritoryBuildingLevel, string>> = {
  0: 'Plot',
  1: 'Kiosk',
  2: 'Venue',
  3: 'Tower',
}

export function territoryBuildingTheme(
  id: TerritoryBuildingThemeId,
): TerritoryBuildingThemeLicense {
  return TERRITORY_BUILDING_THEMES.find((theme) => theme.id === id)
    ?? TERRITORY_BUILDING_THEMES[0]
}

export function earnedTerritoryBuildingLevel(
  upkeepCycles: number,
  uniqueLocalInteractions: number,
): TerritoryBuildingLevel {
  const cycles = Math.max(0, Math.floor(upkeepCycles))
  const interactions = Math.max(0, Math.floor(uniqueLocalInteractions))
  if (cycles >= 10 && interactions >= 50) return 3
  if (cycles >= 5 && interactions >= 15) return 2
  if (cycles >= 2) return 1
  return 0
}

export function createPreviewTerritoryEconomy(): TerritoryEconomyState {
  return {
    territoryId: 'preview-eiffel-stewardship',
    ownerId: 'mine',
    ownerLabel: 'YOU',
    ownerColor: '#EC3E91',
    status: 'held',
    radiusKm: 2.7,
    dominationPower: 88,
    demoCredits: 42,
    ownedThemeIds: ['classic', 'pop-pink'],
    equippedThemeId: 'classic',
    upkeepCycles: 1,
    uniqueLocalInteractions: 8,
    buildingLevel: 0,
    leaseHoursRemaining: 148,
    upkeepHoursRemaining: 31,
    qualifiedVisitsToday: 3,
    ownershipCreditsEarned: 3,
    dailyOwnershipCreditCap: 12,
    ownerFeedMultiplier: COORDINATE_FEED_MULTIPLIERS[0],
    postsHostedToday: 2,
    radiusEarnedFromHostedPosts: 0.16,
    dailyHostedPostCap: 20,
    coordinateOwnerRanks: PREVIEW_COORDINATE_OWNER_RANKS.map((rank) => ({ ...rank })),
  }
}

/**
 * Every posted coordinate has a deterministic ranking. The top-ranked poster
 * holds the coordinate; lower ranks still receive a smaller discovery lift.
 * An incumbent wins an exact tie so ownership cannot flicker between refreshes.
 */
export function rankCoordinateOwners(
  candidates: readonly CoordinateOwnershipCandidate[],
): CoordinateOwnershipRank[] {
  return [...candidates]
    .filter((candidate) => candidate.ownerId && Number.isFinite(candidate.dominationPower))
    .sort((a, b) =>
      Math.max(0, b.dominationPower) - Math.max(0, a.dominationPower)
      || Number(Boolean(b.incumbent)) - Number(Boolean(a.incumbent))
      || Math.max(0, b.radiusKm) - Math.max(0, a.radiusKm)
      || a.ownerId.localeCompare(b.ownerId))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      ownsCoordinate: index === 0,
      feedMultiplier: COORDINATE_FEED_MULTIPLIERS[index] ?? 1,
      postRadiusYieldKm: COORDINATE_POST_RADIUS_YIELDS_KM[index] ?? 0,
    }))
}

export const PREVIEW_COORDINATE_OWNER_RANKS: readonly CoordinateOwnershipRank[] = rankCoordinateOwners([
  {
    ownerId: 'mine',
    ownerLabel: 'YOU',
    ownerColor: '#EC3E91',
    radiusKm: 2.7,
    dominationPower: 88,
    incumbent: true,
  },
  {
    ownerId: 'leo',
    ownerLabel: 'LEO',
    ownerColor: '#34BEEB',
    radiusKm: 3.1,
    dominationPower: 81,
  },
  {
    ownerId: 'sophie',
    ownerLabel: 'SOPHIE',
    ownerColor: '#F2A11D',
    radiusKm: 2.4,
    dominationPower: 74,
  },
])

export function purchaseAndEquipTerritoryTheme(
  state: TerritoryEconomyState,
  themeId: TerritoryBuildingThemeId,
): TerritoryEconomyResult {
  const theme = territoryBuildingTheme(themeId)
  const alreadyOwned = state.ownedThemeIds.includes(theme.id)
  if (alreadyOwned && state.equippedThemeId === theme.id) {
    return { state, changed: false, message: `${theme.label} is already equipped.` }
  }

  if (!alreadyOwned && state.demoCredits < theme.creditCost) {
    return {
      state,
      changed: false,
      message: `You need ${theme.creditCost - state.demoCredits} more demo Credits for ${theme.label}.`,
    }
  }

  const ownedThemeIds = alreadyOwned
    ? state.ownedThemeIds
    : [...state.ownedThemeIds, theme.id]
  const next: TerritoryEconomyState = {
    ...state,
    demoCredits: alreadyOwned ? state.demoCredits : state.demoCredits - theme.creditCost,
    ownedThemeIds,
    equippedThemeId: theme.id,
  }
  return {
    state: next,
    changed: true,
    message: alreadyOwned
      ? `${theme.label} equipped. Ownership power did not change.`
      : `${theme.label} licensed and equipped for ${theme.creditCost} demo Credits.`,
  }
}

/** Simulates the earned part of the loop: one eligible local post/upkeep cycle. */
export function recordPreviewTerritoryUpkeep(
  state: TerritoryEconomyState,
  uniqueInteractions = 7,
): TerritoryEconomyResult {
  if (state.status === 'neutral') {
    return { state, changed: false, message: 'A neutral territory must be earned with a post first.' }
  }
  const upkeepCycles = state.upkeepCycles + 1
  const uniqueLocalInteractions = state.uniqueLocalInteractions
    + Math.max(0, Math.floor(uniqueInteractions))
  const buildingLevel = earnedTerritoryBuildingLevel(upkeepCycles, uniqueLocalInteractions)
  const grew = buildingLevel > state.buildingLevel
  return {
    state: {
      ...state,
      upkeepCycles,
      uniqueLocalInteractions,
      buildingLevel,
      upkeepHoursRemaining: 72,
    },
    changed: true,
    message: grew
      ? `Property grew to ${TERRITORY_BUILDING_LEVEL_NAMES[buildingLevel]} through local activity.`
      : 'Upkeep recorded. Building progress was earned without spending Credits.',
  }
}

/**
 * Simulates one server-verified, non-self, unique visitor entering the held
 * territory. The owner earns a bounded Credit and receives the top local-feed
 * weighting. The visit never changes Radius or domination power.
 */
export function recordPreviewTerritoryVisit(
  state: TerritoryEconomyState,
): TerritoryEconomyResult {
  if (state.status !== 'held' && state.status !== 'contested') {
    return { state, changed: false, message: 'Only an actively held space can earn visit Credits.' }
  }
  if (state.qualifiedVisitsToday >= state.dailyOwnershipCreditCap) {
    return {
      state,
      changed: false,
      message: `Daily ownership payout cap reached (${state.dailyOwnershipCreditCap} Credits).`,
    }
  }
  return {
    state: {
      ...state,
      demoCredits: state.demoCredits + 1,
      qualifiedVisitsToday: state.qualifiedVisitsToday + 1,
      ownershipCreditsEarned: state.ownershipCreditsEarned + 1,
    },
    changed: true,
    message: `Verified visitor entered: +1 demo Credit and ${state.ownerFeedMultiplier}× owner-video priority.`,
  }
}

/**
 * Simulates an eligible third party posting inside this coordinate. The ranked
 * owner receives a Radius dividend, deliberately creating the compounding
 * ownership loop. Production should project the same event across ranks 1–3
 * using each rank's `postRadiusYieldKm` and enforce unique-post/daily limits on
 * the server.
 */
export function recordPreviewHostedPost(
  state: TerritoryEconomyState,
): TerritoryEconomyResult {
  if (state.status !== 'held' && state.status !== 'contested') {
    return { state, changed: false, message: 'Only a ranked owner can receive hosted-post Radius.' }
  }
  if (state.postsHostedToday >= state.dailyHostedPostCap) {
    return {
      state,
      changed: false,
      message: `Daily hosted-post cap reached (${state.dailyHostedPostCap} qualified posts).`,
    }
  }
  const currentRanks = state.coordinateOwnerRanks.length
    ? state.coordinateOwnerRanks
    : PREVIEW_COORDINATE_OWNER_RANKS
  const updatedRanks = rankCoordinateOwners(currentRanks.map((rank) => ({
    ownerId: rank.ownerId,
    ownerLabel: rank.ownerLabel,
    ownerColor: rank.ownerColor,
    radiusKm: Number((rank.radiusKm + rank.postRadiusYieldKm).toFixed(2)),
    dominationPower: rank.dominationPower,
    incumbent: rank.ownsCoordinate,
  })))
  const owner = updatedRanks.find((rank) => rank.ownerId === state.ownerId) ?? updatedRanks[0]
  const radiusYieldKm = owner?.postRadiusYieldKm ?? 0
  return {
    state: {
      ...state,
      radiusKm: owner?.radiusKm ?? state.radiusKm,
      dominationPower: state.dominationPower,
      postsHostedToday: state.postsHostedToday + 1,
      radiusEarnedFromHostedPosts: Number((state.radiusEarnedFromHostedPosts + radiusYieldKm).toFixed(2)),
      coordinateOwnerRanks: updatedRanks,
    },
    changed: true,
    message: `A user posted here: #1 +${updatedRanks[0]?.postRadiusYieldKm.toFixed(2)} km, #2 +${updatedRanks[1]?.postRadiusYieldKm.toFixed(2)} km, #3 +${updatedRanks[2]?.postRadiusYieldKm.toFixed(2)} km Radius.`,
  }
}

export function territoryStateAfterExpiry(
  state: TerritoryEconomyState,
  overdueHours: number,
): TerritoryEconomyState {
  const overdue = Math.max(0, Number.isFinite(overdueHours) ? overdueHours : 0)
  if (overdue < 24) return { ...state, status: 'fading', upkeepHoursRemaining: 0 }
  return {
    ...state,
    status: 'neutral',
    ownerId: 'unclaimed',
    ownerLabel: 'UNCLAIMED',
    dominationPower: 0,
    radiusKm: 0,
    buildingLevel: 0,
    leaseHoursRemaining: 0,
    upkeepHoursRemaining: 0,
  }
}
