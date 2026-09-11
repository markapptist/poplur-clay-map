import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// OWNER DECISION 11 Sep 2026: "when I press a pin it shows the post media
// directly in feed, taking you to the channel directly." The map hands the pop
// to the shell with the same message the card's VIEW IN FEED always used;
// HomeTwin tunes the channel and focuses the post. The card survives for the
// two cases where a direct hop is wrong: automatic arrow landings (a survey,
// not a choice) and pops without media (the feed drops a media-less row).
const src = readFileSync(join(__dirname, '..', 'MapApp.tsx'), 'utf8')

describe('pressing a pin opens the post in the Feed', () => {
  it('goes straight to the feed on a press when the pop has media', () => {
    expect(src).toContain('const directToFeed = !automatic && Boolean(pin.media)')
    expect(src).toMatch(/if \(directToFeed\) openPinInFeed\(pin\)\s*\n\s*else showPinContentCard\(pin\)/)
  })

  it('uses one handoff for the press and for the card\'s VIEW IN FEED', () => {
    expect(src.match(/type: 'poplur-map-open-feed-content'/g)?.length).toBe(1)
    expect(src).toContain("onActivate: pin.media ? () => { openPinInFeed(pin) } : undefined")
  })

  it('does not paint a spotlight nothing will clear', () => {
    expect(src).toContain('if (live && !directToFeed) {')
  })

  it('still lands the shell on the channel and the post', () => {
    const shell = readFileSync(join(__dirname, '..', 'HomeTwin.tsx'), 'utf8')
    const i = shell.indexOf("event.data.type === 'poplur-map-open-feed-content'")
    const block = shell.slice(i, i + 1400)
    expect(block).toContain('setChanIndex(channelIndex)')
    expect(block).toContain('setFeedFocusedContent(')
    expect(block).toContain("setActiveTab('feed')")
  })
})
