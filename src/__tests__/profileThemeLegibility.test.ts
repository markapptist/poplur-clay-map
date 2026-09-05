import { afterEach, describe, expect, it } from 'vitest'
import { PROFILE_THEMES, applyProfileThemeToDocument, profileThemeForID } from '../profileThemes'

// A theme's ink is authored FOR its background image, and that image is
// remote: the theme packs ship from Cloud Storage. Toy's ink is near-black and
// Icy Crystal's is dark slate, so applying the ink while the image is missing
// leaves authored ink on the app's own near-black ground and Profile opens as
// an unreadable black screen — the text present the whole time, drawn in a
// colour that had lost the background it was written for.

type Probe = { onload?: () => void; onerror?: () => void; src?: string }
const probes: Probe[] = []

function stubDocument() {
  const props = new Map<string, string>()
  const root = {
    style: { setProperty: (k: string, v: string) => { props.set(k, v) } },
    dataset: {} as Record<string, string>,
  }
  ;(globalThis as Record<string, unknown>).document = { documentElement: root }
  ;(globalThis as Record<string, unknown>).Image = class { constructor() { probes.push(this as Probe) } } as unknown
  return { props, root }
}

afterEach(() => {
  probes.length = 0
  delete (globalThis as Record<string, unknown>).document
  delete (globalThis as Record<string, unknown>).Image
})

const themed = PROFILE_THEMES.filter(theme => theme.backgroundSrc)

describe('a theme never paints its ink before its background', () => {
  for (const theme of themed) {
    it(`${theme.id} holds the default ink until the image decodes`, () => {
      const { props, root } = stubDocument()
      applyProfileThemeToDocument(theme)
      // Before the image lands: the safe default ground, and house ink.
      expect(props.get('--poplur-ink')).toBe('#140A04')
      expect(props.get('--poplur-ground')).not.toContain('url(')
      expect(root.dataset.poplurThemeActive).toBe('false')
      // The image decodes; now the authored theme may take over.
      expect(probes).toHaveLength(1)
      expect(probes[0].src).toBe(theme.backgroundSrc)
      probes[0].onload?.()
      expect(props.get('--poplur-ink')).toBe(theme.foreground)
      expect(props.get('--poplur-ground')).toContain(`url("${theme.backgroundSrc}")`)
      expect(root.dataset.poplurThemeActive).toBe('true')
    })

    it(`${theme.id} stays legible when the image never arrives`, () => {
      const { props } = stubDocument()
      applyProfileThemeToDocument(theme)
      probes[0].onerror?.()
      // Nothing to undo: the default was never replaced.
      expect(props.get('--poplur-ink')).toBe('#140A04')
      expect(props.get('--poplur-ground')).not.toContain('url(')
    })
  }

  it('the default theme applies immediately and loads nothing', () => {
    const { props } = stubDocument()
    applyProfileThemeToDocument(profileThemeForID('default'))
    expect(props.get('--poplur-ink')).toBe('#140A04')
    expect(probes).toHaveLength(0)
  })

  it('an image that finishes late cannot overwrite a newer choice', () => {
    const { props } = stubDocument()
    const first = themed[0]
    const second = themed[1]
    applyProfileThemeToDocument(first)
    applyProfileThemeToDocument(second)
    // The first background lands after the user has already moved on.
    probes[0].onload?.()
    expect(props.get('--poplur-ink')).not.toBe(first.foreground)
    probes[1].onload?.()
    expect(props.get('--poplur-ink')).toBe(second.foreground)
  })
})
