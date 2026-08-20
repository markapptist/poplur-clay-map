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
// Three ways in, all landing in the same place:
//   addPostedTrack()      the studio, once it can render an upload
//   addSoundCloudTrack()  an artist's existing SoundCloud track, resolved
//                         through SoundCloud's public oEmbed endpoint so the
//                         title and artist are THEIRS and not something we
//                         typed in
//   window.__poplurAddMusic(url)   the same thing from the console, so links
//                         can be dropped in without a build

import { TRACKS, type Track } from './musicLibrary'
import { HOME } from './reach'

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

/** Tracks people have posted, newest first. */
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
  const posts = postedTracks()
  const seen = new Set(posts.map(t => t.id))
  return [...posts, ...TRACKS.filter(t => !seen.has(t.id))]
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
