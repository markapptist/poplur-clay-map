/** Pointer taps activate the camera roll on pointer-down for immediate iOS
 * feedback. Only synthetic keyboard/assistive clicks (detail 0) should use the
 * click fallback; mouse/touch clicks would otherwise open it twice. */
export function isKeyboardCameraRollClick(detail: number): boolean {
  return detail === 0
}
