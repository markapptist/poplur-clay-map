import React, { useRef, useState, useCallback, useEffect } from 'react'
import mapboxgl from 'mapbox-gl'
import { POIS, MAP_THEMES } from './data'
import ClayMap, { MAP_2D, MAP_LITE, installComposeRadiusPreview, updateComposeRadiusPreview } from './ClayMap'
import { setMapMode } from './mapMode'
import ClayNav from './ClayNav'
import TopChrome from './TopChrome'
import ClayCornerButton from './ClayCornerButton'
import WeatherFX, { modeForCode } from './WeatherFX'
import { modelSprite } from './modelSprite'
import type { WeatherMode } from './WeatherFX'
import ViewHarness, { harnessViewFromLocation } from './ViewHarness'
// The map's radio is gone — the AI voice is the map's only spoken audio now.
// The live-station stream, the wav bed and the stingers all lived in mapRadio;
// the tour host line goes through the shared voice surface instead, which
// already owns focus correctly (Feed stays muted while it talks, reclaims
// after). RadioStationCue survives as a local type: the native tourStop
// payload still carries station cues for the iOS AI stack (PoplurAIStack reads
// stationName), which is data, not web playback.
import { cancelVoiceSpeech, speakWithVoiceAudioFocus } from './voiceAudio'

interface RadioStationCue {
  name: string
  frequency?: string
  style?: string
}
import {
  normalizeMapTourTopics,
  readMapTourTopics,
  writeMapTourTopics,
  type MapTourTopic,
} from './mapTourPreferences'
import {
  stopRegionAudio,
  startPoplurTheme, stopPoplurTheme, setVoiceDucked,
} from './regionAudio'
import { postNativeEvent } from './nativeBridge'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { onAudioFocusChange } from './audioFocus'
import { playPop } from './pop'
import VolumeBars from './VolumeBars'
import ClayMuteButton from './ClayMuteButton'
import styles from './App.module.css'


const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string

// Clay weather icons keyed by open-meteo weather codes
// Clay-shaded weather icons: each body is filled with a soft radial "shader"
// gradient plus a specular highlight, so they read as moulded clay like the
// wordmark and pins rather than flat vector fills.
const SHADERS = `
<radialGradient id="wSun" cx="36%" cy="30%" r="76%">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset="0.55" stop-color="#FFD23F"/><stop offset="1" stop-color="#E8A200"/>
</radialGradient>
<radialGradient id="wCloud" cx="34%" cy="28%" r="82%">
  <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#FDEBF4"/><stop offset="1" stop-color="#D9C3D2"/>
</radialGradient>
<radialGradient id="wDark" cx="34%" cy="26%" r="84%">
  <stop offset="0" stop-color="#CFC3CC"/><stop offset="0.6" stop-color="#A99CA6"/><stop offset="1" stop-color="#7C7079"/>
</radialGradient>
<linearGradient id="wDrop" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8FDBFF"/><stop offset="1" stop-color="#2C8FD6"/>
</linearGradient>
<radialGradient id="wIce" cx="34%" cy="28%" r="80%">
  <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#A9C6D8"/>
</radialGradient>
<linearGradient id="wBolt" x1="0" y1="0" x2="0.4" y2="1">
  <stop offset="0" stop-color="#FFE787"/><stop offset="1" stop-color="#F0A500"/>
</linearGradient>
`
const gloss = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="0.45"/>`

const SUN_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g stroke="#E8A200" stroke-width="3" stroke-linecap="round" opacity="0.95"><path d="M20 3v5M20 32v5M3 20h5M32 20h5M8 8l3.5 3.5M28.5 28.5L32 32M32 8l-3.5 3.5M11.5 28.5L8 32"/></g><circle cx="20" cy="20" r="10" fill="url(#wSun)" stroke="#D08F00" stroke-width="0.8"/>${gloss(16, 15.5, 3.6, 2.6)}</svg>`
const CLOUD_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><ellipse cx="16" cy="24" rx="11" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/><ellipse cx="27" cy="21" rx="10" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/>${gloss(13, 20, 3.6, 2.2)}</svg>`
const RAIN_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wDrop)"><path d="M13 25c1.6 2.4 2.6 3.8 2.6 5a2.6 2.6 0 1 1-5.2 0c0-1.2 1-2.6 2.6-5z"/><path d="M20 28c1.6 2.4 2.6 3.8 2.6 5a2.6 2.6 0 1 1-5.2 0c0-1.2 1-2.6 2.6-5z"/><path d="M27 25c1.6 2.4 2.6 3.8 2.6 5a2.6 2.6 0 1 1-5.2 0c0-1.2 1-2.6 2.6-5z"/></g><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`
const SNOW_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wIce)" stroke="#8FB2C6" stroke-width="0.7"><circle cx="13" cy="30" r="2.9"/><circle cx="21" cy="33" r="2.9"/><circle cx="28" cy="29" r="2.9"/></g><ellipse cx="20" cy="16" rx="12" ry="8" fill="url(#wCloud)" stroke="#C8AFC0" stroke-width="0.8"/>${gloss(15, 12.5, 4, 2.4)}</svg>`
const STORM_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><path d="M20 20 L15 30 L20 29 L17 38 L26 26 L21 27 L24 20 Z" fill="url(#wBolt)" stroke="#C98A00" stroke-width="0.8" stroke-linejoin="round"/><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wDark)" stroke="#6C616A" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`
const THUNDER_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wDrop)"><path d="M14 26c1.4 2.1 2.3 3.3 2.3 4.4a2.3 2.3 0 1 1-4.6 0c0-1.1.9-2.3 2.3-4.4z"/><path d="M26 26c1.4 2.1 2.3 3.3 2.3 4.4a2.3 2.3 0 1 1-4.6 0c0-1.1.9-2.3 2.3-4.4z"/></g><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wDark)" stroke="#6C616A" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`
const HAIL_ICON = `<svg viewBox="0 0 40 40"><defs>${SHADERS}</defs><g fill="url(#wIce)" stroke="#7E97A8" stroke-width="0.9"><circle cx="13" cy="29" r="3.1"/><circle cx="21" cy="33" r="3.1"/><circle cx="28" cy="28" r="3.1"/></g><ellipse cx="20" cy="14" rx="12" ry="8" fill="url(#wDark)" stroke="#6C616A" stroke-width="0.8"/>${gloss(15, 10.5, 4, 2.4)}</svg>`

/** Icon follows the rendered weather mode, so previewing a mode updates it too. */
// Fahrenheit is the local habit in the US (plus a handful of territories);
// everyone else reads Celsius.
function usesFahrenheit(): boolean {
  if (typeof window === 'undefined') return false
  const locale = navigator.languages?.[0] ?? navigator.language ?? 'en-CA'
  try {
    const region = new Intl.Locale(locale).region ?? ''
    return ['US', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'LR', 'PR', 'GU', 'VI'].includes(region)
  } catch {
    return /-US$/i.test(locale)
  }
}

function weatherIconForMode(mode: WeatherMode): string {
  switch (mode) {
    case 'clear': return SUN_ICON
    case 'cloudy':
    case 'fog': return CLOUD_ICON
    case 'rain': return RAIN_ICON
    case 'thunder': return THUNDER_ICON
    case 'storm': return STORM_ICON
    case 'snow': return SNOW_ICON
    case 'hail': return HAIL_ICON
  }
}

// Brand-identity volume mark: clay-pink speaker with sound waves. Shown beside
// the AI line whenever audio is playing.
const VOLUME_ICON = `<svg viewBox="0 0 32 32"><path d="M6 12h4l6-5v18l-6-5H6z" fill="#F63B9A" stroke="#c92e7d" stroke-width="1.4" stroke-linejoin="round"/><path d="M21 11.5a7 7 0 0 1 0 9" fill="none" stroke="#FF8AC6" stroke-width="2.6" stroke-linecap="round"/><path d="M25 8.5a11.5 11.5 0 0 1 0 15" fill="none" stroke="#FF4BA1" stroke-width="2.6" stroke-linecap="round"/></svg>`
// Muted twin of the mark: same clay speaker, waves replaced by a slash.
const VOLUME_MUTED_ICON = `<svg viewBox="0 0 32 32"><path d="M6 12h4l6-5v18l-6-5H6z" fill="#F63B9A" stroke="#c92e7d" stroke-width="1.4" stroke-linejoin="round"/><path d="M21 11l9 10M30 11l-9 10" fill="none" stroke="#FF8AC6" stroke-width="2.6" stroke-linecap="round"/></svg>`
const LOCATE_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9.5" fill="none" stroke="#FF8AC6" stroke-width="2.2"/><circle cx="16" cy="16" r="3.2" fill="#F63B9A"/><path d="M16 3v5M16 24v5M3 16h5M24 16h5" stroke="#FFF2F8" stroke-width="2.2" stroke-linecap="round"/></svg>`
const STREET_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 25 C10 19 12 13 16 7 C20 13 22 19 26 25" fill="none" stroke="#FFF2F8" stroke-width="2.2" stroke-linecap="round"/><path d="M16 9 L16 13M16 17 L16 21M16 25 L16 27" stroke="#F63B9A" stroke-width="2.3" stroke-linecap="round"/><path d="M8 25H24" stroke="#FF8AC6" stroke-width="2" stroke-linecap="round"/></svg>`

type TourKind =
  | 'landmark'
  | 'mall'
  | 'arena'
  | 'school'
  | 'museum'
  | 'park'
  | 'district'
  | 'venue'
  | 'food'
  | 'event'
  | 'airport'
  | 'themepark'
  | 'casino'
  | 'hotel'

interface TourDestination {
  id: string
  name: string
  kind: TourKind
  coords: [number, number]
}

interface RadioStation extends RadioStationCue {
  frequency: string
  style: string
}

const TOUR_KIND_LABEL: Record<TourKind, string> = {
  landmark: 'landmark',
  mall: 'mall',
  arena: 'arena',
  school: 'campus',
  museum: 'museum',
  park: 'park',
  district: 'district',
  venue: 'venue',
  food: 'food spot',
  event: 'local event',
  airport: 'airport',
  themepark: 'theme park',
  casino: 'casino',
  hotel: 'hotel',
}

const TOUR_TOPIC_FOR_KIND: Record<TourKind, MapTourTopic> = {
  landmark: 'landmarks',
  museum: 'landmarks',
  park: 'landmarks',
  mall: 'malls',
  arena: 'sports',
  school: 'universities',
  district: 'downtown',
  venue: 'events',
  food: 'food',
  event: 'events',
  airport: 'airports',
  themepark: 'themeParks',
  casino: 'casinos',
  hotel: 'hotels',
}

const RADIO_MARKETS: Record<string, RadioStation[]> = {
  toronto: [
    { name: 'CBC Music Toronto', frequency: '94.1 FM', style: 'local arts' },
    { name: 'KiSS 92.5', frequency: '92.5 FM', style: 'pop hits' },
    { name: 'FLOW 98.7', frequency: '98.7 FM', style: 'hip-hop and R&B' },
  ],
  paris: [
    { name: 'FIP Paris', frequency: '105.1 FM', style: 'eclectic' },
    { name: 'Radio Nova', frequency: '101.5 FM', style: 'global grooves' },
    { name: 'France Inter', frequency: '87.8 FM', style: 'culture' },
  ],
  london: [
    { name: 'BBC Radio London', frequency: '94.9 FM', style: 'city news' },
    { name: 'Capital London', frequency: '95.8 FM', style: 'pop hits' },
    { name: 'Kiss Fresh', frequency: 'DAB', style: 'dance and R&B' },
  ],
  newyork: [
    { name: 'Hot 97', frequency: '97.1 FM', style: 'hip-hop' },
    { name: 'Z100', frequency: '100.3 FM', style: 'pop hits' },
    { name: 'WNYC', frequency: '93.9 FM', style: 'city talk' },
  ],
  cairo: [
    { name: 'Nile FM', frequency: '104.2 FM', style: 'international hits' },
    { name: 'Nogoum FM', frequency: '100.6 FM', style: 'Arabic pop' },
    { name: 'Radio Masr', frequency: '88.7 FM', style: 'local talk' },
  ],
  rio: [
    { name: 'Rádio Globo Rio', frequency: '98.1 FM', style: 'local talk' },
    { name: 'FM O Dia', frequency: '100.5 FM', style: 'Brazilian pop' },
    { name: 'JB FM', frequency: '99.9 FM', style: 'smooth classics' },
  ],
  agra: [
    { name: 'Radio Mirchi Agra', frequency: '89.3 FM', style: 'Bollywood' },
    { name: 'AIR Agra', frequency: '1530 AM', style: 'public radio' },
    { name: 'Red FM Agra', frequency: '93.5 FM', style: 'Hindi hits' },
  ],
  sydney: [
    { name: 'triple j Sydney', frequency: '105.7 FM', style: 'new music' },
    { name: 'KIIS 106.5', frequency: '106.5 FM', style: 'pop hits' },
    { name: 'FBI Radio', frequency: '94.5 FM', style: 'independent' },
  ],
  rome: [
    { name: 'Radio Globo Roma', frequency: '99.6 FM', style: 'Italian pop' },
    { name: 'Dimensione Suono Roma', frequency: '101.9 FM', style: 'city hits' },
    { name: 'Rai Radio 2', frequency: 'DAB', style: 'national pop' },
  ],
  dubai: [
    { name: 'Virgin Radio Dubai', frequency: '104.4 FM', style: 'pop hits' },
    { name: 'Dubai 92', frequency: '92.0 FM', style: 'classic hits' },
    { name: 'Dubai Eye', frequency: '103.8 FM', style: 'city talk' },
  ],
  seattle: [
    { name: 'KEXP', frequency: '90.3 FM', style: 'independent' },
    { name: 'KNKX', frequency: '88.5 FM', style: 'jazz and news' },
    { name: 'Seattle Wolf', frequency: '100.7 FM', style: 'country' },
  ],
  bayarea: [
    { name: 'KQED', frequency: '88.5 FM', style: 'public radio' },
    { name: 'Wild 94.9', frequency: '94.9 FM', style: 'pop hits' },
    { name: 'KFOG Archives', frequency: '104.5 HD2', style: 'Bay Area rock' },
  ],
  minneapolis: [
    { name: 'The Current', frequency: '89.3 FM', style: 'independent' },
    { name: 'KDWB', frequency: '101.3 FM', style: 'pop hits' },
    { name: 'MPR News', frequency: '91.1 FM', style: 'public radio' },
  ],
  edmonton: [
    { name: 'CJSR Edmonton', frequency: '88.5 FM', style: 'campus and indie' },
    { name: 'SONiC 102.9', frequency: '102.9 FM', style: 'alternative' },
    { name: 'CBC Music Edmonton', frequency: '90.9 FM', style: 'local arts' },
  ],
  honolulu: [
    { name: 'KCCN FM100', frequency: '100.3 FM', style: 'Hawaiian hits' },
    { name: 'Island 98.5', frequency: '98.5 FM', style: 'island reggae' },
    { name: 'Hawaii Public Radio', frequency: '88.1 FM', style: 'public radio' },
  ],
  losangeles: [
    { name: 'KCRW', frequency: '89.9 FM', style: 'culture and music' },
    { name: 'KIIS FM', frequency: '102.7 FM', style: 'pop hits' },
    { name: 'Power 106', frequency: '105.9 FM', style: 'hip-hop' },
  ],
  boston: [
    { name: 'WBUR', frequency: '90.9 FM', style: 'public radio' },
    { name: 'Kiss 108', frequency: '107.9 FM', style: 'pop hits' },
    { name: 'WERS', frequency: '88.9 FM', style: 'college radio' },
  ],
  paloalto: [
    { name: 'KZSU Stanford', frequency: '90.1 FM', style: 'college radio' },
    { name: 'KQED', frequency: '88.5 FM', style: 'public radio' },
    { name: 'Live 105', frequency: '105.3 FM', style: 'alternative' },
  ],
  chicago: [
    { name: 'WXRT', frequency: '93.1 FM', style: 'rock' },
    { name: 'Vocalo', frequency: '91.1 FM', style: 'local culture' },
    { name: 'WBEZ', frequency: '91.5 FM', style: 'public radio' },
  ],
  global: [
    { name: 'Poplur World Radio', frequency: 'AI 1', style: 'global mix' },
    { name: 'Poplur Local Pulse', frequency: 'AI 2', style: 'nearby posts' },
    { name: 'Poplur Night Drive', frequency: 'AI 3', style: 'city flyover' },
  ],
}

const DESTINATION_RADIO_MARKET: Record<string, string> = {
  eiffel: 'paris',
  louvre: 'paris',
  'cn-tower': 'toronto',
  'eaton-centre': 'toronto',
  yorkdale: 'toronto',
  'scotiabank-arena': 'toronto',
  'rogers-centre': 'toronto',
  'u-of-t': 'toronto',
  rom: 'toronto',
  'trinity-bellwoods': 'toronto',
  'yonge-dundas': 'toronto',
  'kensington-market': 'toronto',
  'union-station-toronto': 'toronto',
  'st-lawrence-market': 'toronto',
  'exhibition-place': 'toronto',
  'nathan-phillips': 'toronto',
  'pearson-airport': 'toronto',
  'fairmont-royal-york': 'toronto',
  'big-ben': 'london',
  wembley: 'london',
  'borough-market': 'london',
  heathrow: 'london',
  'statue-liberty': 'newyork',
  met: 'newyork',
  'times-square': 'newyork',
  'madison-square-garden': 'newyork',
  'grand-central': 'newyork',
  'chelsea-market': 'newyork',
  'jfk-airport': 'newyork',
  giza: 'cairo',
  'christ-redeemer': 'rio',
  'taj-mahal': 'agra',
  'sydney-opera': 'sydney',
  colosseum: 'rome',
  'burj-khalifa': 'dubai',
  'dubai-mall': 'dubai',
  'space-needle': 'seattle',
  'pike-place': 'seattle',
  'golden-gate': 'bayarea',
  'mall-america': 'minneapolis',
  'west-edmonton-mall': 'edmonton',
  'ala-moana': 'honolulu',
  sofi: 'losangeles',
  'crypto-arena': 'losangeles',
  ucla: 'losangeles',
  'hollywood-bowl': 'losangeles',
  'la-live': 'losangeles',
  'lax-airport': 'losangeles',
  disneyland: 'losangeles',
  'harvard-yard': 'boston',
  'mit-dome': 'boston',
  'stanford-oval': 'paloalto',
  'central-park': 'newyork',
  'millennium-park': 'chicago',
}

const RADIO_MARKET_CITY: Record<string, string> = {
  toronto: 'Toronto',
  paris: 'Paris',
  london: 'London',
  newyork: 'New York',
  cairo: 'Cairo',
  rio: 'Rio de Janeiro',
  agra: 'Agra',
  sydney: 'Sydney',
  rome: 'Rome',
  dubai: 'Dubai',
  seattle: 'Seattle',
  bayarea: 'San Francisco Bay Area',
  minneapolis: 'Minneapolis',
  edmonton: 'Edmonton',
  honolulu: 'Honolulu',
  losangeles: 'Los Angeles',
  boston: 'Boston',
  paloalto: 'Palo Alto',
  chicago: 'Chicago',
  global: 'this stop',
}

/** Mixed POIs the AI tours through: landmarks, malls, arenas, schools and more. */
const TOUR_DESTINATIONS: TourDestination[] = [
  { id: 'eiffel', name: 'the Eiffel Tower', kind: 'landmark', coords: [2.2945, 48.8584] },
  { id: 'cn-tower', name: 'the CN Tower', kind: 'landmark', coords: [-79.3871, 43.6426] },
  { id: 'big-ben', name: 'Big Ben', kind: 'landmark', coords: [-0.1246, 51.5007] },
  { id: 'giza', name: 'the Giza Pyramids', kind: 'landmark', coords: [31.1342, 29.9792] },
  { id: 'christ-redeemer', name: 'Christ the Redeemer', kind: 'landmark', coords: [-43.2105, -22.9519] },
  { id: 'statue-liberty', name: 'the Statue of Liberty', kind: 'landmark', coords: [-74.0445, 40.6892] },
  { id: 'taj-mahal', name: 'the Taj Mahal', kind: 'landmark', coords: [78.0421, 27.1751] },
  { id: 'sydney-opera', name: 'the Sydney Opera House', kind: 'landmark', coords: [151.2153, -33.8568] },
  { id: 'colosseum', name: 'the Colosseum', kind: 'landmark', coords: [12.4922, 41.8902] },
  { id: 'burj-khalifa', name: 'Burj Khalifa', kind: 'landmark', coords: [55.2744, 25.1972] },
  { id: 'space-needle', name: 'the Space Needle', kind: 'landmark', coords: [-122.3493, 47.6205] },
  { id: 'golden-gate', name: 'the Golden Gate Bridge', kind: 'landmark', coords: [-122.4783, 37.8199] },
  { id: 'mall-america', name: 'Mall of America', kind: 'mall', coords: [-93.242, 44.8549] },
  { id: 'west-edmonton-mall', name: 'West Edmonton Mall', kind: 'mall', coords: [-113.6234, 53.5225] },
  { id: 'eaton-centre', name: 'Toronto Eaton Centre', kind: 'mall', coords: [-79.3806, 43.6544] },
  { id: 'dubai-mall', name: 'the Dubai Mall', kind: 'mall', coords: [55.2796, 25.1972] },
  { id: 'ala-moana', name: 'Ala Moana Center', kind: 'mall', coords: [-157.842, 21.2916] },
  { id: 'yorkdale', name: 'Yorkdale Shopping Centre', kind: 'mall', coords: [-79.4522, 43.7255] },
  { id: 'scotiabank-arena', name: 'Scotiabank Arena', kind: 'arena', coords: [-79.3791, 43.6435] },
  { id: 'rogers-centre', name: 'Rogers Centre', kind: 'arena', coords: [-79.3894, 43.6414] },
  { id: 'madison-square-garden', name: 'Madison Square Garden', kind: 'arena', coords: [-73.9934, 40.7505] },
  { id: 'wembley', name: 'Wembley Stadium', kind: 'arena', coords: [-0.2796, 51.556] },
  { id: 'sofi', name: 'SoFi Stadium', kind: 'arena', coords: [-118.339, 33.9535] },
  { id: 'crypto-arena', name: 'Crypto.com Arena', kind: 'arena', coords: [-118.2673, 34.043] },
  { id: 'u-of-t', name: 'University of Toronto', kind: 'school', coords: [-79.3957, 43.6629] },
  { id: 'harvard-yard', name: 'Harvard Yard', kind: 'school', coords: [-71.1167, 42.3744] },
  { id: 'mit-dome', name: 'MIT Great Dome', kind: 'school', coords: [-71.0921, 42.3592] },
  { id: 'ucla', name: 'UCLA', kind: 'school', coords: [-118.4452, 34.0689] },
  { id: 'stanford-oval', name: 'Stanford Oval', kind: 'school', coords: [-122.1697, 37.4275] },
  { id: 'louvre', name: 'the Louvre', kind: 'museum', coords: [2.3364, 48.8606] },
  { id: 'met', name: 'the Met', kind: 'museum', coords: [-73.9632, 40.7794] },
  { id: 'rom', name: 'the Royal Ontario Museum', kind: 'museum', coords: [-79.3948, 43.6677] },
  { id: 'central-park', name: 'Central Park', kind: 'park', coords: [-73.9654, 40.7829] },
  { id: 'trinity-bellwoods', name: 'Trinity Bellwoods Park', kind: 'park', coords: [-79.4144, 43.6471] },
  { id: 'millennium-park', name: 'Millennium Park', kind: 'park', coords: [-87.6226, 41.8826] },
  { id: 'times-square', name: 'Times Square', kind: 'district', coords: [-73.9855, 40.758] },
  { id: 'yonge-dundas', name: 'Yonge-Dundas Square', kind: 'district', coords: [-79.3802, 43.6561] },
  { id: 'kensington-market', name: 'Kensington Market', kind: 'district', coords: [-79.4003, 43.6547] },
  { id: 'union-station-toronto', name: 'Toronto Union Station', kind: 'venue', coords: [-79.3806, 43.6453] },
  { id: 'grand-central', name: 'Grand Central Terminal', kind: 'venue', coords: [-73.9772, 40.7527] },
  { id: 'hollywood-bowl', name: 'the Hollywood Bowl', kind: 'venue', coords: [-118.3391, 34.1122] },
  { id: 'st-lawrence-market', name: 'St. Lawrence Market', kind: 'food', coords: [-79.3716, 43.6487] },
  { id: 'borough-market', name: 'Borough Market', kind: 'food', coords: [-0.0911, 51.5055] },
  { id: 'chelsea-market', name: 'Chelsea Market', kind: 'food', coords: [-74.0055, 40.7424] },
  { id: 'pike-place', name: 'Pike Place Market', kind: 'food', coords: [-122.3422, 47.6095] },
  { id: 'exhibition-place', name: 'Exhibition Place', kind: 'event', coords: [-79.4167, 43.6333] },
  { id: 'nathan-phillips', name: 'Nathan Phillips Square', kind: 'event', coords: [-79.3841, 43.6525] },
  { id: 'la-live', name: 'L.A. Live', kind: 'event', coords: [-118.2667, 34.0443] },
  { id: 'pearson-airport', name: 'Toronto Pearson Airport', kind: 'airport', coords: [-79.6248, 43.6777] },
  { id: 'heathrow', name: 'Heathrow Airport', kind: 'airport', coords: [-0.4543, 51.47] },
  { id: 'jfk-airport', name: 'JFK Airport', kind: 'airport', coords: [-73.7781, 40.6413] },
  { id: 'lax-airport', name: 'LAX', kind: 'airport', coords: [-118.4085, 33.9416] },
  { id: 'disneyland', name: 'Disneyland', kind: 'themepark', coords: [-117.9189, 33.8121] },
  { id: 'bellagio', name: 'Bellagio', kind: 'casino', coords: [-115.1761, 36.1126] },
  { id: 'fairmont-royal-york', name: 'Fairmont Royal York', kind: 'hotel', coords: [-79.3811, 43.6459] },
  { id: 'marina-bay-sands', name: 'Marina Bay Sands', kind: 'hotel', coords: [103.8607, 1.2834] },
]

const INTRO_LANDMARKS = TOUR_DESTINATIONS.filter(destination => destination.kind === 'landmark')

const SEARCH_SHORTCUT_IDS = [
  'cn-tower',
  'eaton-centre',
  'st-lawrence-market',
  'scotiabank-arena',
  'rogers-centre',
  'rom',
  'kensington-market',
  'union-station-toronto',
] as const
const SEARCH_SHORTCUTS = SEARCH_SHORTCUT_IDS
  .map(id => TOUR_DESTINATIONS.find(destination => destination.id === id))
  .filter((destination): destination is TourDestination => Boolean(destination))

const RECOMMENDATIONS: ((destination: TourDestination) => string)[] = [
  destination => `Now at ${destination.name}`,
  destination => `Touring ${destination.name}`,
]

/** All modes, in the order you asked to browse them. */

// Keep every app-driven street flight close enough that 3D buildings are visible.
const BUILDING_REVEAL_ZOOM = 16.2 // matches ClayMap ZOOM_MAX cap
const DEFAULT_NAV_ORIGIN: [number, number] = [-79.3811, 43.6487]
// Tour pacing. The tour flight is not a short hop: it rises all the way out to
// the globe and dives back into the next city (minZoom 0.9, curve 1.7 in
// flyToCenter), so it needs real time to read as a camera move rather than a
// snap. Even 15s rushed the globe reveal and destination approach, so the
// default now gives the complete move a cinematic 30s.
//
// The June iOS tour (MapView.swift) shipped a `tourSpeedMultiplier`, 0.1x–5.0x
// with a slider, precisely because this wants dialing in — so the multiplier
// comes back here as `?tour-speed=N` (higher = faster, 1 = the tuned default),
// and its 30s stop dwell is the reference for how long a stop should hold.
const TOUR_SPEED = (() => {
  if (typeof window === 'undefined') return 1
  const raw = Number(new URLSearchParams(window.location.search).get('tour-speed'))
  return Number.isFinite(raw) && raw >= 0.1 && raw <= 5 ? raw : 1
})()
const TOUR_FLIGHT_MS = Math.round(30_000 / TOUR_SPEED)
const TOUR_DWELL_MS = 5 * 60 * 1000
// How long the map must sit front-most and untouched before the ambient AI
// radio tour is allowed to take the camera on its own.
const TOUR_IDLE_MS = 3 * 60 * 1000

function radioMarketForDestination(destination: TourDestination): string {
  return DESTINATION_RADIO_MARKET[destination.id] ?? 'global'
}

function radioStationsForDestination(destination: TourDestination): RadioStation[] {
  return RADIO_MARKETS[radioMarketForDestination(destination)] ?? RADIO_MARKETS.global
}

function cityNameForDestination(destination: TourDestination): string {
  return RADIO_MARKET_CITY[radioMarketForDestination(destination)] ?? RADIO_MARKET_CITY.global
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function destinationsForTopics(topics: readonly MapTourTopic[]): TourDestination[] {
  const selected = new Set(topics)
  return TOUR_DESTINATIONS.filter(destination => selected.has(TOUR_TOPIC_FOR_KIND[destination.kind]))
}

function nearestTourDestination(
  center: [number, number],
  topics: readonly MapTourTopic[],
): TourDestination {
  const destinations = destinationsForTopics(topics)
  return destinations.reduce((nearest, destination) =>
    distanceMeters(center, destination.coords) < distanceMeters(center, nearest.coords)
      ? destination
      : nearest,
  destinations[0] ?? TOUR_DESTINATIONS[0])
}

function displayPlaceName(name: string): string {
  return name.replace(/^the\s+/i, '')
}

type NativeLocation = { latitude: number; longitude: number }

function nativeLocationFrom(value: unknown): NativeLocation | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as { latitude?: unknown; longitude?: unknown; detail?: unknown }
  if (payload.detail && typeof payload.detail === 'object') return nativeLocationFrom(payload.detail)
  const latitude = Number(payload.latitude)
  const longitude = Number(payload.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

export default function App() {
  // The public root is the post-login home. The map runs standalone only when
  // HomeTwin embeds this same bundle with the internal map route below.
  const params = new URLSearchParams(window.location.search)
  const isMapEmbed = params.get('map') === '1'
  const harnessView = isMapEmbed ? null : (harnessViewFromLocation() ?? 'home')
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const currentMapMode = MAP_2D ? '2d' : '3d'
  const handleToggleMapMode = useCallback(() => {
    const nextMode = MAP_2D ? '3d' : '2d'
    setMapMode(nextMode)
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('mapMode', nextMode)
    nextUrl.searchParams.delete('fallback2d')
    window.location.replace(nextUrl.toString())
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>('queen')
  // Theme switching lives in the app's Profile → Settings; the prototype
  // ships the default clay skin with the infrastructure in place.
  const [theme] = useState(MAP_THEMES[0])
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null)
  const [weatherOverride, setWeatherOverride] = useState<WeatherMode | null>(null)
  // TEST ONLY: walk day → night → day so both skies can be checked without
  // waiting twelve hours. ?day-cycle=0 turns it off; dev builds only.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (new URLSearchParams(window.location.search).get('day-cycle') !== '1') return
    const id = window.setInterval(() => setDayTime(d => !d), 24_000)
    return () => window.clearInterval(id)
  }, [])

  // TEST ONLY: cycle every weather mode so each overlay can be checked without
  // waiting on the sky. Dev builds by default; ?weather-cycle=0 turns it off,
  // and it cannot run in production because __DEV__ is compiled out.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (new URLSearchParams(window.location.search).get('weather-cycle') !== '1') return
    const modes: WeatherMode[] = ['clear', 'cloudy', 'rain', 'thunder', 'storm', 'snow', 'hail', 'fog']
    let at = 0
    const id = window.setInterval(() => {
      at = (at + 1) % modes.length
      setWeatherOverride(modes[at])
    }, 9000)
    return () => window.clearInterval(id)
  }, [])

  // Place search (top-right): the clay magnifier opens a field that geocodes
  // through Mapbox and flies the map to whatever you pick.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchHits, setSearchHits] = useState<Array<{ name: string; center: [number, number] }>>([])
  const [searching, setSearching] = useState(false)
  const [dayTime, setDayTime] = useState(true)
  // Tour narration stays separate from the visible status. The map header only
  // says where the camera is — the station readout left with the radio.
  const [tourLine, setTourLine] = useState<string | null>(null)
  const [currentPlace, setCurrentPlace] = useState('Toronto')
  // How many px the status line overruns its ticker — 0 means it fits. Drives
  // the back-and-forth glide; measured on every text change and resize.
  const tickerRef = useRef<HTMLDivElement>(null)
  const [tickerOverflow, setTickerOverflow] = useState(0)
  useEffect(() => {
    const el = tickerRef.current
    if (!el) return
    const measure = () => {
      const span = el.firstElementChild as HTMLElement | null
      setTickerOverflow(span ? Math.max(0, span.scrollWidth - el.clientWidth) : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [currentPlace])
  const [tourTopics, setTourTopics] = useState<MapTourTopic[]>(readMapTourTopics)
  const tourTopicsRef = useRef(tourTopics)
  tourTopicsRef.current = tourTopics
  const searchInterruptRef = useRef<() => void>(() => {})
  // User mute, toggled by the speaker mark beside the AI line.
  const [muted, setMuted] = useState(isUserMuted)
  const [streetView, setStreetView] = useState(false)
  // Routing must follow the user/launch location, not the AI tour camera. The
  // camera may be visiting another continent when an address is entered.
  const [navigationOrigin, setNavigationOrigin] = useState<[number, number]>(DEFAULT_NAV_ORIGIN)
  // THERE IS NO MAP ON A HARNESS VIEW, SO THERE IS NO MAP AUDIO.
  //
  // `?view=feed|post|profile` returns ViewHarness far below — but hooks cannot
  // be skipped before an early return, so every effect in this component still
  // runs on those screens, including the one that switches the map's sound on.
  // Combined with "top-level document ⇒ front-most" that meant Feed, Camera and
  // Profile each started the radio's synthesised bed — noise, five oscillators
  // and a 690 ms pulse timer — under a screen with no map anywhere in it.
  //
  // Front-most is about which SURFACE the user is looking at; it can only be
  // true in a document that actually draws the map.
  const mapSurfaceRef = useRef(!harnessView)
  // The map lives in an always-mounted iframe behind Feed/Profile. It starts
  // unfocused there, so no map audio can win a resume race before Home sends
  // the first foreground message.
  const mapAudioFrontRef = useRef(
    mapSurfaceRef.current && (typeof window === 'undefined' || window.parent === window),
  )
  // The map always WANTS sound; whether you hear it is the gate's decision
  // (your mute, the app being backgrounded, another tab being front). This used
  // to start false and was only flipped by a dev-only "sound on" button — with
  // that button gone, unmuting had nothing to switch back on.
  const soundRequestedRef = useRef(true)
  // The audio-focus effect below needs the auto-tour idle controls, which are
  // defined further down the body. Hand them over through a ref rather than
  // reordering a long component around a two-line dependency.
  const tourIdleRef = useRef<{ schedule: () => void; cancel: () => void }>({
    schedule: () => {}, cancel: () => {},
  })
  const lastTourDestinationRef = useRef<string | null>(null)
  useEffect(() => {
    if (harnessView) return
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-loading' }, '*')
    postNativeEvent({ type: 'mapLoading' })
  }, [harnessView])

  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'poplur-map-mode', mode: currentMapMode }, '*')
    }
  }, [currentMapMode])

  // The native shells ask for location while Feed is visible, then broadcast
  // the result into this already-mounted map iframe. Keep latitude-first at
  // the bridge boundary; Mapbox and the routing layer remain [lng, lat].
  useEffect(() => {
    if (harnessView) return
    const w = window as typeof window & {
      __poplurNative?: Record<string, unknown>
      __poplurNativeLocation?: NativeLocation
    }
    const applyLocation = (value: unknown) => {
      const location = nativeLocationFrom(value)
      if (!location) return
      w.__poplurNativeLocation = location
      setNavigationOrigin([location.longitude, location.latitude])
    }
    const onLocation = (event: Event) => applyLocation((event as CustomEvent).detail)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-location') applyLocation(event.data)
    }
    window.addEventListener('poplur-location', onLocation)
    window.addEventListener('poplur-native-location', onLocation)
    window.addEventListener('message', onMessage)
    applyLocation(w.__poplurNativeLocation)
    return () => {
      window.removeEventListener('poplur-location', onLocation)
      window.removeEventListener('poplur-native-location', onLocation)
      window.removeEventListener('message', onMessage)
    }
  }, [harnessView])

  const runPlaceSearch = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) { setSearchHits([]); return }
    setSearching(true)
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
        + `?access_token=${TOKEN}&limit=6&types=place,locality,address,poi`,
      )
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { features?: Array<{ place_name: string; center: [number, number] }> }
      setSearchHits((data.features ?? []).map(f => ({ name: f.place_name, center: f.center })))
    } catch {
      setSearchHits([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Tapping away sends the panel back up the way it came, then unmounts it.
  const closeSearch = useCallback(() => {
    setSearchClosing(true)
    window.setTimeout(() => {
      setSearchOpen(false)
      setSearchClosing(false)
      setSearchText('')
      setSearchHits([])
    }, 320)
  }, [])

  const flyToPlace = useCallback((center: [number, number], name: string) => {
    playPop(0.3)
    searchInterruptRef.current()
    setCurrentPlace(displayPlaceName(name))
    setSearchOpen(false)
    setSearchClosing(false)
    setSearchText('')
    setSearchHits([])
    const map = mapRef.current as unknown as {
      stop?: () => void
      easeTo?: (o: Record<string, unknown>) => void
      __stopOrbit?: () => void
    } | null
    map?.__stopOrbit?.()
    map?.stop?.()
    map?.easeTo?.({
      center,
      zoom: 15.4,
      pitch: 52,
      duration: 3400,
      easing: (t: number) => t * t * (3 - 2 * t),
      essential: true,
    })
  }, [mapRef])

  // Keep the place half of the status truthful after a manual pan as well as
  // after a tour/search action. Curated destinations win near their own
  // coordinates; elsewhere a lightweight reverse lookup supplies the locality.
  useEffect(() => {
    let attachedMap: mapboxgl.Map | null = null
    let lookupGeneration = 0
    const updatePlace = () => {
      const map = attachedMap
      if (!map) return
      const at = map.getCenter()
      const center: [number, number] = [at.lng, at.lat]
      const nearest = TOUR_DESTINATIONS.reduce((best, destination) =>
        distanceMeters(center, destination.coords) < distanceMeters(center, best.coords)
          ? destination
          : best,
      TOUR_DESTINATIONS[0])
      if (distanceMeters(center, nearest.coords) < 180) {
        setCurrentPlace(displayPlaceName(nearest.name))
        return
      }
      const generation = ++lookupGeneration
      void fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${center[0]},${center[1]}.json`
        + `?access_token=${TOKEN}&limit=1&types=poi,neighborhood,locality,place`,
      )
        .then(response => response.ok ? response.json() : Promise.reject())
        .then((data: { features?: Array<{ text?: string }> }) => {
          if (generation !== lookupGeneration) return
          const label = data.features?.[0]?.text?.trim()
          if (label) setCurrentPlace(label)
        })
        .catch(() => { /* keep the last known place */ })
    }
    const attach = () => {
      if (attachedMap || !mapRef.current) return
      attachedMap = mapRef.current
      attachedMap.on('moveend', updatePlace)
      updatePlace()
    }
    attach()
    // The map arrives a beat after mount, so the first attach usually misses.
    // What this poll must NOT do is keep going: on a harness view there is no
    // ClayMap in this document at all, so `mapRef` is never set and a poll with
    // no stop condition is a timer ticking four times a second for the life of
    // the tab. Stop the moment it succeeds, and give up after ~15s.
    let attempts = 0
    const timer = window.setInterval(() => {
      attach()
      attempts += 1
      if (attachedMap || attempts >= 60) window.clearInterval(timer)
    }, 250)
    return () => {
      window.clearInterval(timer)
      attachedMap?.off('moveend', updatePlace)
    }
  }, [])

  const applySoundState = useCallback((on: boolean): boolean => {
    soundRequestedRef.current = on
    const audible = on && mapSurfaceRef.current && mapAudioFrontRef.current && !isGateMuted()
    if (audible) {
      // The Poplur AI host only. The radio (live station stream + wav bed) is
      // gone — redundant next to the voice — and the procedural ambience bed
      // and generative theme were already dropped: they ran under everything,
      // forever, and read as noise rather than atmosphere. Silence between the
      // host's lines is correct. Nothing starts here; the voice speaks when
      // the tour arrives somewhere.
      stopRegionAudio()
      stopPoplurTheme()
    } else {
      cancelVoiceSpeech()
      stopRegionAudio()
      stopPoplurTheme()
    }
    return audible
  }, [])

  // `gcAudio` is the map's audio-focus contract with the Home shell. The
  // generic AudioContext gate remains a safety net, but actively stopping the
  // soundscape here prevents a tour callback from resuming it behind Feed.
  useEffect(() => {
    const sync = () => { applySoundState(soundRequestedRef.current) }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'poplur-audio-stop') {
        mapAudioFrontRef.current = false
        applySoundState(false)
        // Off the map: the auto-tour countdown does not run in the background.
        tourIdleRef.current.cancel()
        return
      }
      if (typeof event.data?.gcAudio !== 'string') return
      // `gcAudio: 'on'` is Home telling the MAP iframe it is front-most. These
      // messages are posted with '*' and can land in any listening document, so
      // a harness view must not be able to talk itself into being the map.
      mapAudioFrontRef.current = mapSurfaceRef.current && event.data.gcAudio === 'on'
      // Arriving on the map starts the idle wait from zero; leaving stops it.
      if (mapAudioFrontRef.current) tourIdleRef.current.schedule()
      else tourIdleRef.current.cancel()
      sync()
    }
    window.addEventListener('message', onMessage)
    const offGate = onGateChange(sync)
    const offFocus = onAudioFocusChange(owner => {
      // Another frame's AI voice actively stops the radio. Once that temporary
      // lease releases, restore Map only if it is still front-most and the user
      // had already requested sound; never resurrect audio for a hidden tab.
      if (owner === null && mapAudioFrontRef.current && soundRequestedRef.current) sync()
    })
    sync()
    return () => {
      window.removeEventListener('message', onMessage)
      offGate()
      offFocus()
    }
  }, [applySoundState])

  useEffect(() => {
    return () => { cancelVoiceSpeech(); stopRegionAudio() }
  }, [])

  // Duck the whole bed under the AI radio host, mirroring the iOS voice-duck.
  useEffect(() => { setVoiceDucked(!!tourLine) }, [tourLine])

  // Real weather + day/night for the map area (same open-meteo endpoint the
  // iOS app uses). Fahrenheit only where people actually use it — the US, its
  // territories, and a short list besides; everywhere else gets Celsius.
  useEffect(() => {
    const unit = usesFahrenheit() ? 'fahrenheit' : 'celsius'
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=43.65&longitude=-79.38&current=temperature_2m,weather_code,is_day&temperature_unit=${unit}&timezone=auto`)
      .then(res => res.json())
      .then(json => {
        setWeather({ temp: Math.round(json.current.temperature_2m), code: json.current.weather_code })
        setDayTime(json.current.is_day === 1)
      })
      .catch(() => setWeather({ temp: usesFahrenheit() ? 72 : 22, code: 1 }))
  }, [])

  // DEV: cycle weather / sky from the console to demo every overlay
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as {
      __setWeather?: (m: WeatherMode | null) => void
      __setSky?: (day: boolean) => void
      __setSound?: (on: boolean) => void
    }
    w.__setWeather = m => setWeatherOverride(m)
    w.__setSky = day => setDayTime(day)
    w.__setSound = on => applySoundState(on)
  }, [applySoundState])

  // Native bridge: the iOS/Android shells drive the map through
  // window.__poplurNative and receive events via postMessage.
  useEffect(() => {
    const w = window as unknown as {
      __poplurNative?: Record<string, unknown>
      __poplurNativeLocation?: NativeLocation
    }
    w.__poplurNative = {
      ...w.__poplurNative,
      setLocation: (latitude: number, longitude: number) => {
        const location = nativeLocationFrom({ latitude, longitude })
        if (!location) return
        w.__poplurNativeLocation = location
        setNavigationOrigin([location.longitude, location.latitude])
        window.dispatchEvent(new CustomEvent('poplur-location', { detail: location }))
      },
      setCenter: (lng: number, lat: number, zoom?: number) =>
        mapRef.current?.easeTo({ center: [lng, lat], zoom: zoom ?? mapRef.current.getZoom(), duration: 800 }),
      flyTo: (lng: number, lat: number, zoom: number) => {
        const map = mapRef.current
        if (!map) return
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
        map.flyTo({ center: [lng, lat], zoom, pitch: streetView ? 82 : 64, duration: 4600, curve: 1.7, essential: true })
      },
      setSky: (day: boolean) => setDayTime(day),
      setWeather: (m: WeatherMode | null) => setWeatherOverride(m),
      // The shell tells the map when its music / AI voice is audible so the
      // volume mark beside the AI line matches what the user actually hears.
      setSound: (on: boolean) => applySoundState(on),
    }
    return () => { delete w.__poplurNative }
  }, [applySoundState, streetView])

  const flyToCenter = useCallback((center: [number, number], duration = 4600) => {
    const map = mapRef.current
    if (!map) return false
    ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
    map.flyTo({
      center,
      zoom: streetView ? 18.9 : BUILDING_REVEAL_ZOOM,
      pitch: streetView ? 82 : 64,
      bearing: map.getBearing() + 36,
      duration,
      // The tour arc rises ALL the way out — the flight peaks at the full
      // globe before diving into the next stop.
      minZoom: 0.9,
      curve: 1.7,
      essential: true,
    })
    return true
  }, [streetView])

  const tourTimers = useRef<number[]>([])
  const tourStartedRef = useRef(false)
  const clearTourTimers = useCallback(() => {
    tourTimers.current.forEach(t => window.clearTimeout(t))
    tourTimers.current = []
  }, [])

  // Anything that interrupts the tour — a route, walking the pops, stopping it
  // outright — has to say so, or the menu keeps offering STOP for a tour that
  // is no longer running.
  const stopTour = useCallback(() => {
    clearTourTimers()
    tourOnRef.current = false
    setTourOn(false)
  }, [clearTourTimers])
  searchInterruptRef.current = stopTour
  useEffect(() => clearTourTimers, [clearTourTimers])

  const handleToggleStreetView = useCallback(() => {
    const next = !streetView
    clearTourTimers()
    setStreetView(next)
    setTourLine(next ? 'Street View enabled - labels are culled near the road.' : 'Hybrid flyover restored.')
  }, [clearTourTimers, streetView])

  const handleGoToCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setTourLine('Current location is not available in this browser.')
      return
    }
    clearTourTimers()
    setTourLine('Finding your current location...')
    navigator.geolocation.getCurrentPosition(
      position => {
        const center: [number, number] = [position.coords.longitude, position.coords.latitude]
        setNavigationOrigin(center)
        setCurrentPlace('Current location')
        setTourLine('Current location selected - checking nearby 3D buildings.')
        flyToCenter(center, 4600)
      },
      () => {
        setTourLine('Allow location access to check your house on the map.')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    )
  }, [clearTourTimers, flyToCenter])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __goToCurrentLocation?: () => void }
    w.__goToCurrentLocation = handleGoToCurrentLocation
    return () => { delete w.__goToCurrentLocation }
  }, [handleGoToCurrentLocation])

  const activateTourDestination = useCallback((destination: TourDestination) => {
    const stations = radioStationsForDestination(destination)
    const line = RECOMMENDATIONS[Math.floor(Math.random() * RECOMMENDATIONS.length)](destination)
    const cityName = cityNameForDestination(destination)
    lastTourDestinationRef.current = destination.id
    setCurrentPlace(displayPlaceName(destination.name))
    setTourLine(line)
    postNativeEvent({
      type: 'tourStop',
      id: destination.id,
      stopTitle: destination.name,
      kind: destination.kind,
      cityName,
      script: line,
      stationName: stations[0] ? `${stations[0].name} ${stations[0].frequency}` : undefined,
      stations,
      dwellMs: TOUR_DWELL_MS,
    })
    if (applySoundState(true)) {
      // The AI host speaks the stop; there is no station to tune under it any
      // more. The voice surface owns focus for the duration, so Feed cannot
      // talk over the line and a background map cannot leak speech either —
      // applySoundState is already false when the map is not front.
      speakWithVoiceAudioFocus(line, { rate: 0.95, pitch: 0.98 })
    }
    flyToCenter(destination.coords, TOUR_FLIGHT_MS)
  }, [applySoundState, flyToCenter])

  // ── AI place tour: each stop holds for five minutes after arrival ─────────
  const tourStep = useCallback((preferredDestination?: TourDestination) => {
    const selected = destinationsForTopics(tourTopicsRef.current)
    const options = selected.filter(destination => destination.id !== lastTourDestinationRef.current)
    const destination = preferredDestination ?? options[Math.floor(Math.random() * options.length)] ?? selected[0] ?? TOUR_DESTINATIONS[0]
    activateTourDestination(destination)
  }, [activateTourDestination])

  // Whether the tour is running. The hold menu's tile has to read STOP TOUR
  // for as long as it is, so the map owns the truth and reports it upward —
  // the menu can't infer it from a tile it tapped once.
  // The cloudy badge wears the real clay cloud — the same cloud.glb that drifts
  // overhead in WeatherFX, rendered once to a sprite. The drawn SVG stands in
  // only until it resolves, so the badge is never empty.
  const [cloudBadge, setCloudBadge] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    modelSprite('cloud.glb', { yaw: -18, pitch: 12, size: 256 })
      .then(url => { if (alive) setCloudBadge(url) })
      .catch(() => { /* the SVG keeps the badge */ })
    return () => { alive = false }
  }, [])

  const [tourOn, setTourOn] = useState(false)
  const tourOnRef = useRef(false)

  const startTourLoop = useCallback((initialDelayMs = 0, firstDestination?: TourDestination) => {
    clearTourTimers()
    tourStartedRef.current = true
    tourOnRef.current = true
    setTourOn(true)
    let pendingFirst = firstDestination
    const runStop = () => {
      tourStep(pendingFirst)
      pendingFirst = undefined
      const next = window.setTimeout(runStop, TOUR_FLIGHT_MS + TOUR_DWELL_MS)
      tourTimers.current = [next]
    }
    if (initialDelayMs > 0) {
      const first = window.setTimeout(runStop, initialDelayMs)
      tourTimers.current = [first]
    } else {
      runStop()
    }
  }, [clearTourTimers, tourStep])

  // ── Auto-tour: only from a genuinely idle map ────────────────────────────
  // The AI radio tour is ambient, so it must never take the camera while the
  // map is being used. It arms after the intro and fires only once the map has
  // been front-most and untouched for this long. ANY input restarts the wait,
  // and leaving the map cancels it outright.
  const tourArmedRef = useRef(false)
  const tourIdleTimerRef = useRef<number | null>(null)
  const pendingTourDestRef = useRef<TourDestination | undefined>(undefined)

  const cancelTourIdle = useCallback(() => {
    if (tourIdleTimerRef.current != null) {
      window.clearTimeout(tourIdleTimerRef.current)
      tourIdleTimerRef.current = null
    }
  }, [])

  const scheduleTourIdle = useCallback(() => {
    cancelTourIdle()
    // Armed, not already touring, and the map is the surface you are looking at.
    if (!tourArmedRef.current || tourStartedRef.current || !mapAudioFrontRef.current) return
    tourIdleTimerRef.current = window.setTimeout(() => {
      tourIdleTimerRef.current = null
      if (!tourArmedRef.current || tourStartedRef.current || !mapAudioFrontRef.current) return
      const nearest = pendingTourDestRef.current
      setTourLine(nearest
        ? `Poplur AI is finding the nearest ${TOUR_KIND_LABEL[nearest.kind]} radio stop.`
        : 'Poplur AI is finding the next landmark radio stop.')
      startTourLoop(0, nearest)
    }, TOUR_IDLE_MS)
  }, [cancelTourIdle, startTourLoop])

  // Every real input restarts the countdown. Capture phase on the document:
  // the map canvas, the clay controls and the zoom rail all stop propagation
  // on their own handlers, so a bubble-phase listener would miss most touches.
  useEffect(() => {
    const bump = () => {
      // Once the tour is running it is stopped by the controls that own it
      // (cyclePop, route intent, the TOUR tile) — not by touching the map.
      if (tourStartedRef.current) return
      scheduleTourIdle()
    }
    const opts: AddEventListenerOptions = { passive: true, capture: true }
    // NOT pointermove: it fires ~60×/s through a drag and would clear and
    // re-arm the timer on every one. A drag always opens with a pointerdown.
    const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
    for (const type of events) document.addEventListener(type, bump, opts)
    return () => {
      for (const type of events) document.removeEventListener(type, bump, opts)
    }
  }, [scheduleTourIdle])

  useEffect(() => cancelTourIdle, [cancelTourIdle])
  tourIdleRef.current = { schedule: scheduleTourIdle, cancel: cancelTourIdle }

  // The globe has painted: lift the Loading screen so the launch is revealed at
  // globe zoom (the dive to the user's location then plays in full view).
  const handleGlobeReady = useCallback(() => {
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-ready' }, '*')
    postNativeEvent({ type: 'mapReady' })
  }, [])

  const handleIntroComplete = useCallback((landingCenter?: [number, number]) => {
    // Safety net: if 'idle' never fired at globe zoom, this still reveals.
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-ready' }, '*')
    postNativeEvent({ type: 'mapReady' })
    if (landingCenter) setNavigationOrigin(landingCenter)
    if (tourStartedRef.current) return
    // The tour used to launch 1.2s after the intro — it took the camera away
    // before you had even looked at your own street. It now waits for the map
    // to be genuinely idle: front-most and untouched for TOUR_IDLE_MS. The
    // hold-menu TOUR tile still starts it at once, because that is a request.
    pendingTourDestRef.current = landingCenter
      ? nearestTourDestination(landingCenter, tourTopicsRef.current)
      : undefined
    tourArmedRef.current = true
    scheduleTourIdle()
  }, [scheduleTourIdle])

  // The home shell mirrors the tour state onto the hold-menu tile.
  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'poplur-map-tour', on: tourOn }, '*')
    }
  }, [tourOn])

  // Hold-menu actions arrive from the home page as messages: the on-map
  // Directions/Street View/Locate buttons moved there to declutter the map.
  const [directionsSignal, setDirectionsSignal] = useState(0)
  const popCycleRef = useRef(-1)
  useEffect(() => {
    const onAction = (event: MessageEvent) => {
      if (event.data?.type !== 'poplur-map-action') return
      switch (event.data.action) {
        case 'locate': handleGoToCurrentLocation(); break
        case 'streetview': handleToggleStreetView(); break
        case 'directions': setDirectionsSignal(n => n + 1); break
        // The search panel drops in from the top, the same one the map's own
        // search button opens — the menu tile is another way in, not a copy.
        case 'search': setSearchOpen(true); break
        case 'mapMode': handleToggleMapMode(); break
        case 'setTourTopics': {
          const next = writeMapTourTopics(normalizeMapTourTopics(event.data.topics))
          tourTopicsRef.current = next
          setTourTopics(next)
          break
        }
        // One tile, both directions. The decision is read off the ref rather
        // than computed inside a state updater: StrictMode double-invokes
        // those, and this one has to fire timers.
        case 'tour': {
          if (tourOnRef.current) stopTour()
          else startTourLoop(0)
          break
        }
        case 'cyclePop': {
          // Channel arrows on the map: fly pop-to-pop with the tour camera
          // (curved zoom-out-then-in), pausing the ambient tour.
          stopTour()
          const dir = event.data.dir === -1 ? -1 : 1
          const next = ((popCycleRef.current + dir) % POIS.length + POIS.length) % POIS.length
          popCycleRef.current = next
          const poi = POIS[next]
          if (poi) {
            setTourLine(`Pop ${next + 1} of ${POIS.length}: ${poi.name}`)
            flyToCenter(poi.coords as [number, number], TOUR_FLIGHT_MS)
            // Tell the shell WHICH pop this is. The channel arrows used to count
            // POST_COUNT (128) locally while the map flew through POIS, so the
            // number between the arrows described a different list from the one
            // the camera was visiting. The map owns the list, so the map owns
            // the number.
            // Show the pop's TAKEOVER — the ground it holds — using the same
            // radius preview the composer draws, so arriving at a post looks
            // like arriving at its claim rather than just a camera move.
            const map = mapRef.current
            if (map) {
              try {
                installComposeRadiusPreview(map)
                const [lng, lat] = poi.coords as [number, number]
                updateComposeRadiusPreview(map, new mapboxgl.LngLat(lng, lat), poi.radiusKm, theme)
              } catch { /* style not ready yet; the next cycle draws it */ }
            }
            try {
              window.parent?.postMessage(
                {
                  type: 'poplur-map-pop',
                  index: next,
                  total: POIS.length,
                  name: poi.name,
                  // The HUD's RADIUS card shows THIS pop's takeover while you
                  // travel, not the signed-in user's own reach.
                  radiusKm: poi.radiusKm,
                },
                '*',
              )
            } catch { /* no parent frame in the standalone map route */ }
          }
          break
        }
      }
    }
    window.addEventListener('message', onAction)
    return () => window.removeEventListener('message', onAction)
  }, [handleGoToCurrentLocation, handleToggleMapMode, handleToggleStreetView, startTourLoop, stopTour, flyToCenter])

  const handleRouteIntent = useCallback(() => {
    stopTour()
    const map = mapRef.current
    if (!map) return
    const mapApi = map as unknown as { __cinematic?: boolean; __stopOrbit?: () => void }
    mapApi.__cinematic = false
    mapApi.__stopOrbit?.()
    map.stop()
  }, [stopTour])

  const handleSelectPoi = useCallback((id: string) => {
    setSelectedId(id)
    const poi = POIS.find(p => p.id === id)
    if (!poi) return
    setCurrentPlace(displayPlaceName(poi.name))
    flyToCenter(poi.coords, 4600)
  }, [flyToCenter])

  if (harnessView) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <ViewHarness initialView={harnessView} />
        <VolumeBars />
      </div>
    )
  }

  if (!TOKEN) {
    return (
      <div className={styles.noToken}>
        <p>Add <code>VITE_MAPBOX_TOKEN=pk.eyJ1…</code> to <code>.env</code> and restart.</p>
      </div>
    )
  }

  const weatherMode: WeatherMode = weatherOverride ?? (weather ? modeForCode(weather.code) : 'clear')

  return (
    <div className={styles.shell}>
      <VolumeBars />
      {/* ── Full-screen clay map — the signature world. ──
          Premium once swapped in a Cesium/Google-3D-tiles photoreal surface
          here. It was parked deliberately: matching the clay world meant
          reimplementing the tour, pops, weather, props, markers and navigation
          against a second engine, it billed per tile, and photoreal is the one
          thing every other map already has. PhotorealMap.tsx is kept for a
          future scoped "look around this venue in 3D" moment. */}
      <ClayMap
        token={TOKEN}
        pois={POIS}
        selectedId={selectedId}
        onSelectPoi={handleSelectPoi}
        mapRef={mapRef}
        theme={theme}
        dayTime={dayTime}
        weatherMode={weatherMode}
        weatherIcon={
          cloudBadge && (weatherMode === 'cloudy' || weatherMode === 'fog')
            ? `<img src="${cloudBadge}" alt="" draggable="false" style="width:100%;height:100%;object-fit:contain" />`
            : weatherIconForMode(weatherMode)
        }
        weatherTemp={weather ? `${weather.temp}°${usesFahrenheit() ? 'F' : 'C'}` : null}
        introDestinations={INTRO_LANDMARKS}
        streetView={streetView}
        onIntroComplete={handleIntroComplete}
        onGlobeReady={handleGlobeReady}
      />

      {/* ── Clay GPS navigation: destination → route → drive in clay street view ── */}
      <ClayNav
        openSignal={directionsSignal}
        mapRef={mapRef}
        token={TOKEN}
        theme={theme}
        routeOrigin={navigationOrigin}
        onRouteIntent={handleRouteIntent}
        streetView={streetView}
        setStreetView={setStreetView}
        say={setTourLine}
      />


      {/* ── Top chrome: provided clay logo + wordmark, with the AI line ── */}
      <TopChrome />
      {/* The clay mute lives UP beside the logo (title row, left) — always
          present; silences every map sound through the shared audio gate. */}
      <div className={styles.headerVolume}>
        <ClayMuteButton
          muted={muted}
          size={44}
          onToggle={() => { const next = !muted; setUserMuted(next); setMuted(next); if (!next) playPop(0.2) }}
        />
        <button
          type="button"
          className={styles.mapModeToggle}
          data-mode={currentMapMode}
          aria-label={`Switch to ${currentMapMode === '2d' ? '3D' : '2D'} map`}
          aria-pressed={currentMapMode === '3d'}
          onClick={() => { playPop(0.25); handleToggleMapMode() }}
        >
          <span className={styles.mapModeClay} aria-hidden="true">
            <span className={styles.mapModeClayDepth}>{currentMapMode.toUpperCase()}</span>
            <span className={styles.mapModeClayFace}>{currentMapMode.toUpperCase()}</span>
          </span>
        </button>
      </div>
      {/* The weather overlay itself: rain, snow, hail, lightning over the map.
          It had never been mounted, so every weather change was invisible. */}
      <WeatherFX mode={weatherMode} />

      {/* Top right, level with the sound mark: location stays nearest the
          centered title while Search sits on the protected outer edge. */}
      <div className={styles.mapTools}>
        <ClayCornerButton
          kind="locate"
          label="Go to my location"
          size={56}
          still
          activateOnClick
          onPress={() => {
            playPop(0.25)
            const map = mapRef.current as unknown as { __locateMe?: () => void } | null
            if (map?.__locateMe) { map.__locateMe(); return }
            navigator.geolocation?.getCurrentPosition(
              pos => flyToPlace([pos.coords.longitude, pos.coords.latitude], 'Current location'),
              () => { /* permission refused — nothing to fly to */ },
              { enableHighAccuracy: true, timeout: 8000 },
            )
          }}
        />
        <ClayCornerButton
          kind="search"
          label={searchOpen ? 'Close search' : 'Search places'}
          size={56}
          still
          activateOnClick
          onPress={() => { playPop(0.25); if (searchOpen) closeSearch(); else setSearchOpen(true) }}
        />
      </div>

      {searchOpen && (
        <div className={styles.searchScrim} onClick={closeSearch}>
        <div
          className={searchClosing ? `${styles.searchPanel} ${styles.searchPanelOut}` : styles.searchPanel}
          onClick={e => e.stopPropagation()}
        >
          <input
            className={styles.searchInput}
            value={searchText}
            placeholder="Search places…"
            autoFocus
            onChange={e => { setSearchText(e.target.value); void runPlaceSearch(e.target.value) }}
            onKeyDown={e => { if (e.key === 'Enter') void runPlaceSearch(searchText) }}
          />
          {!searching && searchText.trim() === '' && (
            <div className={styles.searchShortcuts}>
              <div className={styles.searchShortcutTitle}>GO NOW</div>
              <div className={styles.searchShortcutGrid}>
                {SEARCH_SHORTCUTS.map(destination => (
                  <button
                    key={destination.id}
                    type="button"
                    className={styles.searchShortcut}
                    onClick={() => flyToPlace(destination.coords, destination.name)}
                  >
                    <span>{displayPlaceName(destination.name)}</span>
                    <small>{TOUR_KIND_LABEL[destination.kind]}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {searching && <div className={styles.searchNote}>searching…</div>}
          {!searching && searchHits.map(hit => (
            <button
              key={hit.name}
              type="button"
              className={styles.searchHit}
              onClick={() => flyToPlace(hit.center, hit.name)}
            >
              {hit.name}
            </button>
          ))}
          {!searching && !searchHits.length && searchText.trim() !== '' && (
            <div className={styles.searchNote}>nothing found</div>
          )}
        </div>
        </div>
      )}

      {/* The map status stays deliberately terse: the place the camera is at.
          When the line still overruns the ticker, it glides back and forth so
          the tail is read rather than amputated by an ellipsis. */}
      <div className={styles.headerStack}>
        <div className={styles.aiTicker} aria-live="polite" ref={tickerRef}>
          <span
            key={currentPlace}
            className={tickerOverflow > 0 ? styles.tickerScroll : undefined}
            style={{ '--tickerShift': `-${tickerOverflow}px` } as React.CSSProperties}
          >
            {currentPlace}
          </span>
        </div>
      </div>

      {/* Locate + Street View moved into the HOLD MENU (declutter): they now
          arrive as poplur-map-action messages — see the listener effect. */}

      {/* The home cube lives in the app shell now (it's the post-login cube),
          so the map no longer renders one of its own. */}
    </div>
  )
}
