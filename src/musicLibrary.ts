// ── Poplur's music ──────────────────────────────────────────────────────────
//
// Poplur is SoundCloud for underground artists, except the shelf is the ground.
// A track is not "in your library" — it was LEFT somewhere, and you hear it when
// your radius reaches the place it was left. Everything below exists to carry a
// posted track from wherever it came from to that rule.
//
// A track can come from three places, and the player treats them differently
// because it has to:
//
//   'upload'      a file Poplur hosts. THE REAL THING. Decoded into an
//                 AudioBuffer, so the handheld owns the clock, the level, the
//                 mute gate and the video editor's mix. Nothing here is
//                 waiting on anything: give a Track this source and it plays.
//
//   'soundcloud'  an artist's track played through SoundCloud's OWN embedded
//                 player. Their audio is not fetchable — pulling the stream
//                 into Web Audio is against their terms, and the widget is the
//                 route they publish for this. So it plays in an iframe, and
//                 the handheld drives it over the Widget API instead of the
//                 audio graph. Interim content until artists upload.
//
//   'synth'       the built-in stand-in, generated here from BPM and key. No
//                 third-party recording sits in this repo, so no build can
//                 ship someone's master by accident.
//
// The studio does not exist yet and nobody has posted, so the seeded library is
// still stand-ins. That is a CONTENT gap, not a mechanism gap — musicPosts.ts is
// the intake, and a track posted through it plays like any other.

import { poplurAssetCache } from './PoplurAssetCache'

/** Where a track's audio actually comes from. See the header. */
export type TrackSource =
  /** a file Poplur hosts — user uploads, and any licensed file we drop in */
  | { kind: 'upload'; url: string }
  /** an artist's track, played inside SoundCloud's own embedded player */
  | { kind: 'soundcloud'; permalink: string }
  /** generated stand-in, so the mechanism is testable with no recording */
  | { kind: 'synth' }

export interface Track {
  id: string
  title: string
  /** shown under the title; the rights holder for anything not a stand-in */
  artist: string
  /** beats per minute — drives the synthesised stand-in, and is genuinely
   *  useful metadata to keep for real tracks (beat-matched cuts later) */
  bpm: number
  /** musical key as semitone offset from A, for the stand-in's root note */
  root: number
  /** the mood chip shown in the picker */
  mood: string
  /** seconds. Real tracks report their own; stand-ins loop to fill. */
  duration: number
  /** where the audio comes from. Absent means the stand-in, so older callers
   *  that build a bare Track still work. */
  source?: TrackSource

  // ── what a POSTED track carries, and a seeded one does not ───────────────
  /** the pop it was dropped on. Without this the track gets pinned to a pop
   *  deterministically, which is what the seeds do. */
  place?: string
  /** [lng, lat] of the ground it was left on — this is what the radius
   *  measures against, so a real post is reachable exactly where it happened */
  coords?: [number, number]
  /** the poster's handle, for the artist line and the profile link later */
  postedBy?: string
  /** epoch ms, for ordering the shelf newest-first */
  postedAt?: number
  /** what the poster declared they had the right to post. Carried with the
   *  track so a takedown has something to match on. */
  licence?: string
}

/** The source a track actually has, defaulting bare tracks to the stand-in. */
export function trackSource(track: Track): TrackSource {
  return track.source ?? { kind: 'synth' }
}

/** The seeded shelf. Stand-ins until the studio ships — real posts arrive
 *  through musicPosts.ts and are appended to these. */
export const TRACKS: Track[] = [
  { id: 'neon-run',    title: 'Neon Run',      artist: 'Poplur Placeholder', bpm: 124, root: 0,  mood: 'HYPE',   duration: 30, source: { kind: 'synth' } },
  { id: 'slow-clay',   title: 'Slow Clay',     artist: 'Poplur Placeholder', bpm: 84,  root: 3,  mood: 'CHILL',  duration: 30, source: { kind: 'synth' } },
  { id: 'night-drive', title: 'Night Drive',   artist: 'Poplur Placeholder', bpm: 108, root: -2, mood: 'MOODY',  duration: 30, source: { kind: 'synth' } },
  { id: 'sunroom',     title: 'Sunroom',       artist: 'Poplur Placeholder', bpm: 96,  root: 5,  mood: 'WARM',   duration: 30, source: { kind: 'synth' } },
  { id: 'static-pop',  title: 'Static Pop',    artist: 'Poplur Placeholder', bpm: 140, root: -4, mood: 'PUNCHY', duration: 30, source: { kind: 'synth' } },
]

/**
 * An AudioBuffer for a track.
 *
 * A hosted file is fetched and decoded — that is the real path, and it is the
 * one uploads take. Stand-ins are built here from a bass pulse, a chord pad and
 * a hat on the track's own BPM: enough to hear the beat move against the video,
 * set a level and slide the offset, which is everything the editor's controls
 * need to be testable.
 *
 * SoundCloud tracks never reach here — their audio is not ours to decode, so
 * the handheld plays them through the embedded widget instead.
 */
export async function loadTrackBuffer(ctx: BaseAudioContext, track: Track): Promise<AudioBuffer> {
  const source = trackSource(track)

  if (source.kind === 'soundcloud') {
    // Loud, because silently handing back a synth loop would make an artist's
    // track sound like a placeholder and nobody would know why.
    throw new Error('soundcloud tracks play through the widget, not the audio graph')
  }

  if (source.kind === 'upload') {
    // Decoded PCM is big, so this is cached by URL rather than by track id —
    // the same file posted twice decodes once.
    const key = `audio-track:file-v1:${source.url}:${ctx.sampleRate}`
    const cached = poplurAssetCache.get<AudioBuffer>(key)
    if (cached) return cached
    const res = await fetch(source.url)
    if (!res.ok) throw new Error(`track ${track.id}: ${res.status}`)
    // Vite's dev fallback answers a missing public/ file with index.html at
    // 200, so status is not proof. decodeAudioData is: HTML will not decode.
    const decoded = await ctx.decodeAudioData(await res.arrayBuffer())
    poplurAssetCache.set(key, decoded, {
      kind: 'temporary',
      estimatedBytes: decoded.length * decoded.numberOfChannels * 4,
    })
    return decoded
  }

  const beat = 60 / track.bpm
  const loopDuration = Math.min(6, Math.max(2, beat * 8))
  const cacheKey = `audio-track:short-loop-v1:${track.id}:${ctx.sampleRate}:${loopDuration}`
  const hit = poplurAssetCache.get<AudioBuffer>(cacheKey)
  if (hit) return hit

  const rate = ctx.sampleRate
  const frames = Math.floor(loopDuration * rate)
  const buffer = ctx.createBuffer(2, frames, rate)
  // A4 = 440, shifted by the track's root, dropped two octaves for the bass.
  const rootHz = 440 * Math.pow(2, track.root / 12)
  const bassHz = rootHz / 4
  // major triad over the root, for the pad
  const padHz = [1, Math.pow(2, 4 / 12), Math.pow(2, 7 / 12)].map(r => (rootHz / 2) * r)

  for (let channel = 0; channel < 2; channel++) {
    const out = buffer.getChannelData(channel)
    // a touch of stereo so the pad is not a mono block in the middle
    const spread = channel === 0 ? 0.996 : 1.004
    for (let i = 0; i < frames; i++) {
      const t = i / rate
      const intoBeat = (t % beat) / beat

      // Bass: one note per beat, plucked envelope.
      const bassEnv = Math.exp(-intoBeat * 5.5)
      const bass = Math.sin(2 * Math.PI * bassHz * t) * bassEnv * 0.5

      // Pad: sustained triad, breathing across the bar.
      const bar = (t % (beat * 4)) / (beat * 4)
      const padEnv = 0.16 + 0.06 * Math.sin(2 * Math.PI * bar)
      let pad = 0
      for (const hz of padHz) pad += Math.sin(2 * Math.PI * hz * spread * t)
      pad = (pad / padHz.length) * padEnv

      // Hat: short noise burst on the off-beat, so the pulse is audible.
      const offBeat = ((t + beat / 2) % beat) / beat
      const hat = offBeat < 0.06 ? (Math.random() * 2 - 1) * Math.exp(-offBeat * 40) * 0.12 : 0

      // Fade the last half-second so a loop point does not click.
      const tail = t > loopDuration - 0.5 ? (loopDuration - t) / 0.5 : 1

      out[i] = (bass + pad + hat) * 0.62 * tail
    }
  }

  poplurAssetCache.set(cacheKey, buffer, {
    kind: 'temporary',
    estimatedBytes: buffer.length * buffer.numberOfChannels * 4,
  })
  return buffer
}
