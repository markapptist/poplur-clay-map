import { describe, expect, it } from 'vitest'
import { presentableHandle, timelineRows, timelineStats } from '../messageTimelineRows'
import { requestMessageTimeline, takeMessageTimelineRequest } from '../messageTimelineRequest'
import { PROFILE_TABS } from '../profileMode'

const post = (id: string, contentType: 'post' | 'message', createdAtMillis: number, reachKm?: number) =>
  ({ id, contentType, createdAtMillis, reachKm, ch: 'live', title: id, video: '' })

describe('the Pop Message timeline', () => {
  it('shows messages only, newest first, attachments included', () => {
    const rows = timelineRows([
      post('old-message', 'message', 100),
      post('a-photo', 'post', 300),
      post('new-message', 'message', 200),
      post('undated', 'message', 0),
    ])
    expect(rows.map(r => r.id)).toEqual(['new-message', 'old-message', 'undated'])
  })

  it('does not mutate the pool it reads from', () => {
    const pool = [post('b', 'message', 1), post('a', 'message', 2)]
    timelineRows(pool)
    expect(pool.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('sums the reach it can see and counts every row', () => {
    expect(timelineStats([{ reachKm: 1.5 }, { reachKm: 2 }, {}])).toEqual({ count: 3, reachKm: 3.5 })
    expect(timelineStats([])).toEqual({ count: 0, reachKm: 0 })
  })

  it('normalises a handle for display', () => {
    expect(presentableHandle('@@mark ')).toBe('@mark')
    expect(presentableHandle('mark')).toBe('@mark')
    expect(presentableHandle('')).toBe('')
    expect(presentableHandle(null)).toBe('')
  })
})

describe('whose timeline to open', () => {
  it('is taken once and then gone, so a stale handle never becomes "your messages"', () => {
    requestMessageTimeline('@harbourfront')
    expect(takeMessageTimelineRequest()).toEqual({ handle: '@harbourfront' })
    expect(takeMessageTimelineRequest()).toBeNull()
  })

  it('reads an empty or missing handle as your own', () => {
    requestMessageTimeline('   ')
    expect(takeMessageTimelineRequest()).toEqual({ handle: null })
    requestMessageTimeline(undefined)
    expect(takeMessageTimelineRequest()).toEqual({ handle: null })
  })
})

describe('the profile page', () => {
  it('no longer offers a Messages tab — the timeline is where messages live', () => {
    expect(PROFILE_TABS).toEqual(['media'])
    expect(PROFILE_TABS).not.toContain('messages')
  })
})
