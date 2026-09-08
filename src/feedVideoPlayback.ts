/** A load/source swap rejects pending play promises with AbortError. That is
 * an interrupted request, not evidence that the clip's decoder is broken. */
export async function playFeedVideo(
  video: HTMLVideoElement,
  stillCurrent: () => boolean,
): Promise<'playing' | 'interrupted' | 'failed'> {
  try {
    await video.play()
    return 'playing'
  } catch (error) {
    if (!stillCurrent() || (error as { name?: string })?.name === 'AbortError') return 'interrupted'
    // System audio interruptions can revoke audible autoplay while muted
    // playback remains permitted. Recover the picture without stealing audio.
    if ((error as { name?: string })?.name === 'NotAllowedError' && !video.muted) {
      video.muted = true
      return playFeedVideo(video, stillCurrent)
    }
    return 'failed'
  }
}
