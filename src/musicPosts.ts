// ── The shelf: where posted music lands ─────────────────────────────────────
//
// The studio does not exist yet, so nothing writes to this from inside the app
// yet. That is the ONLY thing missing: a posted track arriving here is picked
// up, gated by radius and played exactly like a seeded one, because the shelf
// is what the handheld reads — not the seed array.
//
// A post is a track PLUS the ground it was left on. That pair is the whole
// product: an artist drops a track where they are, and it is only audible to
// people whose radius reaches that spot. Seeds have no ground of their own and
// get pinned to a pop deterministically; a real post never is, because it
// genuinely happened somewhere.
//
// WHERE A REAL POST LIVES: on the user's ACCOUNT, as a URL — never as bytes in
// this app. The account row carries a pointer plus the ground it was left on,
// and the handheld streams from that pointer. Two kinds of pointer, and the
// difference is not cosmetic:
//
//   url        a file Poplur hosts (Firebase Storage / GCS). A genuine stream
//              URL: fetchable, decodable, ours. This is what an upload writes.
//   permalink  a SoundCloud track link. NOT a stream URL — SoundCloud does not
//              hand out playable media URLs to third parties, so what the
//              account stores is the pointer to THEIR player.
//
// The account is read the same way the profile grid reads its posts: ask the
// authenticated shell (`requestProfileTracks`), receive Firestore rows back
// over the bridge. Outside a native shell there is no authenticated user, so
// the local store below stands in — same fallback shape the rest of the app
// already uses for profile media.
//
// Four ways in, all landing in the same place:
//   addPostedTrack()      the studio, once it can render an upload
//   addSoundCloudTrack()  an artist's existing SoundCloud track, resolved
//                         through SoundCloud's public oEmbed endpoint so the
//                         title and artist are THEIRS and not something we
//                         typed in
//   window.__poplurAddMusic(url)   the same thing from the console, so links
//                         can be dropped in without a build
//   the account          rows the native shell reads out of the signed-in
//                         user's Firestore document

import { TRACKS, type Track } from './musicLibrary'
import { HOME } from './reach'
import { isNativeShell, postNativeEvent } from './nativeBridge'

const POST_KEY = 'poplur.music.posts.v1'
export const MUSIC_POSTS_CHANGE_EVENT = 'poplur-music-posts-change'
/** dispatch this with `detail: Track` to post from anywhere (studio, native) */
export const MUSIC_POST_EVENT = 'poplur-music-post'

function readJson<T>(key: string, fallback: T): T {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* embedded/private mode */ }
}

function announce() {
  try { window.dispatchEvent(new Event(MUSIC_POSTS_CHANGE_EVENT)) } catch { /* SSR */ }
}

// ── the account ────────────────────────────────────────────────────────────
// Held in memory for the session, not mirrored into localStorage: the account
// is the source of truth and a stale local copy of someone's library is a
// liability, not a cache. A refresh REPLACES this wholesale, the same way the
// profile grid replaces its posts.
let accountTracks: Track[] = []
let nearbyTracks: Track[] = []
let nearbyTrackRequest = 0

/** One Firestore row → a Track, or null if it names no playable pointer. */
function accountTrack(row: Record<string, unknown>): Track | null {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const id = str(row.id)
  const url = str(row.url)
  const permalink = str(row.permalink)
  // A row with no pointer is not a track — it is a placeholder somebody wrote
  // half of, and playing it would fail with no way to say why.
  if (!id || (!url && !permalink)) return null
  const lat = num(row.lat)
  const lng = num(row.lng)
  return {
    id,
    title: str(row.title) ?? 'Untitled',
    artist: str(row.artist) ?? str(row.postedBy) ?? 'Poplur artist',
    bpm: num(row.bpm) ?? 120,
    root: num(row.root) ?? 0,
    mood: str(row.mood) ?? 'POSTED',
    duration: num(row.duration) ?? 0,
    source: url ? { kind: 'upload', url } : { kind: 'soundcloud', permalink: permalink as string },
    place: str(row.place) ?? 'Here',
    // Firestore stores lat/lng; the map and the radius both speak [lng, lat].
    coords: lat != null && lng != null ? [lng, lat] : undefined,
    postedBy: str(row.postedBy) ?? undefined,
    postedAt: num(row.postedAt) ?? undefined,
    licence: str(row.licence) ?? undefined,
  }
}

/**
 * Ask the signed-in shell for this user's tracks and keep them in step.
 *
 * Mirrors ProfileTwin's `requestProfilePosts`: the web has no Firestore
 * credentials of its own, so the authenticated native side does the read and
 * hands back rows. Outside a native shell this does nothing at all and the
 * local store stands in.
 */
export function startAccountTrackIntake(): () => void {
  const receive = (event: Event) => {
    const payload = (event as CustomEvent<{ tracks?: unknown }>).detail
    const rows = Array.isArray(payload?.tracks) ? payload.tracks : []
    accountTracks = rows.flatMap(row => {
      const track = row && typeof row === 'object' ? accountTrack(row as Record<string, unknown>) : null
      return track ? [track] : []
    })
    announce()
  }
  window.addEventListener('poplur-native-profile-tracks', receive)
  if (isNativeShell()) postNativeEvent({ type: 'requestProfileTracks' })
  return () => window.removeEventListener('poplur-native-profile-tracks', receive)
}

/**
 * Ask the native/authenticated shell for Studio tracks posted by people near
 * this listener. This is deliberately separate from requestProfileTracks,
 * which is the signed-in artist's own library and cannot discover anyone else.
 */
export function startNearbyTrackIntake(
  lat: number,
  lng: number,
  radiusKm: number,
): () => void {
  const requestId = `nearby_tracks_${++nearbyTrackRequest}`
  nearbyTracks = []
  announce()
  const receive = (event: Event) => {
    const payload = (event as CustomEvent<{ requestId?: unknown; tracks?: unknown }>).detail
    if (payload?.requestId !== requestId) return
    const rows = Array.isArray(payload.tracks) ? payload.tracks : []
    nearbyTracks = rows.flatMap(row => {
      const track = row && typeof row === 'object' ? accountTrack(row as Record<string, unknown>) : null
      return track ? [track] : []
    })
    announce()
  }
  window.addEventListener('poplur-native-nearby-tracks', receive)
  if (isNativeShell()) {
    postNativeEvent({
      type: 'requestNearbyTracks',
      requestId,
      latitude: lat,
      longitude: lng,
      radiusKm,
    })
  }
  return () => window.removeEventListener('poplur-native-nearby-tracks', receive)
}

/** What the account has handed back this session. */
export function accountShelf(): Track[] {
  return accountTracks
}

/** Tracks posted on THIS device, newest first — the stand-in for an account
 *  while there is no signed-in shell to ask. */
export function postedTracks(): Track[] {
  return readJson<Track[]>(POST_KEY, [])
    .filter(t => t && typeof t.id === 'string' && t.source)
    .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
}

/**
 * Everything the handheld can see: posts first, because a shelf that buries
 * new music under five stand-ins is not a shelf anyone would post to.
 */
export function musicShelf(): Track[] {
  // Account first — it is the real library. Local posts next, seeds last, and
  // an id already seen never appears twice: an account row WINS over the local
  // copy of the same track, because the account is what other people see.
  const seen = new Set<string>()
  const shelf: Track[] = []
  for (const track of [...nearbyTracks, ...accountTracks, ...postedTracks(), ...TRACKS]) {
    if (seen.has(track.id)) continue
    seen.add(track.id)
    shelf.push(track)
  }
  return shelf
}

function save(tracks: Track[]) {
  writeJson(POST_KEY, tracks)
  announce()
}

/** Post a track. Returns what was stored. */
export function addPostedTrack(track: Track): Track {
  const stored: Track = {
    ...track,
    postedAt: track.postedAt ?? Date.now(),
    coords: track.coords ?? (HOME as [number, number]),
    place: track.place ?? 'Here',
  }
  // Re-posting the same id replaces rather than duplicates — an artist fixing
  // a title should not end up with the track on the ground twice.
  save([stored, ...postedTracks().filter(t => t.id !== stored.id)])
  return stored
}

export function removePostedTrack(id: string) {
  save(postedTracks().filter(t => t.id !== id))
}

/**
 * Put an artist's SoundCloud track on the shelf.
 *
 * The title and artist come from SoundCloud's own public oEmbed endpoint, so
 * the credit is whatever the artist actually published it under. Their audio is
 * NOT fetched — the handheld plays it inside SoundCloud's embedded player,
 * which is the route SoundCloud publishes for this. Anything that reached into
 * the stream directly would be against their terms.
 */
export async function addSoundCloudTrack(
  permalink: string,
  opts: { place?: string; coords?: [number, number]; mood?: string } = {},
): Promise<Track> {
  const clean = permalink.trim().split('?')[0]
  if (!/^https?:\/\/(www\.)?soundcloud\.com\/[^/]+\/[^/]+/.test(clean)) {
    throw new Error('that is not a SoundCloud track link')
  }
  const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(clean)}`)
  if (!res.ok) throw new Error(`SoundCloud did not recognise that link (${res.status})`)
  const meta = await res.json() as { title?: string; author_name?: string }
  // oEmbed titles read "Track Name by Artist"; the artist is its own field, so
  // strip the suffix rather than showing it twice.
  const author = meta.author_name?.trim() || 'SoundCloud'
  const rawTitle = meta.title?.trim() || clean.split('/').pop() || 'Untitled'
  const title = rawTitle.replace(new RegExp(`\\s+by\\s+${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '')

  return addPostedTrack({
    id: `sc-${clean.split('/').slice(-2).join('-')}`,
    title,
    artist: author,
    // The widget reports the real numbers once it loads; these only feed the
    // stand-in synth, which a SoundCloud track never uses.
    bpm: 120,
    root: 0,
    mood: opts.mood ?? 'POSTED',
    duration: 0,
    source: { kind: 'soundcloud', permalink: clean },
    place: opts.place ?? 'Here',
    coords: opts.coords ?? (HOME as [number, number]),
    postedBy: author,
    licence: 'soundcloud-embed',
  })
}

/** Studio / native intake: dispatch MUSIC_POST_EVENT with a Track in detail. */
export function startMusicPostIntake(): () => void {
  const onPost = (event: Event) => {
    const track = (event as CustomEvent<Track>).detail
    if (track && typeof track.id === 'string') addPostedTrack(track)
  }
  window.addEventListener(MUSIC_POST_EVENT, onPost)
  return () => window.removeEventListener(MUSIC_POST_EVENT, onPost)
}

// Console hook, so links go in without a rebuild while the studio is being
// built. Returns the stored track so a paste shows what it actually resolved.
declare global {
  interface Window {
    __poplurAddMusic?: (url: string, opts?: Parameters<typeof addSoundCloudTrack>[1]) => Promise<Track>
    __poplurMusicShelf?: () => Track[]
  }
}
if (typeof window !== 'undefined') {
  window.__poplurAddMusic = addSoundCloudTrack
  window.__poplurMusicShelf = musicShelf
}
