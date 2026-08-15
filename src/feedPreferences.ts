// Feed preferences that outlive a session. Kept beside mapTourPreferences so
// the hold menu and the feed read one contract rather than each keeping their
// own copy of the answer.

import { isNativeShell } from './nativeBridge'

const COMMENTS_KEY = 'poplur.feedCommentsAtEnd'
const NATIVE_COMMENTS_DEFAULT_MIGRATION = 'poplur.feedCommentsAtEnd.nativeDefault.v2'

function migrateNativeCommentsDefault(): void {
  if (!isNativeShell()) return
  try {
    if (window.localStorage.getItem(NATIVE_COMMENTS_DEFAULT_MIGRATION) === '1') return
    // This release restores the documented native default after earlier test
    // builds persisted the setting off. The separate marker makes this a
    // one-time correction: a viewer can turn comments off again afterwards
    // and that choice will remain respected on every subsequent launch.
    window.localStorage.setItem(COMMENTS_KEY, '1')
    window.localStorage.setItem(NATIVE_COMMENTS_DEFAULT_MIGRATION, '1')
  } catch { /* embedded/private mode: readFeedCommentsAtEnd still defaults on */ }
}

/**
 * Show a post's comments when its clip finishes.
 *
 * Defaults ON: the comments are part of watching a post, not a thing you have
 * to go looking for. The Feed's visible comments control turns it off for
 * people who would rather watch clean.
 */
export function readFeedCommentsAtEnd(): boolean {
  if (typeof window === 'undefined') return true
  migrateNativeCommentsDefault()
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
