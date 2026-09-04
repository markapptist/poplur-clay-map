import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeFeedDocuments } from '../nativeFeedPosts'

const doc = (id: string) => ({ id, data: () => ({}) })

describe('the shared post pool keeps the account\'s own posts', () => {
  it('folds own posts into the newest window without duplicates', () => {
    const merged = mergeFeedDocuments([doc('new-1'), doc('new-2')], [doc('new-2'), doc('old-mine')])
    expect(merged.map(d => d.id)).toEqual(['new-1', 'new-2', 'old-mine'])
  })

  it('subscribes to the account\'s own posts by uid alongside the newest window', () => {
    const src = readFileSync(new URL('../nativeFeedPosts.ts', import.meta.url), 'utf8')
    expect(src).toContain("where('userID', '==', uid)")
    expect(src).toContain('watchAccountForOwnPosts()')
  })
})
