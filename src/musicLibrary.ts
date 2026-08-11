// ── The music bed for the video editor ──────────────────────────────────────
//
// PLACEHOLDER LIBRARY, AND DELIBERATELY SO.
//
// Poplur has no music licences yet. The editor still needs a real track model
// to be built against — offsets, volume, looping, mixing into the exported file
// — so the mechanism is finished and only the SOURCE is standing in.
//
// The stand-ins are SYNTHESISED here, not bundled audio files. That is the
// point: there is no third-party recording anywhere in the repo, so nothing has
// to be scrubbed later and no build can accidentally ship someone's master. A
// generated loop is unmistakably not a real song, which is exactly what you
// want a placeholder to sound like.
//
// SWAPPING IN THE REAL THING, when licences exist:
//   1. give each Track a `url` and drop the licensed file in public/music/
//   2. make loadTrackBuffer() fetch+decode that url instead of synthesising
//   3. carry the licence id / rights-holder on the Track and send it with the
//      post, because the upload will need to declare what it used
// Nothing else in the editor has to change — it only ever asks for an
// AudioBuffer.

import { poplurAssetCache } from './PoplurAssetCache'

export interface Track {
  id: string
  title: string
  /** shown under the title; for real tracks this becomes the rights holder */
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
}

export const TRACKS: Track[] = [
  { id: 'neon-run',    title: 'Neon Run',      artist: 'Poplur Placeholder', bpm: 124, root: 0,  mood: 'HYPE',   duration: 30 },
  { id: 'slow-clay',   title: 'Slow Clay',     artist: 'Poplur Placeholder', bpm: 84,  root: 3,  mood: 'CHILL',  duration: 30 },
  { id: 'night-drive', title: 'Night Drive',   artist: 'Poplur Placeholder', bpm: 108, root: -2, mood: 'MOODY',  duration: 30 },
  { id: 'sunroom',     title: 'Sunroom',       artist: 'Poplur Placeholder', bpm: 96,  root: 5,  mood: 'WARM',   duration: 30 },
  { id: 'static-pop',  title: 'Static Pop',    artist: 'Poplur Placeholder', bpm: 140, root: -4, mood: 'PUNCHY', duration: 30 },
]

/**
 * An AudioBuffer for a track. Real tracks will fetch and decode; stand-ins are
 * built here from a bass pulse, a chord pad and a hat on the track's own BPM —
 * enough to hear the beat move against the video, set a level, and slide the
 * offset, which is everything the editor's controls need to be testable.
 */
export async function loadTrackBuffer(ctx: BaseAudioContext, track: Track): Promise<AudioBuffer> {
  // The editor loops these buffers, so synthesising all 30 display seconds is
  // unnecessary work. Two bars preserve the beat, harmony and stereo movement
  // while placing a small, deterministic ceiling on main-thread synthesis and
  // cached PCM (roughly 3.4–5.7s for the placeholder library).
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
