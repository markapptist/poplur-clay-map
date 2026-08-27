import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HOLD_MENU_ICON_ASSETS } from '../holdMenuIconAssignments'

describe('hold-menu destination icons', () => {
  it('uses the dedicated @, house, and shopping-bag renders', () => {
    expect(HOLD_MENU_ICON_ASSETS).toEqual({
      browser: 'Browser',
      house: 'House',
      store: 'ShoppingBag',
    })

    for (const icon of Object.values(HOLD_MENU_ICON_ASSETS)) {
      const asset = fileURLToPath(new URL(`../../public/holdmenu/${icon}.png`, import.meta.url))
      expect(existsSync(asset), `${icon}.png should ship with the hold menu`).toBe(true)
    }
  })
})
