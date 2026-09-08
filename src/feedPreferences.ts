// Feed preferences that outlive a session. Kept beside mapTourPreferences so
// the hold menu and the feed read one contract rather than each keeping their
// own copy of the answer.

const COMMENTS_KEY = 'poplur.feedCommentsAtEnd'
const COMMENTS_DEFAULT_MIGRATION = 'poplur.feedCommentsAtEnd.default.v3'
const SOUND_MUTED_KEY = 'poplur.feed.muted'

/** Feed starts audible independently of the Map speaker setting. */
export function readFeedMuted(): boolean {
  try { return window.localStorage.getItem(SOUND_MUTED_KEY) === '1' } catch { return false }
}

export function writeFeedMuted(muted: boolean): void {
  try { window.localStorage.setItem(SOUND_MUTED_KEY, muted ? '1' : '0') } catch { /* session only */ }
}

function migrateCommentsDefault(): void {
  try {
    if (window.localStorage.getItem(COMMENTS_DEFAULT_MIGRATION) === '1') return
    // This release restores the default on every surface after earlier test
    // builds persisted the setting off. The separate marker makes this a
    // one-time correction: a viewer can turn comments off again afterwards
    // and that choice will remain respected on every subsequent launch.
    window.localStorage.setItem(COMMENTS_KEY, '1')
    window.localStorage.setItem(COMMENTS_DEFAULT_MIGRATION, '1')
  } catch { /* embedded/private mode: readFeedCommentsAtEnd still defaults on */ }
}

/**
 * Show a post's comments while it is visible and when its clip finishes.
 *
 * Defaults ON: the comments are part of watching a post, not a thing you have
 * to go looking for. The Feed's visible comments control turns it off for
 * people who would rather watch clean.
 */
export function readFeedCommentsAtEnd(): boolean {
  if (typeof window === 'undefined') return true
  migrateCommentsDefault()
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
