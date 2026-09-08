import { describe, expect, it } from 'vitest'
import { nextBroadcastPost } from '../feedBroadcast'

const posts = [
  { id: 'food-big', channelId: 'food', reachKm: 100 },
  { id: 'food-small', channelId: 'food', reachKm: 4 },
  { id: 'music', channelId: 'music', reachKm: 50 },
  { id: 'sports', channelId: 'sports', reachKm: 10 },
]
describe('continuous radius-ordered broadcast', () => {
  it('visits every active channel, then continues its next post across repeated passes', () => {
    const channels = new Set<string>(), seen = new Set<string>()
    let current: typeof posts[number] | undefined
    const visited: string[] = []
    for (let i = 0; i < 9; i++) {
      current = nextBroadcastPost(posts, channels, seen, current)
      visited.push(current!.id)
    }
    expect(visited).toEqual(['food-big','music','sports','food-small','music','sports','food-big','music','sports'])
  })
  it('replays the only post and keeps a single-channel queue moving', () => {
    const seen = new Set<string>(), channels = new Set<string>()
    expect(nextBroadcastPost([posts[0]], channels, seen, posts[0])?.id).toBe('food-big')
    expect(nextBroadcastPost(posts.slice(0, 2), channels, seen, posts[0])?.id).toBe('food-small')
    expect(nextBroadcastPost([], channels, seen)).toBeUndefined()
    expect(seen.size).toBe(0)
  })
  it('drops expired channels and gives new active channels a turn without growing history forever', () => {
    const channels = new Set(['gone']), seen = new Set(['deleted'])
    const next = nextBroadcastPost(posts, channels, seen, posts[0])
    expect(next?.id).toBe('music')
    expect(channels.has('gone')).toBe(false)
    expect(seen.has('deleted')).toBe(false)
  })
})
