import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { NOTIF_ICON_ID, notifIconKind, notifIconSources, type NotifKind } from '../FlatNotifIcon'
import { SIDE_CONTROL_ICONS, sideIconAssetPath } from '../sideControlIcons'

// A notification row must never be blank. It was, for one build: the rows
// pointed at a `public/notif-icons/` folder nobody had supplied, so every row
// on the phone showed text with an empty square where its mark belongs. This
// pins the rows to icons the supplied art pack actually ships, at both sizes.

const KINDS: NotifKind[] = ['like', 'view', 'comment', 'message', 'growth', 'decrease', 'pop', 'trend']

describe('notification row icons', () => {
  it('gives every kind an icon from the supplied pack', () => {
    for (const kind of KINDS) {
      const id = NOTIF_ICON_ID[kind]
      expect(SIDE_CONTROL_ICONS[id], `${kind} → ${id} is not in the icon manifest`).toBeTruthy()
    }
  })

  it('ships the file each kind points at, at 256 and 512', () => {
    for (const kind of KINDS) {
      for (const size of [256, 512] as const) {
        const path = new URL(`../../public/${sideIconAssetPath(NOTIF_ICON_ID[kind], size)}`, import.meta.url)
        expect(existsSync(path), `${kind} ${size}px missing: ${path.pathname}`).toBe(true)
      }
    }
  })

  it('offers both sizes to the browser so a row icon is never upscaled', () => {
    const sources = notifIconSources('like')
    expect(sources.src).toContain('512')
    expect(sources.srcSet).toContain('256w')
    expect(sources.srcSet).toContain('512w')
  })

  it('maps every native and web kind name onto one of those icons', () => {
    const wire = ['like', 'view', 'comment', 'dm', 'message', 'mention',
      'radiusGrowth', 'growth', 'radiusDip', 'decrease',
      'areaTakeover', 'radiusEntry', 'pop', 'dailyInsight', 'trend', 'something-new']
    for (const name of wire) {
      expect(KINDS, `${name} resolved outside the icon map`).toContain(notifIconKind(name))
    }
    expect(notifIconKind('dm')).toBe('message')
    expect(notifIconKind('radiusDip')).toBe('decrease')
    expect(notifIconKind('areaTakeover')).toBe('pop')
  })
})
