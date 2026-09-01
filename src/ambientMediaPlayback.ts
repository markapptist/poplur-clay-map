export type AmbientMediaPlaybackTarget = {
  play: () => Promise<unknown> | void
  pause: () => void
}

/**
 * Keeps decorative media aligned with the app's ambient-work lease. Playback
 * failures are intentionally non-fatal: native-backed URLs can become
 * available only after their shell has restored the foreground session.
 */
export function syncAmbientMediaPlayback(
  media: AmbientMediaPlaybackTarget,
  shouldPlay: boolean,
): void {
  if (!shouldPlay) {
    media.pause()
    return
  }

  try {
    const playback = media.play()
    if (playback && typeof playback.catch === 'function') {
      void playback.catch(() => undefined)
    }
  } catch {
    // A later visibility/ambient wake will retry.
  }
}
