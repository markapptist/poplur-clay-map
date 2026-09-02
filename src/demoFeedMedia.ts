import { useEffect, useState } from 'react'
import { feedUrl } from './assetPacks'
import { isLiveSimulationEnabled, onLiveSimulationChange } from './simulationControl'
import { isNativeShell } from './nativeBridge'
import { feedMixSequence, onFeedMixChange, readFeedMix, type FeedMix } from './feedMixControl'

/**
 * The Feed's demo creatives — the same curated set the native iOS feed carries
 * in FeedView.swift's `poplurChannelAdCreatives`, with its city, coordinates,
 * radius and view count preserved so both platforms demo identical content.
 *
 * Native streams them from Google Drive (`googleDriveMediaURL(fileID:)`). The
 * web does not: the identical files already ship in the `feed` asset pack as
 * ad-*.mp4 with matching posters, so they play from the pack instead. That is
 * deliberate — FeedView.swift's own comment records that Drive serves an HTML
 * sign-in page rather than video bytes for private or large files, which is
 * exactly the failure the pack avoids.
 *
 * The Feed renders published Firestore rows and nothing else — a wiped
 * collection produces a genuinely empty channel rather than bundled media
 * pretending to be user activity. That guarantee stays intact: these rows are
 * additive, marked `demo`, ordered BEHIND every real post, and present only
 * while the workbench simulation switch is on (default off, admin-gated).
 */

export interface DemoCreative {
  id: string
  channelId: string
  /** File inside the `feed` asset pack; poster shares its stem. */
  file: string
  headline: string
  city: string
  flag: string
  coords: [number, number]
  radiusMeters: number
  viewCount: number
}

/** Mirrors FeedView.swift `poplurChannelAdCreatives`. Keep the two in step:
 *  a creative added there should gain its ad-*.mp4 here, and vice versa. */
export const DEMO_CREATIVES: readonly DemoCreative[] = [
  { id: 'food-drive-ad', channelId: 'food', file: 'ad-food.mp4', headline: 'Poplur Food is serving nearby', city: 'Tokyo', flag: '🇯🇵', coords: [139.6503, 35.6762], radiusMeters: 135_000, viewCount: 1_010 },
  { id: 'sports-drive-ad', channelId: 'sports', file: 'ad-sports.mp4', headline: 'Sports energy is live', city: 'New York', flag: '🇺🇸', coords: [-73.9262, 40.8296], radiusMeters: 160_000, viewCount: 1_104 },
  { id: 'shopping-drive-ad', channelId: 'shopping', file: 'ad-shopping.mp4', headline: 'Shopping drops are nearby', city: 'Toronto', flag: '🇨🇦', coords: [-79.3807, 43.6544], radiusMeters: 125_000, viewCount: 980 },
  { id: 'music-drive-ad', channelId: 'music', file: 'ad-music.mp4', headline: 'Music is moving through the city', city: 'Los Angeles', flag: '🇺🇸', coords: [-118.2437, 34.0522], radiusMeters: 150_000, viewCount: 1_070 },
  { id: 'cartoon-drive-ad', channelId: 'cartoon', file: 'ad-cartoon.mp4', headline: 'Cartoon worlds are live', city: 'Burbank', flag: '🇺🇸', coords: [-118.3534, 34.1381], radiusMeters: 118_000, viewCount: 875 },
  { id: 'kids-drive-ad', channelId: 'kids', file: 'ad-kids.mp4', headline: 'Kids channel is playing', city: 'Orlando', flag: '🇺🇸', coords: [-81.3789, 28.5384], radiusMeters: 110_000, viewCount: 820 },
  { id: 'comedy-drive-ad', channelId: 'comedy', file: 'ad-comedy.mp4', headline: 'Comedy is going live', city: 'Chicago', flag: '🇺🇸', coords: [-87.6298, 41.8781], radiusMeters: 120_000, viewCount: 925 },
  { id: 'spanish-drive-ad-1', channelId: 'spanish', file: 'ad-spanish-1.mp4', headline: 'El canal en español está en vivo', city: 'Madrid', flag: '🇪🇸', coords: [-3.7038, 40.4168], radiusMeters: 130_000, viewCount: 940 },
  { id: 'spanish-drive-ad-2', channelId: 'spanish', file: 'ad-spanish-2.mp4', headline: 'Contenido en español cerca de ti', city: 'Mexico City', flag: '🇲🇽', coords: [-99.1332, 19.4326], radiusMeters: 140_000, viewCount: 1_015 },
  { id: 'spanish-drive-ad-3', channelId: 'spanish', file: 'ad-spanish-3.mp4', headline: 'La energía latina está en vivo', city: 'Bogotá', flag: '🇨🇴', coords: [-74.0721, 4.7110], radiusMeters: 120_000, viewCount: 865 },
  { id: 'french-drive-ad', channelId: 'french', file: 'ad-french.mp4', headline: 'La chaîne française est en direct', city: 'Paris', flag: '🇫🇷', coords: [2.3522, 48.8566], radiusMeters: 130_000, viewCount: 955 },
]

export interface DemoFeedPost {
  id: string
  user: string
  /** Empty for a photo card, which has no clip to decode. */
  video: string
  poster: string
  mediaType: 'video' | 'photo'
  caption: string
  place: string
  reachKm: number
  createdAtMillis: number
  viewCount: number
  likeCount: number
  commentCount: number
  shareCount: number
  originLatitude: number
  originLongitude: number
  locationVisibility: 'approximate'
  demo: true
}

export interface DemoChannelIdentity {
  id: string
  user: string
  caption: string
}

/** FNV-1a. The engagement numbers native does not carry are derived from the
 *  creative id, so they are identical on every render, reload and device — a
 *  like total that moves on its own reads as broken, not as busy. */
function hash(value: string): number {
  let out = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    out ^= value.charCodeAt(index)
    out = Math.imul(out, 16_777_619)
  }
  return out >>> 0
}

function between(seed: number, minimum: number, maximum: number): number {
  return minimum + (seed % Math.max(1, maximum - minimum))
}

/** Poster path for a creative: same stem, under the pack's posters/ folder. */
export function demoPosterFile(file: string): string {
  return `posters/${file.replace(/\.mp4$/, '.jpg')}`
}

/**
 * Demo rows for one channel, ordered widest-reaching first to match the
 * channel ordering contract.
 */
export function demoPostsForChannel(
  channel: DemoChannelIdentity,
  now = Date.now(),
): DemoFeedPost[] {
  return DEMO_CREATIVES
    .filter(creative => creative.channelId === channel.id)
    .map(creative => {
      const seed = hash(creative.id)
      const likeCount = Math.round(creative.viewCount / between(seed, 3, 9))
      return {
        id: creative.id,
        user: channel.user,
        video: feedUrl(creative.file),
        poster: feedUrl(demoPosterFile(creative.file)),
        mediaType: 'video' as const,
        caption: creative.headline,
        place: creative.city,
        reachKm: creative.radiusMeters / 1_000,
        createdAtMillis: now - between(seed >>> 3, 5, 72) * 3_600_000,
        viewCount: creative.viewCount,
        likeCount,
        commentCount: Math.max(0, Math.round(likeCount / between(seed >>> 11, 6, 20))),
        shareCount: Math.max(0, Math.round(likeCount / between(seed >>> 13, 14, 40))),
        originLatitude: creative.coords[1],
        originLongitude: creative.coords[0],
        locationVisibility: 'approximate' as const,
        demo: true as const,
      }
    })
    .sort((left, right) => right.reachKm - left.reachKm)
}

/** Demo rows exist only while the workbench simulation is on. */
export function demoFeedEnabled(): boolean {
  return isLiveSimulationEnabled()
}

/** Re-renders the caller when the simulation switch flips, so toggling it
 *  takes effect without a reload. The media itself ships in the asset pack,
 *  so there is nothing to fetch. */
export function useDemoFeedMedia(): boolean {
  const [enabled, setEnabled] = useState(demoFeedEnabled)
  const [, forceBlendRefresh] = useState(0)
  useEffect(() => {
    const offSimulation = onLiveSimulationChange(() => setEnabled(demoFeedEnabled()))
    // A mix change reorders the blend, so the feed has to re-read it too.
    const offMix = onFeedMixChange(() => forceBlendRefresh(value => value + 1))
    return () => { offSimulation(); offMix() }
  }, [])
  return enabled
}

/**
 * The branded photo cards, mapped onto existing Feed channels.
 *
 * Six of the card categories have no channel of their own (CLOTHES, NATURE,
 * WOMEN, SELFIES, GYM, CARS), so they ride on the nearest existing one. That
 * also fills four channels the video creatives never covered — beauty,
 * fashion, news and tech.
 *
 * `likeCount` is the number printed ON the card artwork. It is not derived,
 * because a card that reads 15.3K under a UI counter showing anything else
 * looks broken rather than busy.
 */
export interface DemoPhoto {
  id: string
  /** The card's own category, as printed on its badge. */
  category: string
  channelId: string
  file: string
  headline: string
  city: string
  coords: [number, number]
  radiusMeters: number
  likeCount: number
}

export const DEMO_PHOTOS: readonly DemoPhoto[] = [
  { id: 'photo-sports', category: 'SPORTS', channelId: 'sports', file: 'poplur-sports.jpg', headline: 'Poplur takes the pitch', city: 'London', coords: [-0.1276, 51.5072], radiusMeters: 153_000, likeCount: 15_300 },
  { id: 'photo-gym', category: 'GYM', channelId: 'sports', file: 'poplur-gym.jpg', headline: 'Strong. Focused. Poplur.', city: 'Los Angeles', coords: [-118.2437, 34.0522], radiusMeters: 94_000, likeCount: 9_400 },
  { id: 'photo-clothes', category: 'CLOTHES', channelId: 'fashion', file: 'poplur-clothes.jpg', headline: 'The Poplur drop just landed', city: 'New York', coords: [-73.9352, 40.7306], radiusMeters: 98_000, likeCount: 9_800 },
  { id: 'photo-fashion', category: 'FASHION', channelId: 'fashion', file: 'poplur-fashion.jpg', headline: 'Runway, Poplur pink', city: 'Milan', coords: [9.1900, 45.4642], radiusMeters: 127_000, likeCount: 12_700 },
  { id: 'photo-music', category: 'MUSIC', channelId: 'music', file: 'poplur-music.jpg', headline: 'Live from the booth', city: 'Los Angeles', coords: [-118.2437, 34.0522], radiusMeters: 146_000, likeCount: 14_600 },
  { id: 'photo-news', category: 'NEWS', channelId: 'news', file: 'poplur-news.jpg', headline: 'Poplur hits 10 million users', city: 'New York', coords: [-74.0060, 40.7128], radiusMeters: 102_000, likeCount: 10_200 },
  { id: 'photo-nature', category: 'NATURE', channelId: 'news', file: 'poplur-nature.jpg', headline: 'Golden hour on the lake', city: 'Banff', coords: [-115.5708, 51.1784], radiusMeters: 126_000, likeCount: 12_600 },
  { id: 'photo-tech', category: 'TECH', channelId: 'tech', file: 'poplur-tech.jpg', headline: 'Desk setup, Poplur edition', city: 'Tokyo', coords: [139.6503, 35.6762], radiusMeters: 134_000, likeCount: 13_400 },
  { id: 'photo-cars', category: 'CARS', channelId: 'tech', file: 'poplur-cars.jpg', headline: 'Night drive through the grid', city: 'Chicago', coords: [-87.6298, 41.8781], radiusMeters: 108_000, likeCount: 10_800 },
  { id: 'photo-kids', category: 'KIDS', channelId: 'kids', file: 'poplur-kids.jpg', headline: 'Play, learn, smile', city: 'Orlando', coords: [-81.3789, 28.5384], radiusMeters: 129_000, likeCount: 12_900 },
  { id: 'photo-shopping', category: 'SHOPPING', channelId: 'shopping', file: 'poplur-shopping.jpg', headline: 'Shop, slay, repeat', city: 'Toronto', coords: [-79.3807, 43.6544], radiusMeters: 152_000, likeCount: 15_200 },
  { id: 'photo-women', category: 'WOMEN', channelId: 'shopping', file: 'poplur-women.jpg', headline: 'The everyday carry', city: 'Paris', coords: [2.3522, 48.8566], radiusMeters: 83_000, likeCount: 8_300 },
  { id: 'photo-comedy', category: 'COMEDY', channelId: 'comedy', file: 'poplur-comedy.jpg', headline: 'Laugh more', city: 'Chicago', coords: [-87.6298, 41.8781], radiusMeters: 97_000, likeCount: 9_700 },
  { id: 'photo-french', category: 'FRENCH', channelId: 'french', file: 'poplur-french.jpg', headline: "C'est la vie", city: 'Paris', coords: [2.3522, 48.8566], radiusMeters: 106_000, likeCount: 10_600 },
  { id: 'photo-spanish', category: 'SPANISH', channelId: 'spanish', file: 'poplur-spanish.jpg', headline: 'Vive, ríe, ama', city: 'Mexico City', coords: [-99.1332, 19.4326], radiusMeters: 113_000, likeCount: 11_300 },
  { id: 'photo-selfies', category: 'SELFIES', channelId: 'beauty', file: 'poplur-selfies.jpg', headline: 'Ring light on, Poplur on', city: 'Toronto', coords: [-79.3832, 43.6532], radiusMeters: 157_000, likeCount: 15_700 },
  { id: 'photo-food', category: 'FOOD', channelId: 'food', file: 'poplur-food.jpg', headline: 'Double stack, pink shake', city: 'Toronto', coords: [-79.4005, 43.6547], radiusMeters: 112_000, likeCount: 11_200 },
]

/**
 * Which card files are actually present in `public/feed/photos/`.
 *
 * The mapping above is complete, but a card whose file has not been added yet
 * must not reach the Feed — a missing image renders as a broken fullscreen
 * post. Add the file, add its name here, and it goes live.
 */
export const DEMO_PHOTO_FILES_AVAILABLE: ReadonlySet<string> = new Set<string>([
  // e.g. 'poplur-sports.jpg'
])

export function availableDemoPhotos(): DemoPhoto[] {
  return DEMO_PHOTOS.filter(photo => DEMO_PHOTO_FILES_AVAILABLE.has(photo.file))
}

export function demoPhotosForChannel(
  channel: DemoChannelIdentity,
  now = Date.now(),
): DemoFeedPost[] {
  return availableDemoPhotos()
    .filter(photo => photo.channelId === channel.id)
    .map(photo => {
      const seed = hash(photo.id)
      return {
        id: photo.id,
        user: channel.user,
        video: '',
        poster: feedUrl(`photos/${photo.file}`),
        mediaType: 'photo' as const,
        caption: photo.headline,
        place: photo.city,
        reachKm: photo.radiusMeters / 1_000,
        createdAtMillis: now - between(seed >>> 3, 5, 72) * 3_600_000,
        // The card prints its own like count; views and the rest hang off it.
        likeCount: photo.likeCount,
        viewCount: photo.likeCount * between(seed >>> 7, 6, 18),
        commentCount: Math.max(0, Math.round(photo.likeCount / between(seed >>> 11, 40, 120))),
        shareCount: Math.max(0, Math.round(photo.likeCount / between(seed >>> 13, 90, 240))),
        originLatitude: photo.coords[1],
        originLongitude: photo.coords[0],
        locationVisibility: 'approximate' as const,
        demo: true as const,
      }
    })
    .sort((left, right) => right.reachKm - left.reachKm)
}

/**
 * Google inventory is AdMob, and AdMob is a native SDK — there is no AdMob for
 * a web page. The shell already owns it: AdManager.swift loads the interstitial
 * from `PoplurAdMobInterstitialUnitID`, and FeedAdProbability.swift owns the
 * placement split (content / poplurAd / googleMobileAd). The web's job is to
 * report the share it wants, not to render an ad.
 *
 * So ad inventory is "can this shell serve one", which is false in the browser
 * workbench however the sliders are set. The mixer shows that rather than
 * implying a slot the preview could never fill.
 */
export function googleAdsAvailable(): boolean {
  return isNativeShell()
}

/** What each demo source can actually supply right now. */
export function demoInventory(): { photos: number; videos: number; ads: number } {
  return {
    photos: availableDemoPhotos().length,
    videos: DEMO_CREATIVES.length,
    // Served by AdMob on demand, so it is a capability rather than a count.
    ads: googleAdsAvailable() ? Number.POSITIVE_INFINITY : 0,
  }
}

/**
 * The channel's demo rows, blended photo-card against video-creative in the
 * ratio the mixer holds.
 *
 * Google's share is deliberately absent from this list: an AdMob placement is
 * a native interstitial the shell presents between channels, not a row the web
 * feed renders. feedMixControl forwards that share to the shell instead.
 */
export function blendedDemoPostsForChannel(
  channel: DemoChannelIdentity,
  mix: FeedMix = readFeedMix(),
  now = Date.now(),
): DemoFeedPost[] {
  const photos = demoPhotosForChannel(channel, now)
  const videos = demoPostsForChannel(channel, now)
  if (!photos.length) return videos
  if (!videos.length) return photos

  // Re-weight to the two sources that produce rows, so an ads share of 30 does
  // not silently shrink the channel — it is spent natively, not here.
  const sequence = feedMixSequence(
    { photos: mix.photos, videos: mix.videos, ads: 0 },
    photos.length + videos.length,
  )
  const queues = { photos: [...photos], videos: [...videos] }
  const out: DemoFeedPost[] = []
  sequence.forEach(source => {
    const queue = source === 'photos' ? queues.photos : queues.videos
    const next = queue.shift() ?? queues.photos.shift() ?? queues.videos.shift()
    if (next) out.push(next)
  })
  return out
}
