import React, { useRef, useState, useCallback, useEffect } from 'react'
import mapboxgl from 'mapbox-gl'
import { POIS, MAP_THEMES } from './data'
import ClayMap from './ClayMap'
import ClayNav from './ClayNav'
import TopChrome from './TopChrome'
import WeatherFX, { modeForCode } from './WeatherFX'
import type { WeatherMode } from './WeatherFX'
import ViewHarness, { harnessViewFromLocation } from './ViewHarness'
import { announceMapTour, startMapRadio, stopMapRadio, tuneLiveRadio } from './mapRadio'
import type { RadioStationCue } from './mapRadio'
import {
  startRegionAudio, stopRegionAudio, setRegionContext,
  startPoplurTheme, stopPoplurTheme, setVoiceDucked,
} from './regionAudio'
import type { RegionContext } from './regionAudio'
import { postNativeEvent } from './nativeBridge'
import { isUserMuted, setUserMuted } from './audioGate'
import { playPop } from './pop'
import VolumeBars from './VolumeBars'
import styles from './App.module.css'


const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string

// AI radio-host lines that rotate beneath the wordmark
const AI_LINES = [
  'People nearby are posting street food finds — share your take!',
  'Trending: skyline shots by the harbourfront',
  '3 new pops in Kensington Market right now',
  'Poplur Radio: lo-fi beats live from Queen West',
  'Fit checks are taking over Trinity Bellwoods today',
  'Night market energy building in Chinatown',
]

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

type TourKind = 'landmark' | 'mall' | 'arena' | 'school' | 'museum' | 'park' | 'district' | 'venue'

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
  'big-ben': 'london',
  wembley: 'london',
  'statue-liberty': 'newyork',
  met: 'newyork',
  'times-square': 'newyork',
  'madison-square-garden': 'newyork',
  'grand-central': 'newyork',
  giza: 'cairo',
  'christ-redeemer': 'rio',
  'taj-mahal': 'agra',
  'sydney-opera': 'sydney',
  colosseum: 'rome',
  'burj-khalifa': 'dubai',
  'dubai-mall': 'dubai',
  'space-needle': 'seattle',
  'golden-gate': 'bayarea',
  'mall-america': 'minneapolis',
  'west-edmonton-mall': 'edmonton',
  'ala-moana': 'honolulu',
  sofi: 'losangeles',
  'crypto-arena': 'losangeles',
  ucla: 'losangeles',
  'hollywood-bowl': 'losangeles',
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
]

const INTRO_LANDMARKS = TOUR_DESTINATIONS.filter(destination => destination.kind === 'landmark')

const RECOMMENDATIONS: ((destination: TourDestination) => string)[] = [
  destination => `Poplur Radio found ${destination.name}: nobody has posted from this ${TOUR_KIND_LABEL[destination.kind]} today`,
  destination => `AI host says ${destination.name} is live right now. Drop a pop there?`,
  destination => `Scanning ${destination.name}: big radius waiting at this ${TOUR_KIND_LABEL[destination.kind]}`,
  destination => `Your followers have not seen ${destination.name} today - go claim it`,
]

/** All modes, in the order you asked to browse them. */
const WEATHER_PREVIEW: { mode: WeatherMode; label: string }[] = [
  { mode: 'clear', label: 'Sunny' },
  { mode: 'cloudy', label: 'Cloudy' },
  { mode: 'rain', label: 'Rain' },
  { mode: 'thunder', label: 'Thunder' },
  { mode: 'storm', label: 'Thunder + lightning' },
  { mode: 'snow', label: 'Snow' },
  { mode: 'hail', label: 'Hail' },
]

// Keep every app-driven street flight close enough that 3D buildings are visible.
const BUILDING_REVEAL_ZOOM = 16.2 // matches ClayMap ZOOM_MAX cap
const DEFAULT_NAV_ORIGIN: [number, number] = [-79.3811, 43.6487]
const TOUR_FLIGHT_MS = 6200
const TOUR_DWELL_MS = 5 * 60 * 1000

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

function nearestTourDestination(center: [number, number]): TourDestination {
  return TOUR_DESTINATIONS.reduce((nearest, destination) =>
    distanceMeters(center, destination.coords) < distanceMeters(center, nearest.coords)
      ? destination
      : nearest,
  TOUR_DESTINATIONS[0])
}

function stationsSummary(stations: RadioStation[]): string {
  return stations.map(station => `${station.name} ${station.frequency}`).join(' / ')
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
  const harnessView = harnessViewFromLocation()
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>('queen')
  // Theme switching lives in the app's Profile → Settings; the prototype
  // ships the default clay skin with the infrastructure in place.
  const [theme] = useState(MAP_THEMES[0])
  const [aiIndex, setAiIndex] = useState(0)
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null)
  const [weatherOverride, setWeatherOverride] = useState<WeatherMode | null>(null)

  // Clock under the AI ticker: swings between the time and the date.
  const [clockNow, setClockNow] = useState(() => new Date())
  const [clockShowsDate, setClockShowsDate] = useState(false)
  useEffect(() => {
    const tick = window.setInterval(() => setClockNow(new Date()), 1000)
    const swing = window.setInterval(() => setClockShowsDate(v => !v), 4000)
    return () => { window.clearInterval(tick); window.clearInterval(swing) }
  }, [])
  const [dayTime, setDayTime] = useState(true)
  // The AI's live recommendation while it tours places (overrides the ticker)
  const [tourLine, setTourLine] = useState<string | null>(null)
  // Whether the app's music / AI voice is currently audible
  const [soundPlaying, setSoundPlaying] = useState(false)
  // User mute, toggled by the speaker mark beside the AI line.
  const [muted, setMuted] = useState(isUserMuted)
  const [streetView, setStreetView] = useState(false)
  // Routing must follow the user/launch location, not the AI tour camera. The
  // camera may be visiting another continent when an address is entered.
  const [navigationOrigin, setNavigationOrigin] = useState<[number, number]>(DEFAULT_NAV_ORIGIN)
  const soundPlayingRef = useRef(false)
  const lastTourDestinationRef = useRef<string | null>(null)
  // Region dialect for the Poplur theme (would come from the located region;
  // the dev panel lets you audition each).
  const [region, setRegion] = useState<NonNullable<RegionContext['region']>>('default')
  const regionRef = useRef(region)
  regionRef.current = region

  useEffect(() => {
    if (harnessView) return
    if (window.parent !== window) window.parent.postMessage({ type: 'poplur-map-loading' }, '*')
    postNativeEvent({ type: 'mapLoading' })
  }, [harnessView])

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

  const applySoundState = useCallback((on: boolean) => {
    soundPlayingRef.current = on
    setSoundPlaying(on)
    if (on) {
      startMapRadio()
      // Always-on regional ambience bed, plus the Poplur theme as the default
      // when no radio station is found (which, in this prototype, is always).
      startRegionAudio()
      startPoplurTheme(regionRef.current)
    } else {
      stopMapRadio()
      stopRegionAudio()
    }
  }, [])

  useEffect(() => {
    return () => { stopMapRadio(); stopRegionAudio() }
  }, [])

  // Re-voice the running theme when the region dialect changes.
  useEffect(() => {
    if (soundPlayingRef.current) { stopPoplurTheme(); startPoplurTheme(region) }
  }, [region])

  // Feed the ambient bed from what's under the camera: water → ocean, parks →
  // wind + birds, building density → city hum, night → crickets.
  const dayTimeRef = useRef(dayTime)
  dayTimeRef.current = dayTime
  useEffect(() => {
    if (!soundPlaying) return
    const sample = () => {
      const map = mapRef.current
      if (!map) return
      const el = map.getContainer()
      const cx = el.clientWidth / 2, cy = el.clientHeight / 2
      const box: [[number, number], [number, number]] = [[cx - 45, cy - 45], [cx + 45, cy + 45]]
      const has = (layers: string[]) => {
        for (const id of layers) {
          if (!map.getLayer(id)) continue
          try { if (map.queryRenderedFeatures(box, { layers: [id] }).length) return 1 } catch { /* absent */ }
        }
        return 0
      }
      const water = has(['water', 'water-shadow', 'Water'])
      const park = has(['landcover', 'national-park', 'park', 'landuse', 'Landcover'])
      // Building extrusions aren't reliably returned by queryRenderedFeatures,
      // so use a style-agnostic proxy: zoomed-in land that's neither water nor
      // park is "in the city", ramping with how close the camera is.
      let cityDensity = 0
      try { if (map.getLayer('clay-buildings-3d')) cityDensity = Math.min(1, map.queryRenderedFeatures({ layers: ['clay-buildings-3d'] }).length / 110) } catch { /* extrusions unqueryable */ }
      if (cityDensity === 0 && !water && !park) {
        cityDensity = Math.max(0, Math.min(1, (map.getZoom() - 12.5) / 3))
      }
      setRegionContext({ water, park, cityDensity, dayTime: dayTimeRef.current, region: regionRef.current })
    }
    sample()
    const iv = window.setInterval(sample, 1500)
    return () => window.clearInterval(iv)
  }, [soundPlaying])

  // Duck the whole bed under the AI radio host, mirroring the iOS voice-duck.
  useEffect(() => { setVoiceDucked(!!tourLine) }, [tourLine])

  // Rotating AI text under the title (stable node; fade retriggered manually)
  const tickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const iv = window.setInterval(() => setAiIndex(i => (i + 1) % AI_LINES.length), 4200)
    return () => window.clearInterval(iv)
  }, [])
  useEffect(() => {
    const el = tickerRef.current
    if (!el) return
    el.style.animation = 'none'
    void el.offsetWidth
    el.style.animation = ''
  }, [aiIndex])

  // Real weather + day/night for the map area (same open-meteo endpoint the
  // iOS app uses)
  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=43.65&longitude=-79.38&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto')
      .then(res => res.json())
      .then(json => {
        setWeather({ temp: Math.round(json.current.temperature_2m), code: json.current.weather_code })
        setDayTime(json.current.is_day === 1)
      })
      .catch(() => setWeather({ temp: 72, code: 1 }))
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
    // Tune a REAL local station for this stop (Radio Browser). Fire-and-forget:
    // the synth bed covers the gap and stays as fallback if nothing streams.
    void tuneLiveRadio(destination.coords[1], destination.coords[0]).then(stationName => {
      if (stationName) setTourLine(current => current ? `${current} Now streaming ${stationName}.` : current)
    })
    setTourLine(`${line}. Tuning ${stationsSummary(stations)}.`)
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
    applySoundState(true)
    announceMapTour(line, stations)
    flyToCenter(destination.coords, TOUR_FLIGHT_MS)
  }, [applySoundState, flyToCenter])

  // ── AI place tour: each stop holds for five minutes after arrival ─────────
  const tourStep = useCallback((preferredDestination?: TourDestination) => {
    const options = TOUR_DESTINATIONS.filter(destination => destination.id !== lastTourDestinationRef.current)
    const destination = preferredDestination ?? options[Math.floor(Math.random() * options.length)] ?? TOUR_DESTINATIONS[0]
    activateTourDestination(destination)
  }, [activateTourDestination])

  const startTourLoop = useCallback((initialDelayMs = 0, firstDestination?: TourDestination) => {
    clearTourTimers()
    tourStartedRef.current = true
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
    const nearest = landingCenter ? nearestTourDestination(landingCenter) : undefined
    setTourLine(nearest
      ? `Poplur AI is finding the nearest ${TOUR_KIND_LABEL[nearest.kind]} radio stop.`
      : 'Poplur AI is finding the next landmark radio stop.')
    startTourLoop(1200, nearest)
  }, [startTourLoop])

  const handleRouteIntent = useCallback(() => {
    clearTourTimers()
    const map = mapRef.current
    if (!map) return
    const mapApi = map as unknown as { __cinematic?: boolean; __stopOrbit?: () => void }
    mapApi.__cinematic = false
    mapApi.__stopOrbit?.()
    map.stop()
  }, [clearTourTimers])

  const handleSelectPoi = useCallback((id: string) => {
    setSelectedId(id)
    const poi = POIS.find(p => p.id === id)
    if (!poi) return
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
      {/* ── Full-screen clay map ── */}
      <ClayMap
        token={TOKEN}
        pois={POIS}
        selectedId={selectedId}
        onSelectPoi={handleSelectPoi}
        mapRef={mapRef}
        theme={theme}
        dayTime={dayTime}
        weatherMode={weatherMode}
        introDestinations={INTRO_LANDMARKS}
        streetView={streetView}
        onIntroComplete={handleIntroComplete}
        onGlobeReady={handleGlobeReady}
      />

      {/* ── Clay GPS navigation: destination → route → drive in clay street view ── */}
      <ClayNav
        mapRef={mapRef}
        token={TOKEN}
        theme={theme}
        routeOrigin={navigationOrigin}
        onRouteIntent={handleRouteIntent}
        streetView={streetView}
        setStreetView={setStreetView}
        say={setTourLine}
      />

      {/* ── Weather overlay effects (rain / storm / snow / cloudy / fog) ── */}
      <WeatherFX mode={weatherMode} />

      {/* ── Top chrome: provided clay logo + wordmark, with the AI line ── */}
      <TopChrome />
      <div ref={tickerRef} className={styles.aiTicker}>
        {soundPlaying && (
          // The mark is the mute control: tapping it silences every map sound
          // (radio, ambience, theme, pops) through the shared audio gate.
          <button
            type="button"
            className={muted ? styles.aiVolumeMuted : styles.aiVolume}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            aria-pressed={muted}
            onClick={() => { const next = !muted; setUserMuted(next); setMuted(next); if (!next) playPop(0.2) }}
            dangerouslySetInnerHTML={{ __html: muted ? VOLUME_MUTED_ICON : VOLUME_ICON }}
          />
        )}
        <span>{tourLine ?? AI_LINES[aiIndex]}</span>
      </div>

      {/* ── Clock: current time ⇄ date, swapping every few seconds ── */}
      <div className={styles.clock} aria-live="off">
        <span key={clockShowsDate ? 'date' : 'time'} className={styles.clockSwing}>
          {clockShowsDate
            ? clockNow.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
            : clockNow.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>

      <button
        type="button"
        className={styles.locateButton}
        aria-label="Go to current location"
        onClick={handleGoToCurrentLocation}
        dangerouslySetInnerHTML={{ __html: LOCATE_ICON }}
      />

      <button
        type="button"
        className={streetView ? styles.streetViewButtonActive : styles.streetViewButton}
        aria-label={streetView ? 'Exit Street View' : 'Enter Street View'}
        aria-pressed={streetView}
        onClick={handleToggleStreetView}
        dangerouslySetInnerHTML={{ __html: STREET_ICON }}
      />

      {/* ── Weather badge — left side, opposite the zoom slider ── */}
      {weather && (
        <div className={styles.weatherBadge}>
          <span className={styles.weatherIcon} dangerouslySetInnerHTML={{ __html: weatherIconForMode(weatherMode) }} />
          <span className={styles.weatherTemp}>{weather.temp}°</span>
        </div>
      )}

      {/* ── Dev-only: browse every weather mode ── */}
      {import.meta.env.DEV && (
        <div className={styles.weatherPicker}>
          {WEATHER_PREVIEW.map(w => (
            <button
              key={w.mode}
              type="button"
              className={weatherMode === w.mode ? styles.weatherPickerOn : undefined}
              onClick={() => setWeatherOverride(w.mode)}
            >
              {w.label}
            </button>
          ))}
          <button type="button" onClick={() => setWeatherOverride(null)}>Live</button>
        </div>
      )}

      {/* ── Dev-only: Poplur audio — toggle the bed + audition region dialects ── */}
      {import.meta.env.DEV && (
        <div className={styles.audioPicker}>
          <button
            type="button"
            className={soundPlaying ? styles.weatherPickerOn : undefined}
            onClick={() => applySoundState(!soundPlaying)}
          >
            {soundPlaying ? '♪ sound on' : '♪ sound off'}
          </button>
          {(['default', 'tokyo', 'tropical', 'europe', 'club'] as const).map(r => (
            <button
              key={r}
              type="button"
              className={region === r ? styles.weatherPickerOn : undefined}
              onClick={() => setRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* The home cube lives in the app shell now (it's the post-login cube),
          so the map no longer renders one of its own. */}
    </div>
  )
}
