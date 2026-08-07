// Feed preferences that outlive a session. Kept beside mapTourPreferences so
// the hold menu and the feed read one contract rather than each keeping their
// own copy of the answer.

const COMMENTS_KEY = 'poplur.feedCommentsAtEnd'

/**
 * Show a post's comments when its clip finishes.
 *
 * Defaults ON: the comments are part of watching a post, not a thing you have
 * to go looking for. The hold menu's COMMENTS tile turns it off for people who
 * would rather watch clean.
 */
export function readFeedCommentsAtEnd(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(COMMENTS_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeFeedCommentsAtEnd(on: boolean): boolean {
  try {
    window.localStorage.setItem(COMMENTS_KEY, on ? '1' : '0')
  } catch { /* embedded/private mode: the session value still applies */ }
  return on
}
