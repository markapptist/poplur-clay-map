// The tour's brain: what the AI knows about a stop when it lands there.
//
// Every stop kind gets a SMART CARD — something concrete the host can show and
// say, beyond "Now at X": live-shaped sports scores at an arena, a sale at a
// store inside a mall (with a working outbound link), the next departures at a
// station or airport, the right dish at a food stop for this hour of this day,
// and a grounded tip everywhere else.
//
// Nothing here calls a network. Real event/venue APIs land with the rest of
// the live data (Aug 2026); until then the cards are generated — but
// DETERMINISTICALLY, seeded by stop id + calendar slot, so the same visit
// shows one coherent story (a game's score even advances between periods if
// you linger) instead of rerolling nonsense on every render. The generator is
// the contract: when the real feed arrives it fills the same SmartCard shape
// and nothing downstream changes.

export interface SmartStop {
  id: string
  name: string
  kind: string
  coords: [number, number]
}

export interface SmartCardRow {
  label: string
  value: string
}

export interface SmartCard {
  /** which picture the card leads with */
  icon: 'score' | 'sale' | 'departures' | 'dish' | 'tip'
  title: string
  headline: string
  rows?: SmartCardRow[]
  /** what the AI host speaks on arrival */
  line: string
  link?: { label: string; url: string }
}

// Deterministic per (stop, hour-slot, weekday): stable while you dwell,
// different when you come back tomorrow.
function seedFor(id: string, when: Date, slotMinutes = 60): number {
  const slot = Math.floor((when.getHours() * 60 + when.getMinutes()) / slotMinutes)
  const key = `${id}|${when.getDay()}|${slot}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(list: readonly T[], seed: number, salt = 0): T {
  return list[(seed + salt * 2654435761) % list.length]
}

// ── city awareness ──────────────────────────────────────────────────────────
// Coarse: nearest metro from coordinates. Only cities the tour actually
// visits; everywhere else gets honest generic copy rather than a wrong team.
const METROS: ReadonlyArray<{ city: string; at: [number, number]; teams?: [string, string][]; lines?: string[] }> = [
  { city: 'Toronto', at: [-79.38, 43.65], teams: [['Raptors', 'Celtics'], ['Maple Leafs', 'Canadiens'], ['TFC', 'Whitecaps'], ['Blue Jays', 'Yankees']], lines: ['UP Express — Pearson', 'GO Lakeshore West', 'GO Lakeshore East', 'Line 1 — Vaughan'] },
  { city: 'New York', at: [-74.0, 40.71], teams: [['Knicks', 'Nets'], ['Rangers', 'Islanders'], ['Yankees', 'Red Sox']], lines: ['Hudson Line — Poughkeepsie', 'Harlem Line — Southeast', 'New Haven Line — Stamford'] },
  { city: 'London', at: [-0.12, 51.5], teams: [['Arsenal', 'Spurs'], ['Chelsea', 'West Ham'], ['England', 'Wales']], lines: ['Elizabeth Line — Heathrow', 'Victoria — Brixton', 'Jubilee — Stratford'] },
  { city: 'Los Angeles', at: [-118.3, 34.02], teams: [['Lakers', 'Warriors'], ['Rams', '49ers'], ['Kings', 'Sharks'], ['Dodgers', 'Padres']], lines: ['A Line — Long Beach', 'B Line — North Hollywood', 'Metrolink — San Bernardino'] },
  { city: 'Seattle', at: [-122.33, 47.6], teams: [['Kraken', 'Canucks'], ['Mariners', 'Astros'], ['Sounders', 'Timbers']], lines: ['1 Line — Angle Lake', 'Sounder North — Everett'] },
  { city: 'Chicago', at: [-87.63, 41.88], teams: [['Bulls', 'Bucks'], ['Cubs', 'Cardinals'], ['Bears', 'Packers']], lines: ['Red Line — Howard', 'Blue Line — O’Hare', 'Metra UP-N — Kenosha'] },
]

function metroFor(coords: [number, number]) {
  let best = METROS[0]
  let bestD = Infinity
  for (const m of METROS) {
    const d = (m.at[0] - coords[0]) ** 2 + (m.at[1] - coords[1]) ** 2
    if (d < bestD) { bestD = d; best = m }
  }
  // ~3 degrees ≈ close enough to claim the metro; beyond that, generic.
  return bestD < 9 ? best : null
}

// ── kind builders ───────────────────────────────────────────────────────────

const PERIOD_BY_SPORT: Record<string, string[]> = {
  default: ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter'],
  hockey: ['1st period', '2nd period', '3rd period'],
  soccer: ['first half', 'second half'],
  baseball: ['3rd inning', '5th inning', '7th inning', '9th inning'],
}

function sportsCard(stop: SmartStop, when: Date, seed: number): SmartCard {
  const metro = metroFor(stop.coords)
  const [home, away] = metro?.teams ? pick(metro.teams, seed) : ['the home side', 'the visitors']
  const hockey = /Leafs|Canadiens|Rangers|Islanders|Kings|Sharks|Kraken|Canucks/.test(home + away)
  const soccer = /TFC|Whitecaps|Arsenal|Spurs|Chelsea|West Ham|Sounders|Timbers|England|Wales/.test(home + away)
  const baseball = /Blue Jays|Yankees|Red Sox|Mariners|Astros|Cubs|Cardinals|Dodgers|Padres/.test(home + away)
  const periods = hockey ? PERIOD_BY_SPORT.hockey
    : soccer ? PERIOD_BY_SPORT.soccer
    : baseball ? PERIOD_BY_SPORT.baseball
    : PERIOD_BY_SPORT.default
  // The game advances through the evening: period follows the actual clock
  // within a 3-hour window seeded to this stop, so lingering long enough
  // genuinely moves the game along.
  const phase = Math.floor(((when.getMinutes() + (seed % 60)) / 60) * periods.length) % periods.length
  const period = periods[phase]
  const base = soccer ? 1 : hockey ? 2 : baseball ? 2 : 24
  const spread = soccer ? 2 : hockey ? 3 : 12
  const homeScore = base + ((seed >>> 3) % spread) + phase * (soccer ? 0 : hockey ? 1 : baseball ? 2 : 8)
  const awayScore = Math.max(0, homeScore - 1 - ((seed >>> 7) % (soccer ? 2 : hockey ? 2 : baseball ? 3 : 9)))
  return {
    icon: 'score',
    title: stop.name,
    headline: `${home} vs ${away}`,
    rows: [
      { label: home, value: String(homeScore) },
      { label: away, value: String(awayScore) },
      { label: 'Now', value: period },
    ],
    line: `Tonight at ${stop.name}: ${home} against ${away} — ${home} lead ${homeScore} to ${awayScore} in the ${period}.`,
  }
}

const MALL_STORES = ['Uniqlo', 'Foot Locker', 'Sephora', 'the LEGO Store', 'Zara', 'H&M', 'Lush', 'Muji', 'Nike', 'the Apple Store'] as const

function mallCard(stop: SmartStop, when: Date, seed: number): SmartCard {
  const store = pick(MALL_STORES, seed)
  const pct = 20 + ((seed >>> 4) % 7) * 5 // 20–50%
  const until = when.getHours() < 17 ? 'until 6 tonight' : 'until close'
  // A live outbound link without inventing a promo URL: search the store's
  // sale. Real destination, honest about being a lookup.
  const q = encodeURIComponent(`${store.replace(/^the /, '')} sale`)
  return {
    icon: 'sale',
    title: stop.name,
    headline: `SALE at ${store}`,
    rows: [{ label: 'Today', value: `up to ${pct}% off, ${until}` }],
    line: `Inside ${stop.name} right now: ${store} is running up to ${pct} percent off, ${until}.`,
    link: { label: 'VIEW SALE ↗', url: `https://www.google.com/search?q=${q}` },
  }
}

function departuresCard(stop: SmartStop, when: Date, seed: number, flavor: 'trains' | 'flights'): SmartCard {
  const metro = metroFor(stop.coords)
  const lines = flavor === 'flights'
    ? ['Vancouver', 'Montreal', 'San Francisco', 'Heathrow', 'Tokyo Haneda', 'Mexico City'].map((d, i) => `${pick(['AC', 'WS', 'BA', 'UA', 'DL', 'NH'] as const, seed, i)} ${100 + ((seed >>> (i + 2)) % 800)} — ${d}`)
    : (metro?.lines ?? ['Northbound local', 'Southbound local', 'Airport express'])
  // Next three departures, walking forward from NOW in seeded 6–18 minute
  // steps — a schedule that is always "about to happen", which is what a
  // departure board is.
  const rows: SmartCardRow[] = []
  let t = when.getTime()
  for (let i = 0; i < 3; i++) {
    t += (6 + ((seed >>> (i * 3)) % 13)) * 60_000
    const d = new Date(t)
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    rows.push({ label: pick(lines, seed, i), value: `${hh}:${mm}` })
  }
  const noun = flavor === 'flights' ? 'departures' : 'trains'
  return {
    icon: 'departures',
    title: stop.name,
    headline: `Next ${noun}`,
    rows,
    line: `From ${stop.name}, the next ${noun}: ${rows.map(r => `${r.label} at ${r.value}`).join(', ')}.`,
  }
}

const DISHES: Record<string, string[]> = {
  morning: ['the breakfast bao', 'a cardamom bun and flat white', 'the smoked-salmon bagel', 'huevos rancheros'],
  lunch: ['the birria tacos', 'the porchetta sandwich', 'a lobster roll', 'the mushroom banh mi'],
  dinner: ['the wood-oven margherita', 'the miso black cod', 'the short-rib pappardelle', 'the whole branzino'],
  late: ['the smash burger', 'late-night ramen', 'the halloumi wrap', 'churros with dark chocolate'],
}

function dishCard(stop: SmartStop, when: Date, seed: number): SmartCard {
  const h = when.getHours()
  const slot = h < 11 ? 'morning' : h < 15 ? 'lunch' : h < 22 ? 'dinner' : 'late'
  const dish = pick(DISHES[slot], seed)
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][when.getDay()]
  const special = (seed >>> 9) % 3 === 0
  const reason = special
    ? `it's the ${day} special`
    : slot === 'morning' ? 'they bake at dawn and it goes fast'
    : slot === 'late' ? 'the late kitchen does it best'
    : 'the stalls sell through it by mid-afternoon'
  return {
    icon: 'dish',
    title: stop.name,
    headline: `Order ${dish}`,
    rows: [{ label: day, value: special ? 'special today' : `best at ${slot === 'morning' ? 'breakfast' : slot}` }],
    line: `At ${stop.name}, order ${dish} — ${reason}.`,
  }
}

const TIPS: ReadonlyArray<(stop: SmartStop) => { headline: string; line: string }> = [
  s => ({ headline: 'Best light in an hour', line: `${s.name} photographs best from the north side — the light turns golden within the hour.` }),
  s => ({ headline: 'Skip the main queue', line: `At ${s.name}, the side entrance clears twice as fast as the main queue right now.` }),
  s => ({ headline: 'Quietest right now', line: `${s.name} is quietest at this hour — a good moment to actually look around.` }),
]

function tipCard(stop: SmartStop, seed: number): SmartCard {
  const t = pick(TIPS, seed)(stop)
  return { icon: 'tip', title: stop.name, headline: t.headline, line: t.line }
}

/** The card for this stop, right now. Never throws; always returns a card. */
export function smartCardFor(stop: SmartStop, when: Date = new Date()): SmartCard {
  const seed = seedFor(stop.id, when)
  switch (stop.kind) {
    case 'arena':
    case 'event':
      return sportsCard(stop, when, seed)
    case 'mall':
      return mallCard(stop, when, seed)
    case 'transit':
      return departuresCard(stop, when, seed, 'trains')
    case 'airport':
      return departuresCard(stop, when, seed, 'flights')
    case 'food':
      return dishCard(stop, when, seed)
    default:
      return tipCard(stop, seed)
  }
}

// ── the feed's version of smart ─────────────────────────────────────────────
// The same brain pointed at what you are WATCHING instead of where you are
// standing: each feed channel maps to the builder that suits its genre, so
// the suggestion under a food post is the dish to order right now, under a
// sports post the live score, under a shopping post the sale with a link.
// The feed is sampled in the app's home market, so suggestions anchor there
// until posts carry their own coordinates.

export interface FeedChannelLike {
  id: string
  name: string
  user?: string
  caption?: string
}

const FEED_ANCHOR: [number, number] = [-79.38, 43.65]

const FEED_KIND: Record<string, { kind: string; place: string }> = {
  food: { kind: 'food', place: 'the spot in this post' },
  spanish: { kind: 'food', place: 'the taqueria in this post' },
  french: { kind: 'food', place: 'the café in this post' },
  sports: { kind: 'arena', place: 'the arena downtown' },
  shopping: { kind: 'mall', place: 'the shops near you' },
  fashion: { kind: 'mall', place: 'the shops near you' },
  beauty: { kind: 'mall', place: 'the shops near you' },
}

/**
 * A suggestion for the post you are watching. Unlike the tour card this is a
 * quiet offer, not an announcement — the feed has its own soundtrack, so the
 * card renders and never speaks (its `line` is available if a host wants it).
 */
export function feedSuggestionFor(channel: FeedChannelLike, when: Date = new Date()): SmartCard {
  const mapped = FEED_KIND[channel.id]
  const stop: SmartStop = {
    id: `feed-${channel.id}`,
    name: mapped?.place ?? `this ${channel.name.toLowerCase()} post`,
    kind: mapped?.kind ?? 'feed',
    coords: FEED_ANCHOR,
  }
  if (mapped) return smartCardFor(stop, when)
  // Genres without a natural score/sale/dish still get a real offer: a
  // grounded next step for the post itself, seeded like everything else.
  const seed = seedFor(stop.id, when)
  const ideas: ReadonlyArray<{ headline: string; line: string }> = [
    { headline: 'Post yours from here', line: `${channel.user ?? 'This creator'} is in your radius — a reply post from your block lands on the same channel.` },
    { headline: 'Peak hour soon', line: `CH ${channel.name} runs hottest after dark in your radius — a post now rides the wave up.` },
    { headline: 'Nearby right now', line: 'Three pops within 2 km are on this channel today — worth a look before they decay.' },
  ]
  const idea = ideas[seed % ideas.length]
  return { icon: 'tip', title: `CH ${channel.name.toUpperCase()}`, headline: idea.headline, line: idea.line }
}
