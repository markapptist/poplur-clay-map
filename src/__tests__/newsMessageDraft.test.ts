// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messageCardLines, newsMessageDraft } from '../newsMessageDraft'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

afterEach(() => vi.restoreAllMocks())
describe('News message publishing draft', () => {
  it('requires words and preserves hashtags with an optional real attachment', () => {
    const media = { kind: 'video' as const, src: 'data:video/mp4;base64,clip' }
    expect(() => newsMessageDraft('   ', media, 'food')).toThrow('Write a message')
    const draft = newsMessageDraft('  Hello #Toronto\nFrom here  ', media, 'food')
    expect(draft.caption).toBe('Hello #Toronto\nFrom here')
    expect(draft.media).toBe(media)
    expect(draft.messageCard).toBe(false)
    expect(draft.rightsAttested).toBe(false)
  })
  it('creates a media preview for a text-only post without publishing anything', () => {
    const fillText = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({fillText, fillRect: vi.fn()} as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,message')
    const draft = newsMessageDraft('Hello #world', null, 'food')
    expect(draft.media).toEqual({kind: 'photo', src: 'data:image/jpeg;base64,message'})
    expect(draft.messageCard).toBe(true)
    expect(fillText).toHaveBeenCalledWith('Hello #world', expect.any(Number), expect.any(Number), 936)
  })
  it('wraps long words and respects deliberate paragraph breaks', () => {
    const lines = messageCardLines('one two\nabcdefghijk', 5)
    expect(lines).toEqual(['one ', 'two', 'abcde', 'fghij', 'k'])
    expect(lines.every(line => Array.from(line.trimEnd()).length <= 5)).toBe(true)
  })
  it('routes News cube taps into composing after nested story navigation', () => {
    const home = readFileSync(resolve(__dirname, '../HomeTwin.tsx'), 'utf8')
    const tap = home.slice(home.indexOf('  const popCube ='))
    expect(tap.indexOf("cubeScreen === 'feed-news'")).toBeGreaterThan(tap.indexOf('goBackRef.current?.()'))
    expect(home).toContain('<NewsMessageComposer')
    const composer = readFileSync(resolve(__dirname, '../NewsMessageComposer.tsx'), 'utf8')
    expect(composer).toContain('setPendingMapPost(newsMessageDraft(body, attachment, channelId))')
    expect(composer).toContain("new CustomEvent('poplur-pick-spot')")
    expect(composer).not.toContain('dropNewsMessage(')
  })
})
