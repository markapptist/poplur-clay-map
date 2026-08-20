// ── Bouncing the studio arrangement down to one file ────────────────────────
//
// The studio plays its arrangement live: a recorded take on one <audio>, an AI
// instrumental on another, and — when there is no instrumental — a bed
// synthesised step by step against the AudioContext clock. Publishing has to
// turn all of that into a SINGLE piece of audio, because what lands on the
// shelf is one URL and the iPod decodes exactly those bytes.
//
// Rendered OFFLINE rather than recorded off the live output. A live capture
// would take a real thirty seconds, would pick up whatever else the phone was
// doing, and would be at the mercy of the transport actually keeping time
// under load. OfflineAudioContext renders as fast as the CPU allows and is
// sample-exact, so the file is the arrangement rather than a performance of it.
//
// Mutes and solos are honoured, because the mix you published should be the
// mix you were listening to. A muted lane is absent from the file, not quiet
// in it.

/** Where a bed voice should render. The live engine and the offline render
 *  both satisfy this, which is the point: one synth, two destinations. */
export interface RenderTarget {
  ctx: BaseAudioContext
  master: AudioNode
}

export interface MixdownRequest {
  /** the recorded vocal, as an object URL */
  takeUrl: string | null
  /** the AI instrumental, as an object URL */
  songUrl: string | null
  /** honours the desk: a muted lane does not reach the file */
  audible: (lane: string) => boolean
  /** longest the bounce may run, in seconds */
  maxSeconds: number
  /** Draw the synthesised bed into an arbitrary target. StudioScreen owns the
   *  pattern, so it passes the scheduler in rather than this module owning a
   *  second copy that could drift from what you hear. */
  scheduleBed?: (target: RenderTarget, endSeconds: number) => void
}

export interface Mixdown {
  blob: Blob
  /** what travels over the bridge — the native side uploads exactly these bytes */
  dataUri: string
  seconds: number
}

const SAMPLE_RATE = 44_100

async function decode(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await ctx.decodeAudioData(await res.arrayBuffer())
  } catch {
    // A take that will not decode must not take the whole bounce down with it:
    // the instrumental alone is still a publishable track.
    return null
  }
}

/**
 * Bounce the arrangement. Returns null when there is nothing audible to bounce
 * — a caller must not publish silence and call it a track.
 */
export async function mixdown(request: MixdownRequest): Promise<Mixdown | null> {
  const { takeUrl, songUrl, audible, maxSeconds, scheduleBed } = request

  // Decode first, in a throwaway context, because the render length depends on
  // how long the sources actually are.
  const probe = new AudioContext({ sampleRate: SAMPLE_RATE })
  let take: AudioBuffer | null = null
  let song: AudioBuffer | null = null
  try {
    take = takeUrl && audible('Lead Vocal') ? await decode(probe, takeUrl) : null
    song = songUrl ? await decode(probe, songUrl) : null
  } finally {
    void probe.close().catch(() => {})
  }

  const longest = Math.max(take?.duration ?? 0, song?.duration ?? 0)
  // With no recorded source at all the bed still has a length worth bouncing;
  // without a bed either, there is nothing to publish.
  if (longest <= 0 && !scheduleBed) return null
  const seconds = Math.min(maxSeconds, longest > 0 ? longest : maxSeconds)
  if (seconds <= 0) return null

  const offline = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE)
  const master = offline.createGain()
  // A touch of headroom: two full-scale sources summed will clip, and a
  // clipped publish is not recoverable once it is in the bucket.
  master.gain.value = 0.82
  master.connect(offline.destination)

  const place = (buffer: AudioBuffer | null) => {
    if (!buffer) return
    const source = offline.createBufferSource()
    source.buffer = buffer
    source.connect(master)
    source.start(0)
  }
  place(take)
  place(song)

  // The synthesised bed only exists when there is no instrumental — same rule
  // the live transport uses, so the bounce matches what was playing.
  if (!song && scheduleBed) scheduleBed({ ctx: offline, master }, seconds)

  const rendered = await offline.startRendering()
  const blob = encodeWav(rendered)
  return { blob, dataUri: await blobToDataUri(blob), seconds: rendered.duration }
}

/**
 * 16-bit PCM WAV.
 *
 * Deliberately uncompressed: the browser can ENCODE nothing but WAV without
 * pulling in a codec, and a 30s stereo bounce is ~5MB — comfortably inside the
 * bucket's 25MB rule. Transcoding to something smaller belongs on the server,
 * where it can be done once rather than on every artist's phone.
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels)
  const frames = buffer.length
  const bytes = 44 + frames * channels * 2
  const view = new DataView(new ArrayBuffer(bytes))

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)          // PCM chunk size
  view.setUint16(20, 1, true)           // format: PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true) // byte rate
  view.setUint16(32, channels * 2, true)                     // block align
  view.setUint16(34, 16, true)                               // bits per sample
  ascii(36, 'data')
  view.setUint32(40, frames * channels * 2, true)

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  let at = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      // Clamp before scaling: a sample over 1.0 wraps to full-negative
      // otherwise, which is heard as a click rather than as distortion.
      const sample = Math.max(-1, Math.min(1, data[c][i]))
      view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      at += 2
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The bounce could not be read back.'))
    reader.readAsDataURL(blob)
  })
}
