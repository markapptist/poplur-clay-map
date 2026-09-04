import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The roster is a SECOND LANE, not a filter on your conversations.
 *
 * MailScreen carries a standing rule: discovery is radius-based, but an
 * established DM is participant history and must never be filtered by current
 * reach or either person's location. So people in reach are offered BELOW the
 * thread list, and a thread is never hidden because somebody moved away.
 */
const mail = readFileSync(new URL('../MailScreen.tsx', import.meta.url), 'utf8')

describe('the radius roster', () => {
  it('leaves the thread derivation untouched', () => {
    // The moment this list is filtered by reach, a conversation vanishes
    // because the other person walked out of range.
    expect(mail).toContain('const threads = persistentDMThreads(liveThreads ?? THREADS, deletedIds)')
  })

  it('reads the shared selector rather than carrying its own reach rule', () => {
    expect(mail).toContain("import { visiblePeopleFromRealtimePosts } from './visiblePeople'")
    expect(mail).toContain("import { currentViewerCoords } from './viewerFix'")
    // A second reach implementation here is how the map and feed drifted.
    expect(mail).not.toContain('feedPostReachesViewer(')
  })

  it('never lists somebody who already has a thread', () => {
    expect(mail).toContain('const known = new Set(threads.map(thread => thread.otherId).filter(Boolean))')
    expect(mail).toContain('.filter(person => !known.has(person.ownerId))')
  })

  it('opens a conversation through the one shared route', () => {
    // Extracted from the initialComposeTo effect rather than duplicated, so a
    // roster row cannot drift from the path a tapped pop already uses.
    expect(mail).toContain('const openComposeWith = useCallback((peerId: string, peerName: string | null)')
    expect(mail).toContain('openComposeWith(compose.peerId, compose.peerName)')
    expect(mail).toContain('onClick={() => openComposeWith(person.ownerId, person.handle)}')
  })

  it('does not promise a radius list when there is nobody in it', () => {
    // The old copy said "Start with someone in your radius" unconditionally —
    // with no location fix that sends the reader looking for a list that is
    // not there.
    expect(mail).toContain("inYourRadius.length ? 'Nobody yet' : 'All clear'")
  })

  it('says why each person is listed, never a thread preview', () => {
    // "No messages yet" is the thread list's own preview line; reusing it
    // would make a suggestion read as a conversation you have not opened.
    const roster = mail.slice(mail.indexOf('radiusRow'))
    expect(roster).toContain('km away')
    expect(roster).toContain('Reaching everywhere')
  })

  it('hides the roster while searching', () => {
    // A search is a search of your conversations.
    expect(mail).toContain('{!normalizedSearch && inYourRadius.length > 0 && (')
  })
})
