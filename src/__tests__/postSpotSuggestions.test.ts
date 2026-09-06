import { describe, expect, it } from 'vitest'
import {
  newGroundFraction,
  rankPostSpots,
  spotDistanceMeters,
  spotProbePoints,
  spotSearchBoundingBox,
  spotSearchQueries,
  spotSearchRadiusKm,
  type SpotCandidate,
} from '../postSpotSuggestions'

/** ~1.1 km per 0.01 degrees of latitude at Toronto's latitude. */
const HOME: [number, number] = [-79.3811, 43.6487]

function candidate(
  id: string,
  center: [number, number],
  terms: readonly string[] = [],
  name = id,
): SpotCandidate {
  return { id, name, center, terms }
}

/** Move north by a number of kilometres — the tests need real distance, not
 *  degree arithmetic that reads differently at different latitudes. */
function north(from: [number, number], km: number): [number, number] {
  return [from[0], from[1] + km / 111.32]
}

describe('new ground', () => {
  it('is the whole claim when the poster holds nothing', () => {
    expect(newGroundFraction(HOME, 2, [])).toBe(1)
  })

  it('is nothing when an existing pop of yours already swallows the claim', () => {
    expect(newGroundFraction(HOME, 1, [{ coords: HOME, radiusKm: 40 }])).toBe(0)
  })

  it('is partial when your own pop covers part of the claim', () => {
    const fraction = newGroundFraction(HOME, 4, [{ coords: HOME, radiusKm: 2 }])
    expect(fraction).toBeGreaterThan(0.4)
    expect(fraction).toBeLessThan(0.9)
  })

  it('counts area, not spokes: a claim twice as wide as your pop is ~3/4 new', () => {
    // Own disc r, claim disc 2r, concentric: the covered share is (r/2r)^2 = 1/4.
    const fraction = newGroundFraction(HOME, 4, [{ coords: HOME, radiusKm: 2 }])
    expect(fraction).toBeGreaterThan(0.68)
    expect(fraction).toBeLessThan(0.82)
  })
})

describe('ranking post spots', () => {
  const ownClaims = [{ coords: HOME, radiusKm: 5 }]

  it('drops places buried inside ground the poster already reaches', () => {
    const ranked = rankPostSpots([candidate('inside', north(HOME, 1))], {
      origin: HOME,
      claimRadiusKm: 1,
      ownClaims,
    })
    expect(ranked).toEqual([])
  })

  it('prefers new ground over a nearer spot the poster already covers', () => {
    const ranked = rankPostSpots([
      candidate('covered', north(HOME, 2)),
      candidate('frontier', north(HOME, 9)),
    ], { origin: HOME, claimRadiusKm: 2, ownClaims })
    expect(ranked.map(spot => spot.id)).toEqual(['frontier'])
  })

  it('breaks a tie on new ground with the draft channel', () => {
    const ranked = rankPostSpots([
      candidate('plain-corner', north(HOME, 20), ['neighborhood']),
      candidate('the-kitchen', north(HOME, 20.2), ['restaurant']),
    ], { origin: HOME, claimRadiusKm: 2, ownClaims, channelId: 'food' })
    expect(ranked[0].id).toBe('the-kitchen')
    expect(ranked[0].reason).toContain('food')
  })

  it('says what the camera saw when the place matches it', () => {
    const ranked = rankPostSpots([
      candidate('roastery', north(HOME, 20), ['cafe', 'coffee'], 'Pilot Coffee'),
    ], { origin: HOME, claimRadiusKm: 2, ownClaims, sceneTerms: ['coffee', 'cup'] })
    expect(ranked[0].reason).toContain('coffee')
  })

  it('never returns more than three, and never a duplicate name', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      candidate(`spot-${index}`, north(HOME, 20 + index), [], index < 4 ? 'Same Place' : `Place ${index}`))
    const ranked = rankPostSpots(many, { origin: HOME, claimRadiusKm: 2, ownClaims })
    expect(ranked.length).toBeLessThanOrEqual(3)
    expect(new Set(ranked.map(spot => spot.name)).size).toBe(ranked.length)
  })

  it('reports how much of the claim is genuinely new', () => {
    // 15 km out: clear of the poster's own 5 km pop, and inside the 25 km band
    // a 2 km claim is allowed to suggest within.
    const [ranked] = rankPostSpots([candidate('far', north(HOME, 15))], {
      origin: HOME,
      claimRadiusKm: 2,
      ownClaims,
    })
    expect(ranked.newGround).toBe(1)
    expect(ranked.reason).toContain('None of your pops reach here')
  })

  it('measures distance honestly', () => {
    expect(spotDistanceMeters(HOME, north(HOME, 10))).toBeGreaterThan(9_800)
    expect(spotDistanceMeters(HOME, north(HOME, 10))).toBeLessThan(10_200)
  })
})

describe('what the picker asks Mapbox for', () => {
  // These are canonical Mapbox category ids, not words. An id Mapbox does not
  // recognise comes back as an empty list rather than an error, so a typo here
  // is a channel that silently never suggests anything.
  it('asks for the channel as a kind of place, and for what was shot', () => {
    expect(spotSearchQueries({ channelId: 'music', sceneTerms: ['guitar'] }))
      .toEqual(['music_venue'])
    expect(spotSearchQueries({ channelId: 'food', sceneTerms: ['coffee'] }))
      .toEqual(['restaurant', 'coffee'])
  })

  it('stops at two: the channel, then the first scene word that is a place', () => {
    expect(spotSearchQueries({ channelId: 'food', sceneTerms: ['dog', 'guitar', 'ball'] }))
      .toEqual(['restaurant', 'park'])
  })

  it('does not spend two requests on the same category', () => {
    // Food + pizza both mean "restaurant".
    expect(spotSearchQueries({ channelId: 'food', sceneTerms: ['pizza'] }))
      .toEqual(['restaurant'])
  })

  it('spends no request on a scene word that is not a kind of place', () => {
    // "table" still counts for content fit against a candidate's own words; it
    // is simply not worth a search of its own.
    expect(spotSearchQueries({ channelId: 'food', sceneTerms: ['table', 'chair'] }))
      .toEqual(['restaurant'])
  })

  it('still asks something useful for a draft with no channel and no scan', () => {
    expect(spotSearchQueries({})).toEqual(['park'])
  })

  it('has a category for every channel the feed can file a post under', () => {
    const channels = ['food', 'live', 'beauty', 'sports', 'modelling', 'fashion', 'music',
      'tech', 'news', 'french', 'spanish', 'shopping', 'cartoon', 'kids', 'comedy']
    for (const channelId of channels) {
      expect(spotSearchQueries({ channelId })).not.toEqual(['park'])
    }
  })
})

describe('a poster who has earned no radius yet', () => {
  const HOME_UNCLAIMED: [number, number] = [-79.3811, 43.6487]

  it('still gets an answer, measured against a nominal claim', () => {
    const ranked = rankPostSpots([candidate('elsewhere', north(HOME_UNCLAIMED, 15))], {
      origin: HOME_UNCLAIMED,
      claimRadiusKm: 0,
      ownClaims: [{ coords: HOME_UNCLAIMED, radiusKm: 5 }],
    })
    expect(ranked).toHaveLength(1)
    // ...and never quotes a percentage of a claim that does not exist yet.
    expect(ranked[0].reason).not.toContain('% of this claim')
  })

  it('still excludes ground they already hold', () => {
    const ranked = rankPostSpots([candidate('inside', north(HOME_UNCLAIMED, 1))], {
      origin: HOME_UNCLAIMED,
      claimRadiusKm: 0,
      ownClaims: [{ coords: HOME_UNCLAIMED, radiusKm: 5 }],
    })
    expect(ranked).toEqual([])
  })
})

describe('a suggestion has to be somewhere you could plausibly mean', () => {
  const HERE: [number, number] = [-79.3811, 43.6487]

  it('refuses a place on the other side of the continent, however new the ground', () => {
    // The literal first build of this shipped "Coffee Hill" — a hamlet 3,000 km
    // away whose NAME contains the word the camera read.
    const ranked = rankPostSpots([
      candidate('coffee-hill', [-97.5, 35.2], ['coffee'], 'Coffee Hill'),
      candidate('local-cafe', north(HERE, 12), ['cafe', 'coffee'], 'Sam James'),
    ], { origin: HERE, claimRadiusKm: 2, ownClaims: [{ coords: HERE, radiusKm: 5 }], sceneTerms: ['coffee'] })
    expect(ranked.map(spot => spot.name)).toEqual(['Sam James'])
  })

  it('opens the band as the claim itself grows', () => {
    expect(spotSearchRadiusKm(0)).toBe(25)
    expect(spotSearchRadiusKm(2)).toBe(25)
    expect(spotSearchRadiusKm(50)).toBe(400)
    // Never unbounded: past this, travelling is the search panel's job.
    expect(spotSearchRadiusKm(5_000)).toBe(400)
  })

  it('builds a search box that actually contains the band', () => {
    const [minLng, minLat, maxLng, maxLat] = spotSearchBoundingBox(HERE, 25)
    expect(minLat).toBeLessThan(HERE[1])
    expect(maxLat).toBeGreaterThan(HERE[1])
    expect(spotDistanceMeters(HERE, [HERE[0], maxLat])).toBeGreaterThan(24_000)
    expect(spotDistanceMeters(HERE, [maxLng, HERE[1]])).toBeGreaterThan(24_000)
  })

  it('tells the reader how far away it is', () => {
    const [ranked] = rankPostSpots([candidate('nearby', north(HERE, 12))], {
      origin: HERE,
      claimRadiusKm: 2,
      ownClaims: [{ coords: HERE, radiusKm: 5 }],
    })
    expect(ranked.distanceLabel).toBe('12 km')
  })
})

describe('three names for the same ground are one suggestion', () => {
  const HERE: [number, number] = [-79.3811, 43.6487]
  const own = [{ coords: HERE, radiusKm: 0.2 }]

  it('does not fill the list with neighbours on the same block', () => {
    // Pilot, Tim Hortons and maman, 50-150 m apart: whichever you pick, the
    // 2 km claim lands on the same ground.
    const blockmates = [
      candidate('a', north(HERE, 4), ['coffee'], 'Pilot'),
      candidate('b', north(HERE, 4.05), ['coffee'], 'Tim Hortons'),
      candidate('c', north(HERE, 4.1), ['coffee'], 'maman'),
      candidate('d', north(HERE, 18), ['coffee'], 'Across Town'),
    ]
    const ranked = rankPostSpots(blockmates, { origin: HERE, claimRadiusKm: 2, ownClaims: own })
    expect(ranked).toHaveLength(2)
    expect(ranked.map(spot => spot.name)).toContain('Across Town')
  })

  it('still offers close neighbours when the claim is small enough to tell them apart', () => {
    const ranked = rankPostSpots([
      candidate('a', north(HERE, 4), ['coffee'], 'Pilot'),
      candidate('b', north(HERE, 6), ['coffee'], 'Two Km Away'),
    ], { origin: HERE, claimRadiusKm: 0.4, ownClaims: own })
    expect(ranked).toHaveLength(2)
  })
})

describe('where the picker asks, not only what it asks for', () => {
  const HERE: [number, number] = [-79.3811, 43.6487]

  it('asks once, near you, when you hold no ground', () => {
    expect(spotProbePoints(HERE, [], 2)).toEqual([[HERE[0], HERE[1]]])
  })

  it('sends a second probe past the far edge of the ground you hold', () => {
    // Mapbox's category search is nearest-first: without this, every candidate
    // sits within 400 m of the origin and "somewhere else" is unreachable.
    const probes = spotProbePoints(HERE, [{ coords: HERE, radiusKm: 6 }], 2)
    expect(probes).toHaveLength(2)
    const step = spotDistanceMeters(HERE, probes[1])
    expect(step).toBeGreaterThan(6_000)
    expect(step / 1_000).toBeLessThanOrEqual(spotSearchRadiusKm(2))
  })

  it('walks AWAY from where the poster already holds ground', () => {
    const northOfHere = north(HERE, 8)
    const probes = spotProbePoints(HERE, [{ coords: northOfHere, radiusKm: 3 }], 2)
    // Their ground is to the north, so the probe belongs to the south.
    expect(probes[1][1]).toBeLessThan(HERE[1])
  })

  it('never probes outside the band a suggestion may come from', () => {
    const probes = spotProbePoints(HERE, [{ coords: HERE, radiusKm: 9_000 }], 1)
    expect(spotDistanceMeters(HERE, probes[1]) / 1_000)
      .toBeLessThanOrEqual(spotSearchRadiusKm(1))
  })
})
