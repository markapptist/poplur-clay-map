import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import manifest from '../side-control-icons/manifest.json'
import { sideIconAssetPath, type PoplurSideIconId, type PoplurSideIconSize } from '../sideControlIcons'

const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../FeedTwin.module.css', import.meta.url), 'utf8')

describe('feed video player transport', () => {
  it('has no scrub knob or timeline', () => {
    expect(feed).not.toContain('playerTimeline')
    expect(feed).not.toContain('seekToClientX')
    expect(feed).not.toContain('aria-label="Video position"')
    expect(css).not.toContain('.playerHandle')
    expect(css).not.toContain('.playerTimeline')
  })

  it('uses the clay rewind and forward artwork and the Map’s own play button', () => {
    expect(feed).toContain('icon="media.rewind"')
    expect(feed).toContain('icon="media.forward"')
    expect(feed).toContain('icon="map.tour_play"')
    expect(feed).toContain('icon="media.pause"')
    expect(feed).not.toContain('M11.5 5 4.5 12l7 7v-5.2l6 5.2V5l-6 5.2V5Z')
  })

  it('ships the new artwork at every pack size, with the 1024 master kept out of public/', () => {
    for (const id of ['media.rewind', 'media.forward'] as const) {
      expect(manifest.buttons.find(entry => entry.id === id), id).toBeDefined()
      for (const size of [256, 512, 1024] as const) {
        const path = sideIconAssetPath(id as PoplurSideIconId, size as PoplurSideIconSize)
        const file = fileURLToPath(new URL(path.startsWith('src/') ? `../../${path}` : `../../public/${path}`, import.meta.url))
        expect(existsSync(file), `${id} ${size}`).toBe(true)
      }
    }
  })
})

describe('feed videos never stay frozen', () => {
  it('treats silence while playing as a stall and runs the same bounded recovery', () => {
    expect(feed).toContain('const armSilence = ()')
    // Re-armed by every real advance, cleared by rest, escalates to recovery.
    const progress = feed.indexOf('markAdReady(adSrc)\n      armSilence()')
    expect(progress).toBeGreaterThan(-1)
    expect(feed).toContain("video.addEventListener('pause', onRest)")
    expect(feed).toContain("video.addEventListener('ended', onRest)")
    const silence = feed.indexOf('const armSilence = ()')
    const escalates = feed.indexOf('armRecovery()', silence)
    expect(escalates).toBeGreaterThan(silence)
  })
})
