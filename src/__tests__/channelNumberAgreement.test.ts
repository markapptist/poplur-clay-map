import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * One post, one channel number — whichever surface you open it from.
 *
 * The feed owns the canonical CHANNELS list, but profileRealtimePosts is
 * DOM-free and cannot import a React component to reach it, so it keeps its
 * own copy of the numbering. The copies drifted: `live` was 117 here and 116
 * there, so the same post read CH 117 on the profile and CH 116 on the feed.
 * Comparing the source of both tables is the only way to catch that without
 * pulling the DOM into this suite.
 */
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

function canonicalChannels(): Map<string, number> {
  const list = read('FeedTwin.tsx')
  const start = list.indexOf('export const CHANNELS')
  expect(start).toBeGreaterThan(-1)
  const body = list.slice(start, list.indexOf('\n]', start))
  const found = new Map<string, number>()
  for (const m of body.matchAll(/\{\s*id:\s*'([a-z]+)',\s*number:\s*(\d+)/g)) {
    found.set(m[1], Number(m[2]))
  }
  return found
}

function profileChannels(): Map<string, number> {
  const src = read('profileRealtimePosts.ts')
  const block = src.match(/const CHANNEL_NUMBER: Record<string, number> = \{([\s\S]*?)\}/)?.[1] ?? ''
  const found = new Map<string, number>()
  for (const m of block.matchAll(/([a-z]+):\s*(\d+)/g)) found.set(m[1], Number(m[2]))
  return found
}

describe('channel numbering agrees across surfaces', () => {
  const canonical = canonicalChannels()
  const profile = profileChannels()

  it('both tables were actually parsed', () => {
    expect(canonical.size).toBeGreaterThan(10)
    expect(profile.size).toBeGreaterThan(10)
  })

  it('live is 116 on both — the drift that shipped', () => {
    expect(canonical.get('live')).toBe(116)
    expect(profile.get('live')).toBe(116)
  })

  it('every channel the profile knows carries the feed’s number', () => {
    const disagreements = [...profile.entries()]
      .filter(([id, n]) => canonical.has(id) && canonical.get(id) !== n)
      .map(([id, n]) => `${id}: profile ${n} vs feed ${canonical.get(id)}`)
    expect(disagreements).toEqual([])
  })
})
