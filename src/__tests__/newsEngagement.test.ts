import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  handleNewsEntryKey,
  newsEngagementDeliveryFailure,
  type NewsEntryKeyboardEvent,
} from '../newsEngagement'

describe('News engagement controls', () => {
  it.each([' ', 'Enter'])('leaves nested input %j untouched so the form can type or submit', key => {
    const preventDefault = vi.fn()
    const openStory = vi.fn()
    const input = { closest: vi.fn(() => ({ tagName: 'INPUT' })) } as unknown as EventTarget
    const event: NewsEntryKeyboardEvent = {
      key,
      target: input,
      currentTarget: {} as EventTarget,
      preventDefault,
    }

    expect(handleNewsEntryKey(event, openStory)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(openStory).not.toHaveBeenCalled()
  })

  it.each([' ', 'Enter'])('opens the article itself with %j and suppresses page movement', key => {
    const preventDefault = vi.fn()
    const openStory = vi.fn()
    const article = {} as EventTarget

    expect(handleNewsEntryKey({
      key,
      target: article,
      currentTarget: article,
      preventDefault,
    }, openStory)).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openStory).toHaveBeenCalledOnce()
  })

  it.each(['reply', 'repop'] as const)('returns an explicit %s delivery failure', action => {
    const result = newsEngagementDeliveryFailure(action, 'story-1')

    expect(result).toMatchObject({
      delivered: false,
      code: 'delivery-unavailable',
      action,
      entryId: 'story-1',
    })
    expect(result.title).toMatch(/not posted/i)
    expect(result.detail).toMatch(/nothing was posted/i)
  })

  it('does not retain a local-only storage or bridge success path', () => {
    const contract = readFileSync(new URL('../newsEngagement.ts', import.meta.url), 'utf8')

    expect(contract).not.toMatch(/localStorage|sessionStorage|postNativeEvent|fetch\s*\(/)
  })
})
