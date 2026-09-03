import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A pop is a picture or a message — never neither. This pins the rule at the
// two places it is enforced on the web: the composer's publish button and the
// map's normaliser. Read as source rather than imported: both modules touch
// `window` at import time.
const composer = readFileSync(resolve(__dirname, '../PostComposer.tsx'), 'utf8')
const mapPosts = readFileSync(resolve(__dirname, '../mapLivePosts.ts'), 'utf8')
const popups = readFileSync(resolve(__dirname, '../popups.tsx'), 'utf8')

describe('a pop is never empty', () => {
  it('the composer will not publish without media or a message', () => {
    expect(composer).toContain("(!media && !caption.trim())")
    expect(composer).toContain("'Add a photo or write a message'")
  })

  it('the map drops a row that declares neither media nor a caption', () => {
    expect(mapPosts).toContain('if (!declaredMedia && !caption) return null')
  })

  it('the popup never claims a pop has no media', () => {
    expect(popups).not.toContain('No media on this pop yet')
  })
})
