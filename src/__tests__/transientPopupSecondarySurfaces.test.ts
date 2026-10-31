import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')

describe('secondary transient popup surfaces', () => {
  it('shares News-style paint with directions cards', () => {
    const directions = source('ClayNav.tsx')

    expect(directions).toContain('`${styles.searchCard} ${surfaceStyles.surface}`')
    expect(directions).toContain('`${styles.previewCard} ${surfaceStyles.surface}`')
    expect(directions).toContain('`${styles.goBtn} ${surfaceStyles.primary}`')
    expect(directions).toContain('`${styles.ghostBtn} ${surfaceStyles.secondary}`')
  })

  it('shares the transient contract with trophy, AI, House and posted cards', () => {
    const trophy = source('TrophyRoomScreen.tsx')
    const ai = source('AIChatScreen.tsx')
    const house = source('HouseScreen.tsx')
    const upload = source('UploadStatusView.tsx')

    expect(trophy).toContain('`${styles.overlay} ${surfaceStyles.scrim}`')
    expect(trophy).toContain('`${styles.card} ${surfaceStyles.surface}`')
    expect(ai).toContain('`${styles.settingsPanel} ${surfaceStyles.surface}`')
    expect(house).toContain('`${styles.partyPanel} ${surfaceStyles.surface}`')
    expect(house).toContain('className={surfaceStyles.close}')
    expect(upload).toContain('`${styles.postedOverlay} ${surfaceStyles.scrim}`')
    expect(upload).toContain('`${styles.postedPopup} ${surfaceStyles.surface}`')
  })
})
