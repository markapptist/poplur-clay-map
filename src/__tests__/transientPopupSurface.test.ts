import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')

describe('shared transient popup surface', () => {
  it('keeps the canonical News paint in one explicit opt-in module', () => {
    const shared = source('TransientPopupSurface.module.css')

    expect(shared).toContain('.surface {')
    expect(shared).toContain('.scrim {')
    expect(shared).toContain('.primary,')
    expect(shared).toContain('.secondary {')
    expect(shared).toContain('rgba(255, 136, 195, .72)')
  })

  it('opts permission alerts into the shared surface, scrim and choice controls', () => {
    const permission = source('PermissionAlert.tsx')

    expect(permission).toContain("import surfaceStyles from './TransientPopupSurface.module.css'")
    expect(permission).toContain('`${styles.scrim} ${surfaceStyles.scrim}`')
    expect(permission).toContain('`${styles.alert} ${surfaceStyles.surface}`')
    expect(permission).toContain('choice.grants ? surfaceStyles.primary : surfaceStyles.secondary')
  })

  it('opts the incoming-call and coaching cards into the shared contract', () => {
    const incoming = source('IncomingCallPopup.tsx')
    const coach = source('ScreenCoach.tsx')

    expect(incoming).toContain('`${styles.scrim} ${surfaceStyles.scrim}`')
    expect(incoming).toContain('`${styles.card} ${surfaceStyles.surface}`')
    expect(incoming).toContain('`${styles.decline} ${surfaceStyles.secondary}`')
    expect(incoming).toContain('`${styles.accept} ${surfaceStyles.primary}`')
    expect(coach).toContain('`${styles.card} ${surfaceStyles.surface}`')
  })

  it('keeps compact engagement, active-call and volume geometry on News paint', () => {
    const popupHost = source('popups.tsx')
    const callBar = source('InCallBar.tsx')
    const volume = source('VolumeBars.tsx')

    expect(popupHost).toContain("import surfaceStyles from './TransientPopupSurface.module.css'")
    expect(popupHost).toContain('`${styles.engage} ${surfaceStyles.surface}`')
    expect(popupHost).toContain('<CommerceSuggestionWindow')
    expect(callBar).toContain('`${styles.bar} ${surfaceStyles.surface}`')
    expect(volume).toContain('`${awake ? styles.railAwake : styles.rail} ${surfaceStyles.surface}`')
  })
})
