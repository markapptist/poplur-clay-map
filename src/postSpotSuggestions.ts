// Where should this post go?
//
// The owner asked the app to recommend where to post what they just captured.
// The honest version of that is not "the app picks a spot" -- it never places
// the pop, and the manual choice on the map always wins. It is a short,
// explained shortlist: a few NAMED places, each with one sentence saying why
// this place and not the one you are standing on.
//
// Four signals, all of them already in the app:
//
//   new ground   how much of this claim would fall on ground none of YOUR
//                existing pops already reach. Radius is the product: posting
//                on top of your own coverage wins no territory, so this is
//                the dominant term and the only hard filter.
//   channel      the draft's own channel (food, music, sports...) read as a
//                kind of place, which is what the geocoder can actually find.
//   content      what the camera read in the scene, from the on-device
//                detector that already ran. No second capture, no new model.
//   reach        how far away it is, measured against the claim being made.
//                A suggestion 200 km away is not a suggestion for a 2 km pop.
//
// Candidates come from the map's existing Mapbox geocoder and the app's own
// curated landmarks -- deliberately no new provider and no new Cloud Function.

/** One place we could suggest, before it has been judged. */
export interface SpotCandidate {
  id: string
  name: string
  center: [number, number]
  /** Geocoder category/type words plus the place's own words, lowercased. */
  terms: readonly string[]
}

export interface OwnClaim {
  coords: [number, number]
  radiusKm: number
}

export interface SpotSuggestionInput {
  /** Where the picker is now — candidates are ranked around this point. */
  origin: [number, number]
  /** The claim this post is about to make. Decides what "new ground" means. */
  claimRadiusKm: number
  /** Every live pop of the poster's, uncapped by the marker budget. */
  ownClaims: readonly OwnClaim[]
  /** The draft's channel id, e.g. 'food'. */
  channelId?: string | null
  /** What the camera read in the scene, most confident first. */
  sceneTerms?: readonly string[]
}

export interface SpotSuggestion {
  id: string
  name: string
  center: [number, number]
  distanceM: number
  /** 0..1 — the share of this claim that would land on ground you don't hold. */
  newGround: number
  score: number
  /** One short sentence, in the app's own terms, for why this place. */
  reason: string
  /** "700 m", "3.1 km" — shown beside the name so a suggestion can never be
   *  mistaken for somewhere nearer (or further) than it is. */
  distanceLabel: string
}

/** A claim with less than this share of new ground is not a suggestion. The
 *  whole point is territory you do not already hold. */
const MIN_NEW_GROUND = 0.25
const MAX_SUGGESTIONS = 3
/** A poster with no earned radius yet still deserves an answer to "where
 *  should this go?". Their claim is 0 km wide, so "what share of it is new
 *  ground" has nothing to measure — ask the same question of a nominal
 *  half-kilometre instead, and say it in terms of the PLACE rather than of a
 *  claim that does not exist yet. */
const PROBE_RADIUS_KM = 0.5
/** How much of a suggestion's claim has to fall outside the ones already on
 *  the list for it to be a different suggestion rather than the same one. */
const MIN_DISTINCT_GROUND = 0.45

/**
 * How far a SUGGESTION may be from where the picker is standing.
 *
 * The first build of this had no ceiling and cheerfully proposed "Coffee Hill"
 * — a hamlet on the other side of the continent whose name happens to contain
 * the word the camera read. A suggestion is an alternative to the ground under
 * your feet, so it has to be somewhere you could plausibly mean. The band
 * grows with the claim, because a 50 km pop genuinely does make the next city
 * a live option; travelling further than this is what the picker's search is
 * for, and search has no ceiling at all.
 */
export function spotSearchRadiusKm(claimRadiusKm: number): number {
  return Math.min(400, Math.max(25, Math.max(claimRadiusKm, 0) * 12))
}

/**
 * WHERE to ask, not just what to ask for.
 *
 * Mapbox's category search is nearest-first around the point you give it: at
 * any limit, every cafe it returned sat within 400 m of the origin. One probe
 * can therefore only ever suggest the block you are already standing on, which
 * is the opposite of the question. So the picker asks twice — once here, and
 * once just past the far edge of the ground the poster already holds, which is
 * precisely where a new claim starts winning territory.
 *
 * A poster holding nothing gets one probe: near them IS the honest answer, and
 * a second request would buy nothing.
 */
export function spotProbePoints(
  origin: readonly [number, number],
  ownClaims: readonly OwnClaim[],
  claimRadiusKm: number,
): [number, number][] {
  const probes: [number, number][] = [[origin[0], origin[1]]]
  const reaching = ownClaims.filter(claim => claim.radiusKm > 0)
  if (!reaching.length) return probes

  // The direction the poster's ground lies in, weighted by how much of it
  // there is — then walk the other way.
  let eastM = 0
  let northM = 0
  for (const claim of reaching) {
    const bearing = Math.atan2(
      claim.coords[1] - origin[1],
      (claim.coords[0] - origin[0]) * Math.cos(toRad(origin[1])),
    )
    const weight = claim.radiusKm
    eastM += Math.cos(bearing) * weight
    northM += Math.sin(bearing) * weight
  }
  const length = Math.hypot(eastM, northM)
  // Every pop sits exactly on the origin (the usual case: you post where you
  // are). There is no "away" direction, so step due north — any bearing is as
  // good as another, and a fixed one keeps this deterministic.
  const unitEast = length > 1e-9 ? eastM / length : 0
  const unitNorth = length > 1e-9 ? northM / length : 1

  // How far the poster's ground reaches from here, in the direction we are
  // leaving by — then a claim's width past its edge, so the probe lands on
  // ground a new pop would genuinely take.
  const reachKm = Math.max(...reaching.map(claim =>
    spotDistanceMeters(origin, claim.coords) / 1_000 + claim.radiusKm))
  const stepKm = Math.min(
    spotSearchRadiusKm(claimRadiusKm) * 0.9,
    reachKm + Math.max(claimRadiusKm, PROBE_RADIUS_KM) * 2,
  )
  probes.push(offsetMeters(origin, -unitEast * stepKm * 1_000, -unitNorth * stepKm * 1_000))
  return probes
}

/** A lng/lat box around a point, for biasing the geocoder to the same band. */
export function spotSearchBoundingBox(
  origin: readonly [number, number],
  radiusKm: number,
): [number, number, number, number] {
  const latitudeSpan = radiusKm / 111.32
  const cosLat = Math.max(0.01, Math.cos(toRad(origin[1])))
  const longitudeSpan = latitudeSpan / cosLat
  return [
    Math.max(-180, origin[0] - longitudeSpan),
    Math.max(-90, origin[1] - latitudeSpan),
    Math.min(180, origin[0] + longitudeSpan),
    Math.min(90, origin[1] + latitudeSpan),
  ]
}

/**
 * Channels are topics; a place search wants a KIND OF PLACE.
 *
 * These are Mapbox canonical category ids, because plain words do not work:
 * the v5 forward geocoder is a place-NAME index, so asking it for "restaurant"
 * returns nothing near you and asking it for "coffee" returns a hamlet called
 * Coffee Hill. The category endpoint on the same Mapbox token answers the
 * question actually being asked. Every id here was checked against a live
 * response — an id Mapbox does not know returns an empty list rather than an
 * error, which is a silent way to ship a channel that never suggests anything.
 */
const CHANNEL_CATEGORY: Record<string, string> = {
  food: 'restaurant',
  live: 'plaza',
  beauty: 'spa',
  sports: 'stadium',
  modelling: 'art_gallery',
  fashion: 'clothing_store',
  music: 'music_venue',
  tech: 'office',
  news: 'plaza',
  french: 'coffee',
  spanish: 'restaurant',
  shopping: 'shopping_mall',
  cartoon: 'art_gallery',
  kids: 'playground',
  comedy: 'theater',
}

/** Words that say a candidate is the KIND of place this channel is about,
 *  tested against the POI's own categories and name. Broader than the single
 *  search category: a music post belongs at a bar as well as at a hall. */
const CHANNEL_MATCH_TERMS: Record<string, readonly string[]> = {
  food: ['restaurant', 'cafe', 'café', 'food', 'bakery', 'bar', 'diner'],
  live: ['plaza', 'square', 'park', 'venue', 'market'],
  beauty: ['spa', 'salon', 'beauty', 'barber', 'nail'],
  sports: ['stadium', 'arena', 'sport', 'sports', 'gym', 'fitness', 'park'],
  modelling: ['gallery', 'art', 'studio', 'plaza', 'landmark'],
  fashion: ['clothing', 'boutique', 'shopping', 'store', 'fashion'],
  music: ['music', 'concert', 'venue', 'nightlife', 'bar', 'club'],
  tech: ['office', 'university', 'college', 'library', 'campus'],
  news: ['plaza', 'square', 'historic', 'government', 'landmark'],
  french: ['cafe', 'café', 'coffee', 'restaurant', 'bakery'],
  spanish: ['restaurant', 'bar', 'market', 'plaza'],
  shopping: ['shopping', 'mall', 'store', 'grocery', 'market'],
  cartoon: ['gallery', 'art', 'museum', 'library'],
  kids: ['playground', 'park', 'school', 'library', 'zoo'],
  comedy: ['theater', 'theatre', 'comedy', 'nightlife', 'bar'],
}

/** The user-facing noun for a channel, used in the reason sentence. */
const CHANNEL_NOUN: Record<string, string> = {
  food: 'food', live: 'live', beauty: 'beauty', sports: 'sports',
  modelling: 'modelling', fashion: 'fashion', music: 'music', tech: 'tech',
  news: 'news', french: 'French', spanish: 'Spanish', shopping: 'shopping',
  cartoon: 'cartoon', kids: 'kids', comedy: 'comedy',
}

/**
 * What the camera read, turned into a kind of place worth searching.
 *
 * Deliberately small and literal. These are the labels an on-device object
 * detector actually emits, and the mapping only claims the obvious ones — a
 * cup of coffee suggests looking at cafes. Anything not here contributes to
 * the RANKING (a POI whose name or category contains the term scores for
 * content fit) without spending a request on a guess.
 */
const SCENE_CATEGORY: Record<string, string> = {
  coffee: 'coffee', cup: 'coffee', mug: 'coffee', espresso: 'coffee', latte: 'coffee',
  pizza: 'restaurant', burger: 'restaurant', sandwich: 'restaurant', food: 'restaurant',
  plate: 'restaurant', bowl: 'restaurant', cake: 'restaurant', wine: 'bar', beer: 'bar',
  dog: 'park', cat: 'park', tree: 'park', bench: 'park', flower: 'park',
  grass: 'park', bird: 'park', bicycle: 'park', skateboard: 'park',
  book: 'library', laptop: 'library', keyboard: 'office',
  guitar: 'music_venue', piano: 'music_venue', microphone: 'music_venue', drum: 'music_venue',
  ball: 'stadium', football: 'stadium', soccer: 'stadium', basketball: 'stadium',
  shirt: 'clothing_store', dress: 'clothing_store', shoe: 'clothing_store',
  handbag: 'clothing_store', tie: 'clothing_store',
  painting: 'art_gallery', sculpture: 'art_gallery', statue: 'art_gallery',
}

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

export function spotDistanceMeters(a: readonly [number, number], b: readonly [number, number]): number {
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Offset a coordinate by a local east/north metre pair. Good to well past any
 *  claim radius the picker can offer, and it keeps the sampling below cheap. */
function offsetMeters(center: readonly [number, number], eastM: number, northM: number): [number, number] {
  const latitude = center[1] + (northM / EARTH_RADIUS_M) * (180 / Math.PI)
  const cosLat = Math.max(0.01, Math.cos(toRad(center[1])))
  const longitude = center[0] + (eastM / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI)
  return [longitude, latitude]
}

/**
 * The share of a prospective claim that no existing pop of yours already
 * covers, in [0, 1].
 *
 * A union of overlapping discs has no tidy closed form, so this samples the
 * candidate disc on four EQUAL-AREA rings — every sample therefore stands for
 * the same amount of ground, and counting them is an area estimate rather than
 * a centre-weighted one. Deterministic, so the same spot always earns the same
 * reason.
 */
export function newGroundFraction(
  center: readonly [number, number],
  claimRadiusKm: number,
  ownClaims: readonly OwnClaim[],
): number {
  if (claimRadiusKm <= 0) return 0
  if (!ownClaims.length) return 1
  const radiusM = claimRadiusKm * 1_000
  const rings = 4
  const spokes = 12
  let uncovered = 0
  let total = 0
  for (let ring = 0; ring < rings; ring += 1) {
    // Equal-area rings: r_i = R * sqrt((i + 0.5) / rings).
    const r = radiusM * Math.sqrt((ring + 0.5) / rings)
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      // Half-step the odd rings so the samples do not line up into spokes.
      const angle = ((spoke + (ring % 2) * 0.5) / spokes) * Math.PI * 2
      const point = offsetMeters(center, Math.cos(angle) * r, Math.sin(angle) * r)
      total += 1
      const covered = ownClaims.some(claim =>
        claim.radiusKm > 0 && spotDistanceMeters(point, claim.coords) <= claim.radiusKm * 1_000)
      if (!covered) uncovered += 1
    }
  }
  return total ? uncovered / total : 0
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/** Does this candidate look like the kind of place the channel is about? */
function channelFit(candidate: SpotCandidate, channelId?: string | null): number {
  const wanted = channelId ? CHANNEL_MATCH_TERMS[channelId] : undefined
  if (!wanted?.length) return 0
  const haystack = new Set([...words(candidate.name), ...candidate.terms.flatMap(words)])
  return wanted.some(term => words(term).every(part => haystack.has(part))) ? 1 : 0
}

/** Does it match what the camera actually saw? Ranked by how confident that
 *  read was: sceneTerms arrives most-confident first. */
function contentFit(candidate: SpotCandidate, sceneTerms?: readonly string[]): { score: number; term: string | null } {
  if (!sceneTerms?.length) return { score: 0, term: null }
  const haystack = new Set([...words(candidate.name), ...candidate.terms.flatMap(words)])
  for (let index = 0; index < sceneTerms.length; index += 1) {
    const parts = words(sceneTerms[index])
    if (parts.length && parts.every(part => haystack.has(part))) {
      return { score: 1 - index * 0.25, term: sceneTerms[index] }
    }
  }
  return { score: 0, term: null }
}

/** Near enough to be a real alternative to where you are standing. Full marks
 *  out to about three claim-widths, then it falls away. */
function reachFit(distanceM: number, claimRadiusKm: number): number {
  const comfortable = Math.max(1_500, Math.max(claimRadiusKm, PROBE_RADIUS_KM) * 1_000 * 3)
  return 1 / (1 + Math.max(0, distanceM - comfortable) / comfortable)
}

function formatDistance(distanceM: number): string {
  return distanceM < 950
    ? `${Math.max(50, Math.round(distanceM / 50) * 50)} m`
    : `${(distanceM / 1_000).toFixed(distanceM < 9_500 ? 1 : 0)} km`
}

function reasonFor(
  newGround: number,
  channel: number,
  content: { score: number; term: string | null },
  channelId: string | null | undefined,
  claimRadiusKm: number,
): string {
  const noun = channelId ? CHANNEL_NOUN[channelId] : undefined
  const fresh = newGround > 0.92
    ? 'None of your pops reach here'
    : claimRadiusKm > 0
      ? `${Math.round(newGround * 100)}% of this claim would be new ground`
      : 'Mostly outside the ground you already hold'
  if (content.score > 0 && content.term) {
    return `${fresh} — and it matches what you shot (${content.term}).`
  }
  if (channel > 0 && noun) {
    return `${fresh} — and it reads as a ${noun} spot.`
  }
  return `${fresh}.`
}

/**
 * Rank candidate places for one capture. Pure: hand it candidates from
 * wherever (the geocoder, curated landmarks, a test) and it returns at most
 * three, best first, each carrying the reason it earned.
 *
 * It returns an empty list rather than a weak one. "Nothing here is new
 * ground" is a true and useful answer, and it is the answer whenever the
 * poster already covers everything around them.
 */
export function rankPostSpots(
  candidates: readonly SpotCandidate[],
  input: SpotSuggestionInput,
): SpotSuggestion[] {
  const seen = new Set<string>()
  return candidates
    .filter(candidate => {
      const key = candidate.name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(candidate => {
      const distanceM = spotDistanceMeters(input.origin, candidate.center)
      const newGround = newGroundFraction(
        candidate.center,
        Math.max(input.claimRadiusKm, PROBE_RADIUS_KM),
        input.ownClaims,
      )
      const channel = channelFit(candidate, input.channelId)
      const content = contentFit(candidate, input.sceneTerms)
      const reach = reachFit(distanceM, input.claimRadiusKm)
      return {
        id: candidate.id,
        name: candidate.name,
        center: candidate.center,
        distanceM,
        newGround,
        score: newGround * 0.55 + channel * 0.2 + content.score * 0.15 + reach * 0.1,
        reason: reasonFor(newGround, channel, content, input.channelId, input.claimRadiusKm),
        distanceLabel: formatDistance(distanceM),
      }
    })
    // The geocoder's bbox is a bias, not a promise. This is the authoritative
    // ceiling, and it reads the live claim rather than the one in force when
    // the candidates were fetched.
    .filter(suggestion => suggestion.distanceM <= spotSearchRadiusKm(input.claimRadiusKm) * 1_000)
    .filter(suggestion => suggestion.newGround >= MIN_NEW_GROUND)
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM)
    .reduce<SpotSuggestion[]>((chosen, suggestion) => {
      if (chosen.length >= MAX_SUGGESTIONS) return chosen
      // Three cafes on the same block are one suggestion wearing three names:
      // their claims cover the same ground, so choosing between them changes
      // nothing about the territory won. Judge that with the same coverage
      // math the ranking runs on — a candidate mostly inside an already-chosen
      // claim is not a second option.
      const distinct = newGroundFraction(
        suggestion.center,
        Math.max(input.claimRadiusKm, PROBE_RADIUS_KM),
        chosen.map(taken => ({
          coords: taken.center,
          radiusKm: Math.max(input.claimRadiusKm, PROBE_RADIUS_KM),
        })),
      )
      if (distinct < MIN_DISTINCT_GROUND) return chosen
      return [...chosen, suggestion]
    }, [])
}

/**
 * The Mapbox categories to search for one draft: the channel read as a kind of
 * place, then whatever the camera saw that maps to one. Each becomes ONE
 * request, so this is hard-capped at two.
 */
export function spotSearchQueries(input: Pick<SpotSuggestionInput, 'channelId' | 'sceneTerms'>): string[] {
  const queries: string[] = []
  const channelCategory = input.channelId ? CHANNEL_CATEGORY[input.channelId] : undefined
  if (channelCategory) queries.push(channelCategory)
  for (const term of input.sceneTerms ?? []) {
    const sceneCategory = SCENE_CATEGORY[term.trim().toLowerCase()]
    if (sceneCategory) { queries.push(sceneCategory); break }
  }
  // Nothing known about the draft at all (the standalone picker, or a draft
  // that skipped both the channel and Scan). Somewhere people gather is a
  // better guess than nothing, and new ground still does the real ranking.
  if (!queries.length) queries.push('park')
  return [...new Set(queries)].slice(0, 2)
}
