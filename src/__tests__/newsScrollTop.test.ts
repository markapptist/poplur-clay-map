import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('News scroll-to-top control', () => {
  it('keeps the existing scroll behavior and uses the supplied TOP artwork', () => {
    const source = readFileSync(new URL('../NewsPaper.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../NewsPaper.module.css', import.meta.url), 'utf8')
    const artwork = new URL('../../public/news-scroll-top.png', import.meta.url)

    expect(source).toContain("setShowTop(host.scrollTop > 600)")
    expect(source).toContain("scrollTo({ top: 0, behavior: 'smooth' })")
    expect(source).toContain('news-scroll-top.png')
    expect(source).toContain('aria-label="Back to the top of the paper"')
    expect(source).toContain("tabIndex={showTop ? 0 : -1}")
    expect(css).toContain('min-width: 44px')
    expect(css).toContain('min-height: 44px')
    expect(existsSync(artwork)).toBe(true)
  })
})
