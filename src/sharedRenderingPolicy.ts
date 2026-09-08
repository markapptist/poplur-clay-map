/** Shared layouts are the trial default. The explicit comparison URL keeps
 * the previous renderer available without changing an account preference. */
export function usesShared2DUI(): boolean {
  return typeof window === 'undefined'
    || new URLSearchParams(window.location.search).get('uiRenderer') !== 'legacy'
}
