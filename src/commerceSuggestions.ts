import type { Detection } from './mlDetect'
import type { SmartCard } from './tourSmarts'

type Creative = Pick<SmartCard, 'media' | 'sponsor' | 'badge' | 'channelTag' | 'accent' | 'accent2'>

const CHANNEL_NUMBER: Record<string, string> = {
  food: '101', music: '102', cartoon: '103', sports: '104', kids: '105',
  shopping: '106', comedy: '107', spanish: '108', french: '109',
}

const CHANNEL_LOOK: Record<string, { accent: string; accent2: string; badge: string }> = {
  food: { accent: '#e93635', accent2: '#ffd64d', badge: 'YUM! DEAL' },
  music: { accent: '#8e3cf0', accent2: '#ff4ca6', badge: 'TONIGHT!' },
  cartoon: { accent: '#2c8df3', accent2: '#fff35a', badge: 'KAPOW!' },
  sports: { accent: '#087f3e', accent2: '#65ff98', badge: 'LIVE NOW' },
  kids: { accent: '#ff7b20', accent2: '#ffe459', badge: 'FAMILY PICK' },
  shopping: { accent: '#d4126e', accent2: '#65dcff', badge: 'SALE!' },
  comedy: { accent: '#ffb000', accent2: '#ff4f88', badge: 'HOT TICKET' },
  spanish: { accent: '#e94b28', accent2: '#ffe04f', badge: 'OFERTA!' },
  french: { accent: '#2449c7', accent2: '#ff6aa8', badge: 'BON PLAN!' },
}

function channelAsset(channel: string) {
  const safe = Object.prototype.hasOwnProperty.call(CHANNEL_LOOK, channel) ? channel : 'shopping'
  const video = safe === 'spanish' ? 'feed/ad-spanish-1.mp4' : `feed/ad-${safe}.mp4`
  const poster = safe === 'spanish' ? 'feed/posters/ad-spanish-1.jpg' : `feed/posters/ad-${safe}.jpg`
  return { safe, video, poster, look: CHANNEL_LOOK[safe] ?? CHANNEL_LOOK.shopping }
}

function creative(channel: string, overrides: Partial<Creative> = {}): Creative {
  const { safe, video, poster, look } = channelAsset(channel)
  return {
    media: { kind: 'video', src: video, poster, alt: `${safe} highlight` },
    sponsor: 'Poplur Shopping Network',
    badge: look.badge,
    channelTag: `SHOP TV · CH ${CHANNEL_NUMBER[safe] ?? '106'}`,
    accent: look.accent,
    accent2: look.accent2,
    ...overrides,
  }
}

export function decorateFeedSuggestion(card: SmartCard, channel: string): SmartCard {
  return {
    ...card,
    ...creative(channel, {
      sponsor: `Sponsored · CH ${CHANNEL_NUMBER[channel] ?? '106'}`,
      channelTag: `POPLUR AD BREAK · CH ${CHANNEL_NUMBER[channel] ?? '106'}`,
    }),
  }
}

export interface MapPinSuggestionInput {
  id: string
  user: string | null
  name: string
  radiusKm: number
  channel?: string
  media?: SmartCard['media']
  mine: boolean
}

/** User upload first; bundled, approved channel creative is the place fallback. */
export function suggestionForMapPin(pin: MapPinSuggestionInput): SmartCard {
  const channel = pin.channel ?? 'shopping'
  const userLabel = pin.user ?? 'Your post'
  const base = creative(channel, {
    media: pin.media ?? creative(channel).media,
    sponsor: pin.user ? `Creator spotlight · ${pin.user}` : `Local spotlight · ${pin.name}`,
    badge: pin.user ? 'TRENDING!' : 'NEAR YOU!',
    channelTag: `POPLUR LIVE · CH ${CHANNEL_NUMBER[channel] ?? '106'}`,
  })
  return {
    icon: channel === 'sports' ? 'score' : channel === 'shopping' ? 'sale' : 'tip',
    title: pin.name,
    headline: pin.user ? `${pin.user} is trending here` : `${pin.name} is heating up`,
    rows: [
      { label: 'RADIUS', value: `${pin.radiusKm.toFixed(1)} km` },
      { label: 'SOURCE', value: pin.media ? 'uploaded post' : 'place highlight' },
    ],
    line: `${userLabel} is trending at ${pin.name}, reaching ${pin.radiusKm.toFixed(1)} kilometres.`,
    ...base,
  }
}

export interface MapPlaceSuggestionInput {
  id: string
  name: string
  radiusKm: number
  likes: number
  category: 'food' | 'park' | 'shop' | 'arts' | 'nightlife'
  channel: string
}

function webSearch(query: string, shopping = false): string {
  const section = shopping ? '&tbm=shop' : ''
  return `https://www.google.com/search?igu=1${section}&q=${encodeURIComponent(query)}`
}

export function suggestionForMapPlace(place: MapPlaceSuggestionInput): SmartCard {
  const category: Record<MapPlaceSuggestionInput['category'], {
    headline: string; row: string; badge: string; query: string; shopping?: boolean
  }> = {
    food: { headline: `Today's picks at ${place.name}`, row: 'menus + local deals', badge: 'YUM! DEAL', query: `${place.name} restaurant deals menu` },
    shop: { headline: `Sales around ${place.name}`, row: 'shops on sale now', badge: 'KAPOW! SALE', query: `${place.name} stores sales deals`, shopping: true },
    nightlife: { headline: `Tonight near ${place.name}`, row: 'tickets + tables', badge: 'TONIGHT!', query: `${place.name} events tonight tickets` },
    arts: { headline: `What to see at ${place.name}`, row: 'exhibits + tickets', badge: 'MUST SEE!', query: `${place.name} exhibits tickets` },
    park: { headline: `What is on at ${place.name}`, row: 'free nearby picks', badge: 'FREE!', query: `${place.name} events today` },
  }
  const copy = category[place.category]
  return {
    icon: place.category === 'shop' ? 'sale' : place.category === 'food' ? 'dish' : 'tip',
    title: place.name,
    headline: copy.headline,
    rows: [
      { label: 'TRENDING', value: `${place.likes} recent pops` },
      { label: 'WHAT TO FIND', value: copy.row },
    ],
    line: `${place.name} is trending with ${place.likes} recent pops.`,
    link: { label: 'SEE WHAT IS ON', url: webSearch(copy.query, copy.shopping) },
    ...creative(place.channel, {
      sponsor: `Local spotlight · ${place.name}`,
      badge: copy.badge,
      channelTag: `NEARBY TV · CH ${CHANNEL_NUMBER[place.channel] ?? '106'}`,
    }),
  }
}

type ItemOffer = {
  match: RegExp
  name: string
  sponsor: string
  channel: string
  url: string
  badge: string
}

// These are destinations, not invented live prices. A production resolver can
// replace this table with licensed, attributed inventory without changing UI.
const ITEM_OFFERS: ItemOffer[] = [
  { match: /cell phone|phone|mobile/i, name: 'phones', sponsor: 'Apple', channel: 'shopping', url: 'https://www.apple.com/iphone/', badge: 'SHOP NOW' },
  { match: /laptop|computer/i, name: 'laptops', sponsor: 'Apple', channel: 'shopping', url: 'https://www.apple.com/macbook-air/', badge: 'COMPARE!' },
  { match: /screen|television|\btv\b/i, name: 'screens', sponsor: 'Best Buy', channel: 'shopping', url: 'https://www.bestbuy.ca/en-ca/category/televisions/21344', badge: 'BIG SCREEN!' },
  { match: /keyboard/i, name: 'keyboards', sponsor: 'Logitech', channel: 'shopping', url: 'https://www.logitech.com/en-ca/products/keyboards.html', badge: 'TYPE THIS!' },
  { match: /bottle|cup|mug/i, name: 'drinkware', sponsor: 'YETI', channel: 'food', url: 'https://www.yeti.ca/drinkware', badge: 'HOT PICK' },
  { match: /chair|couch|sofa/i, name: 'seating', sponsor: 'IKEA', channel: 'shopping', url: 'https://www.ikea.com/ca/en/cat/furniture-fu001/', badge: 'ROOM DEAL' },
  { match: /book/i, name: 'books', sponsor: 'Indigo', channel: 'cartoon', url: 'https://www.indigo.ca/en-ca/books/', badge: 'READ THIS!' },
  { match: /backpack|bag/i, name: 'backpacks', sponsor: 'Nike', channel: 'sports', url: 'https://www.nike.com/ca/w?q=backpack', badge: 'GEAR UP!' },
  { match: /bicycle|bike/i, name: 'bikes', sponsor: 'Trek', channel: 'sports', url: 'https://www.trekbikes.com/ca/en_CA/bikes/c/B100/', badge: 'RIDE!' },
  { match: /car|vehicle/i, name: 'cars', sponsor: 'AutoTrader', channel: 'sports', url: 'https://www.autotrader.ca/', badge: 'FOUND IT!' },
  { match: /barcode|qr code/i, name: 'this item', sponsor: 'Shopping results', channel: 'shopping', url: 'https://www.google.com/search?igu=1&tbm=shop&q=barcode+product', badge: 'SCAN & SHOP' },
]

export function purchaseSuggestionForDetection(detection: Detection): SmartCard | null {
  if (detection.user || detection.confidence < 0.72) return null
  const offer = ITEM_OFFERS.find(item => item.match.test(detection.label))
  if (!offer) return null
  return {
    icon: 'sale',
    title: detection.label.toUpperCase(),
    headline: `Shop ${offer.name}`,
    rows: [
      { label: 'MATCH', value: `${Math.round(detection.confidence * 100)}%` },
      { label: 'RESULTS', value: `from ${offer.sponsor}` },
    ],
    line: `I found shopping results for ${offer.name}.`,
    link: { label: `SHOP ${offer.name}`, url: offer.url },
    ...creative(offer.channel, {
      sponsor: `Sponsored · ${offer.sponsor}`,
      badge: offer.badge,
      channelTag: 'CAMERA SHOP · LIVE SEARCH',
    }),
  }
}
