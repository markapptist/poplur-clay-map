import { radiusStats, ownedPostCount } from './radiusLedger'
import { creditBalance } from './poplurCredits'
import { isWorldRadiusActive } from './referral'

// The trophy library — every trophy the profile's TROPHY ROOM can hold, with
// the artwork it wears (public/trophies/) and, where the client can actually
// answer the question, the predicate that earns it.
//
// This is deliberately NOT an achievement engine. Everything here is derived
// from ledgers the app already keeps (radiusLedger, poplurCredits, referral),
// so a trophy is earned the moment the underlying ledger says so — no second
// counter to drift out of agreement. Trophies whose requirement lives on the
// live service (global rank, verification, subscription) carry `earned: null`
// and stay locked until that wire exists; their tiles say what they need
// rather than pretending a number.
//
// Earned state RATCHETS: the earn date is stamped into storage on first
// satisfaction and survives the stat later decaying back under the bar
// (radius decays by design — a trophy you earned is not un-won by that).

export type TrophyRarity =
  | 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic'
  | 'Poplur Exclusive'

/** Tint per rarity — the StatsScreen chart palette, so rarity reads in the
    same colour language as the rest of Profile. */
export const RARITY_COLOR: Record<TrophyRarity, string> = {
  Common: '#9aa5b1',
  Uncommon: '#4ade80',
  Rare: '#38bdf8',
  Epic: '#a78bfa',
  Legendary: '#fbbf24',
  Mythic: '#f87171',
  'Poplur Exclusive': '#f63b9a',
}

/** One snapshot for every predicate, gathered once per evaluation. */
export interface TrophyStats {
  views: number
  likes: number
  comments: number
  profileVisits: number
  radiusKm: number
  gains: number
  /** total radius ledger entries — every view/like/comment/visit counts */
  events: number
  /** likes + comments + profile visits: the "someone reacted" total */
  engagements: number
  posts: number
  credits: number
  worldRadius: boolean
}

export function collectTrophyStats(): TrophyStats {
  const s = radiusStats()
  return {
    views: s.views,
    likes: s.likes,
    comments: s.comments,
    profileVisits: s.profileVisits,
    radiusKm: s.radiusKm,
    gains: s.gains,
    events: s.events.length,
    engagements: s.likes + s.comments + s.profileVisits,
    posts: ownedPostCount(),
    credits: creditBalance(),
    worldRadius: isWorldRadiusActive(),
  }
}

export interface TrophyDef {
  id: string
  name: string
  description: string
  rarity: TrophyRarity
  /** artwork under public/, referenced relative like every other asset */
  art: string
  /** the plain-words bar to clear, shown on locked tiles and in detail */
  requirement: string
  /** null = the live service owns this answer; locked until that wire lands */
  earned: ((s: TrophyStats) => boolean) | null
  /** current/goal pair for locked-but-countable trophies */
  progress?: (s: TrophyStats) => [number, number]
}

/** LEGEND is the meta-trophy: it needs every OTHER trophy, including the
    service-owned ones, so it is evaluated in a second pass below. */
export const LEGEND_ID = 'poplur_legend'

export const TROPHIES: TrophyDef[] = [
  // ── Common ──
  {
    id: 'top_viewer',
    name: 'Top Viewer',
    description: 'You showed up and you watched. Every collection starts with somebody paying attention.',
    rarity: 'Common',
    art: 'trophies/top_viewer.png',
    requirement: 'View 100 posts',
    earned: s => s.views >= 100,
    progress: s => [s.views, 100],
  },
  {
    id: 'milestone_unlocked',
    name: 'Milestone',
    description: 'Your radius cleared its first big ring — 100 km of ground that knows your name.',
    rarity: 'Common',
    art: 'trophies/milestone_unlocked.png',
    requirement: 'Grow your radius to 100 km',
    earned: s => s.radiusKm >= 100,
    progress: s => [Math.round(s.radiusKm), 100],
  },
  {
    id: 'purple_medal',
    name: 'First Reactions',
    description: 'The first ten times somebody out there liked, commented, or came looking for you.',
    rarity: 'Common',
    art: 'trophies/purple_medal.png',
    requirement: 'Receive 10 reactions',
    earned: s => s.engagements >= 10,
    progress: s => [s.engagements, 10],
  },

  // ── Uncommon ──
  {
    id: 'poplur_creator',
    name: 'Creator',
    description: 'Ten pops on the ground. You stopped browsing the world and started furnishing it.',
    rarity: 'Uncommon',
    art: 'trophies/poplur_creator.png',
    requirement: 'Publish 10 posts',
    earned: s => s.posts >= 10,
    progress: s => [s.posts, 10],
  },
  {
    id: 'community_favorite',
    name: 'Community Favorite',
    description: 'Fifty people saw a pop of yours and wanted to know who made it.',
    rarity: 'Uncommon',
    art: 'trophies/community_favorite.png',
    requirement: 'Get 50 profile visits',
    earned: s => s.profileVisits >= 50,
    progress: s => [s.profileVisits, 50],
  },
  {
    id: 'trusted_member',
    name: 'Trusted Member',
    description: 'Twenty-five conversations started under your posts. People talk where they feel at home.',
    rarity: 'Uncommon',
    art: 'trophies/trusted_member.png',
    requirement: 'Receive 25 comments',
    earned: s => s.comments >= 25,
    progress: s => [s.comments, 25],
  },

  // ── Rare ──
  {
    id: 'rising_star',
    name: 'Rising Star',
    description: 'A thousand views. The neighbourhood has noticed; the city is next.',
    rarity: 'Rare',
    art: 'trophies/rising_star.png',
    requirement: 'Reach 1,000 total views',
    earned: s => s.views >= 1_000,
    progress: s => [s.views, 1_000],
  },
  {
    id: 'trend_setter',
    name: 'Trend Setter',
    description: 'A hundred likes — you are not following the wave, you are the reason there is one.',
    rarity: 'Rare',
    art: 'trophies/trend_setter.png',
    requirement: 'Earn 100 likes',
    earned: s => s.likes >= 100,
    progress: s => [s.likes, 100],
  },
  {
    id: 'gold_medal',
    name: 'Gold Medal',
    description: 'A hundred reactions of every kind. Consistent, undeniable, gold.',
    rarity: 'Rare',
    art: 'trophies/gold_medal.png',
    requirement: 'Receive 100 reactions',
    earned: s => s.engagements >= 100,
    progress: s => [s.engagements, 100],
  },
  {
    id: 'dedication',
    name: 'Dedication',
    description: 'Five hundred entries in the radius ledger. Every view, like and comment counted — and you kept counting.',
    rarity: 'Rare',
    art: 'trophies/dedication.png',
    requirement: 'Log 500 radius events',
    earned: s => s.events >= 500,
    progress: s => [s.events, 500],
  },

  // ── Epic ──
  {
    id: 'crowned_heart',
    name: 'Beloved',
    description: 'Five hundred hearts. At this point it is less an audience and more a following.',
    rarity: 'Epic',
    art: 'trophies/crowned_heart.png',
    requirement: 'Earn 500 likes',
    earned: s => s.likes >= 500,
    progress: s => [s.likes, 500],
  },
  {
    id: 'champion',
    name: 'Champion',
    description: 'Five hundred kilometres of radius gained, one reaction at a time. Earned ground, all of it.',
    rarity: 'Epic',
    art: 'trophies/champion.png',
    requirement: 'Gain 500 km of total radius',
    earned: s => s.gains >= 500,
    progress: s => [Math.round(s.gains), 500],
  },
  {
    id: 'global_impact',
    name: 'Global Impact',
    description: 'A thousand-kilometre radius. Your pops cross borders without a passport.',
    rarity: 'Epic',
    art: 'trophies/global_impact.png',
    requirement: 'Grow your radius to 1,000 km',
    earned: s => s.radiusKm >= 1_000,
    progress: s => [Math.round(s.radiusKm), 1_000],
  },
  {
    id: 'black_gold_medal',
    name: 'Black Gold',
    description: 'A thousand reactions. Past gold there is only this.',
    rarity: 'Epic',
    art: 'trophies/black_gold_medal.png',
    requirement: 'Receive 1,000 reactions',
    earned: s => s.engagements >= 1_000,
    progress: s => [s.engagements, 1_000],
  },

  // ── Legendary ──
  {
    id: 'global_trophy',
    name: 'World Class',
    description: 'Twenty-five hundred kilometres — a radius you can see the curve of the Earth inside.',
    rarity: 'Legendary',
    art: 'trophies/global_trophy.png',
    requirement: 'Grow your radius to 2,500 km',
    earned: s => s.radiusKm >= 2_500,
    progress: s => [Math.round(s.radiusKm), 2_500],
  },
  {
    id: 'world_reach',
    name: 'World Reach',
    description: 'Reach the radius of the Earth itself: 6,371 km. There is nowhere your pops do not land.',
    rarity: 'Legendary',
    art: 'trophies/world_reach.png',
    requirement: 'Reach a 6,371 km radius (or hold a world-radius day)',
    // A referral's world-radius day IS the whole planet for a day — that counts.
    earned: s => s.radiusKm >= 6_371 || s.worldRadius,
    progress: s => [Math.round(s.radiusKm), 6_371],
  },

  // ── Mythic ──
  {
    id: 'king_of_poplur',
    name: 'King of Poplur',
    description: 'The number-one creator on the planet. There is exactly one of these at a time.',
    rarity: 'Mythic',
    art: 'trophies/king_of_poplur.png',
    requirement: 'Rank #1 creator worldwide',
    earned: null, // global rank is the live service's answer, not this phone's
  },
  {
    id: LEGEND_ID,
    name: 'Poplur Legend',
    description: 'Every other trophy on this wall, earned. The shelf above this one is empty on purpose.',
    rarity: 'Mythic',
    art: 'trophies/poplur_legend.png',
    requirement: 'Collect every other trophy',
    // Meta-trophy: evaluated in a second pass over the stamped set (see
    // trophyStates), because its answer is the other trophies, not a stat.
    earned: null,
  },

  // ── Poplur Exclusive ──
  {
    id: 'early_adopter',
    name: 'Early Adopter',
    description: 'You were here before the world was. This one never becomes earnable again.',
    rarity: 'Poplur Exclusive',
    art: 'trophies/early_adopter.png',
    requirement: 'Join Poplur before launch',
    // Anyone running this build IS pre-launch — earned by definition, and the
    // ratchet keeps the stamp after launch flips this predicate off.
    earned: () => true,
  },
  {
    id: 'poplur_vip',
    name: 'VIP',
    description: 'Five hundred Poplur credits in the wallet at once. The doorman nods you through.',
    rarity: 'Poplur Exclusive',
    art: 'trophies/poplur_vip.png',
    requirement: 'Hold 500 Poplur credits',
    earned: s => s.credits >= 500,
    progress: s => [s.credits, 500],
  },
  {
    id: 'poplur_verified',
    name: 'Verified',
    description: 'The real you, confirmed by Poplur itself.',
    rarity: 'Poplur Exclusive',
    art: 'trophies/poplur_verified.png',
    requirement: 'Verify your account',
    earned: null, // verification is a live-service identity check
  },
  {
    id: 'premium_creator',
    name: 'Premium Creator',
    description: 'A Poplur Premium subscriber with the creator tools to show for it.',
    rarity: 'Poplur Exclusive',
    art: 'trophies/premium_creator.png',
    requirement: 'Subscribe to Poplur Premium',
    earned: null, // subscriptions live in StoreKit/Play Billing, not this ledger
  },
]

// ── Earned-state ratchet (same persisted-pref pattern as radiusLedger) ──

const EARNED_KEY = 'poplur.trophies.earned.v1'
export const TROPHY_CHANGE_EVENT = 'poplur-trophy-change'

function readEarned(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EARNED_KEY) ?? 'null')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeEarned(value: Record<string, number>) {
  try { window.localStorage.setItem(EARNED_KEY, JSON.stringify(value)) } catch { /* private mode */ }
}

export interface TrophyState extends TrophyDef {
  /** epoch ms of first satisfaction, or null while still locked */
  earnedAt: number | null
}

/**
 * Evaluate the whole wall against the live ledgers, stamping any NEWLY earned
 * trophies into storage (with today as the earn date) before returning. Safe
 * to call as often as the UI likes — stamps only ever get added.
 */
export function trophyStates(): TrophyState[] {
  const stats = collectTrophyStats()
  const stamped = readEarned()
  let dirty = false

  for (const def of TROPHIES) {
    if (!stamped[def.id] && def.earned && def.earned(stats)) {
      stamped[def.id] = Date.now()
      dirty = true
    }
  }
  // LEGEND second pass: every other trophy stamped, including the
  // service-owned ones — so it genuinely cannot exist before that wire does.
  if (!stamped[LEGEND_ID] && TROPHIES.every(d => d.id === LEGEND_ID || stamped[d.id])) {
    stamped[LEGEND_ID] = Date.now()
    dirty = true
  }

  if (dirty) {
    writeEarned(stamped)
    window.dispatchEvent(new CustomEvent(TROPHY_CHANGE_EVENT))
  }
  return TROPHIES.map(def => ({ ...def, earnedAt: stamped[def.id] ?? null }))
}

export function onTrophyChange(listener: () => void): () => void {
  const handle = () => listener()
  window.addEventListener(TROPHY_CHANGE_EVENT, handle)
  window.addEventListener('storage', handle)
  return () => {
    window.removeEventListener(TROPHY_CHANGE_EVENT, handle)
    window.removeEventListener('storage', handle)
  }
}
