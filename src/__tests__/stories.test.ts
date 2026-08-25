import { beforeEach, describe, expect, it } from 'vitest'
import {
  STORY_LIFETIME_MS,
  normalizeNativeStories,
  resetStoriesForTests,
  storyMentions,
  storySections,
  validateStoryPublish,
} from '../stories'

const NOW = 1_800_000_000_000

function story(overrides: Record<string, unknown> = {}) {
  return {
    id: 'story-one',
    ownerId: 'owner-one',
    username: '@maker',
    mediaURL: 'https://cdn.example/story.jpg',
    mediaType: 'photo',
    createdAtMillis: NOW - 60_000,
    expiresAtMillis: NOW - 60_000 + STORY_LIFETIME_MS,
    audience: 'public',
    isOwner: false,
    ...overrides,
  }
}

describe('Story lifecycle contract', () => {
  beforeEach(() => resetStoriesForTests())

  it('normalizes bounded public and Favorites stories without location fields', () => {
    const rows = normalizeNativeStories({ stories: [
      story({
        audience: 'favorites',
        caption: 'hi @Friend',
        mentions: ['Friend', 'friend', 'bad handle!'],
        storySticker: 'ignored',
        sticker: 'heart',
        music: { title: 'Track', artist: 'Artist' },
        poll: { question: 'Pick one', options: ['A', 'B'], counts: [2, 3] },
      }),
    ] }, NOW)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      audience: 'favorites',
      mentions: ['@friend'],
      sticker: 'heart',
      music: { title: 'Track', artist: 'Artist' },
      poll: { question: 'Pick one', options: ['A', 'B'], counts: [2, 3] },
    })
    expect(rows[0]).not.toHaveProperty('latitude')
    expect(rows[0]).not.toHaveProperty('longitude')
  })

  it('rejects unsafe media, impossible clocks, and overlong lifetimes', () => {
    expect(normalizeNativeStories({ stories: [
      story({ mediaURL: 'file:///secret.jpg' }),
      story({ id: 'backwards', expiresAtMillis: NOW - 120_000 }),
      story({ id: 'forever', expiresAtMillis: NOW + STORY_LIFETIME_MS * 2 }),
    ] }, NOW)).toEqual([])
  })

  it('keeps active stories in Today and expired owner rows in Archive', () => {
    const rows = normalizeNativeStories({ stories: [
      story({ id: 'today' }),
      story({
        id: 'expired-own',
        isOwner: true,
        highlighted: true,
        createdAtMillis: NOW - STORY_LIFETIME_MS - 60_000,
        expiresAtMillis: NOW - 60_000,
      }),
      story({
        id: 'expired-other',
        createdAtMillis: NOW - STORY_LIFETIME_MS - 60_000,
        expiresAtMillis: NOW - 60_000,
      }),
    ] }, NOW)
    const sections = storySections(rows, NOW)

    expect(sections.today.map(row => row.id)).toEqual(['today'])
    expect(sections.archive.map(row => row.id)).toEqual(['expired-own'])
    expect(sections.highlights.map(row => row.id)).toEqual(['expired-own'])
  })

  it('extracts unique mentions and validates Story polls', () => {
    expect(storyMentions('Hi @Alice and @alice — meet @bob.smith')).toEqual(['@alice', '@bob.smith'])
    expect(validateStoryPublish({
      audience: 'favorites', repliesAllowed: true, rightsAttested: true,
      pollQuestion: 'Choose', pollOptions: ['One', ''],
    })).toMatch(/two choices/i)
    expect(validateStoryPublish({
      audience: 'public', repliesAllowed: false, rightsAttested: true,
      pollQuestion: 'Choose', pollOptions: ['One', 'Two'],
    })).toBeNull()
  })
})
