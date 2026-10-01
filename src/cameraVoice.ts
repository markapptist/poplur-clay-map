// What SCAN says out loud ("I see a mug.") when the page has to say it.
//
// iOS speaks from its native CameraAIAnnouncer (Poplur2025/CameraAIAnnouncer.swift)
// and the page stays quiet there, or every line would come twice. Android's
// shell has no announcer, so on Android the page speaks — by the same rules, so
// the two phones narrate a room alike: the strongest whole-frame label of at
// least 0.18, underscores and hyphens read as spaces, nothing sooner than 2.2 s
// after the last line, and never the same thing twice running.

export const CAMERA_VOICE_COOLDOWN_MS = 2_200
export const CAMERA_VOICE_MIN_CONFIDENCE = 0.18

export interface CameraVoiceState {
  signature: string | null
  at: number
}

/** A new narration session: SCAN turned on, or the lens came back. */
export const freshCameraVoice = (): CameraVoiceState => ({ signature: null, at: Number.NEGATIVE_INFINITY })

const clean = (label: string) => label.replace(/[_-]/g, ' ').trim()

/** The line to speak for one frame's detections, or null. Records it in `state`. */
export function nextCameraLine(
  detections: ReadonlyArray<{ label: string; confidence: number; whole?: boolean }>,
  state: CameraVoiceState,
  now: number,
): string | null {
  const label = detections
    .filter(detection => detection.whole && detection.confidence >= CAMERA_VOICE_MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
    .map(detection => clean(detection.label))
    .find(text => text.length > 0)
  if (!label) return null
  if (now - state.at <= CAMERA_VOICE_COOLDOWN_MS) return null
  const signature = label.toLowerCase()
  if (signature === state.signature) return null
  state.signature = signature
  state.at = now
  return `I see ${label}.`
}
