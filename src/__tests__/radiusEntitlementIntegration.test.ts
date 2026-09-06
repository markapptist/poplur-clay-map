import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('account claim-radius integration', () => {
  it('skins Search with the same molded Pop Drop shell', () => {
    const map = source('MapApp.tsx')
    const css = source('App.module.css')

    expect(map).toContain("import dropStyles from './ClayMap.module.css'")
    expect(map).toContain('dropStyles.composeBubble')
    expect(map).toContain('dropStyles.composeHeader')
    expect(map).toContain('dropStyles.composeBody')
    expect(map).not.toMatch(/surfaceStyles\.surface[\s\S]*?searchPanel/)
    expect(css).toContain('Search borrows Pop Drop\'s molded shell')
    expect(css).toMatch(/\.searchShortcut,[\s\S]*?border:\s*2px solid #ef5ba8/)
  })

  it('floors at the discovery seed and clamps again at every active publishing boundary', () => {
    const clayMap = source('ClayMap.tsx')
    const home = source('HomeTwin.tsx')
    const composer = source('PostComposer.tsx')
    const review = source('UploadFlowReview.tsx')

    // The rail is never disabled now: an account that has earned nothing is
    // still entitled to the seed, so there is no zero state to lock out.
    expect(clayMap).toContain('min={CLAIM_RADIUS_SEED_KM}')
    expect(clayMap).not.toContain('disabled={claimRadiusMaxKm === 0}')
    expect(clayMap).toContain('const radiusKmAtDrop = clampClaimRadiusKm')
    expect(home).not.toContain('Number(event.data.radiusKm) || undefined')
    expect(home).toContain('authoritativeAccountRadiusKmRef.current')
    expect(composer).toContain('const publishedRadiusKm = clampClaimRadiusKm')
    expect(composer).toContain('radiusKm: publishedRadiusKm,')
    expect(review).toContain('const claimRadiusMaxKm = useClaimRadiusLimitKm()')
    expect(review).toContain('const RADIUS_MIN = CLAIM_RADIUS_SEED_KM')
    expect(review).not.toContain('aria-disabled={maxRadiusKm === 0}')
    expect(composer).not.toContain('this post stays at 0 km')
  })

  it('uses the all-post Firestore total for the HUD and legacy reach readers', () => {
    const map = source('MapApp.tsx')
    const ledger = source('radiusLedger.ts')
    const camera = source('Camera.tsx')

    expect(map).toContain('subscribeAccountRadiusPosts(')
    expect(map).toContain('accountRadiusKm={accountRadiusKm}')
    expect(ledger).toContain('return readAccountRadiusKm()')
    expect(ledger).not.toContain('BASE_RADIUS_KM')
    expect(camera).toContain('radiusKm: viewer.radiusKm,')
    expect(camera).not.toContain('viewer.radiusKm > 0 ? viewer.radiusKm')
  })
})
