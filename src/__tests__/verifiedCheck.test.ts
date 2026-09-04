import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VERIFIED_CHECK_SRC, verifiedCheckKind } from '../verifiedCheck'

describe('verification marks', () => {
  it('gives businesses and organisations the black check, everyone else the pink one', () => {
    expect(verifiedCheckKind('business')).toBe('business')
    expect(verifiedCheckKind('organisation')).toBe('business')
    expect(verifiedCheckKind('creator')).toBe('personal')
    expect(verifiedCheckKind('publicFigure')).toBe('personal')
    expect(verifiedCheckKind(null)).toBe('personal')
    expect(verifiedCheckKind(undefined)).toBe('personal')
  })

  it('draws the supplied marks, not a hand-drawn seal', () => {
    expect(VERIFIED_CHECK_SRC.business).toBe('verified-business.png')
    expect(VERIFIED_CHECK_SRC.personal).toBe('verified-personal.png')
    const profile = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
    expect(profile).toContain('VERIFIED_CHECK_SRC[verifiedKind]')
    expect(profile).not.toContain("fill={verificationTier === 'verified' ? '#f4459c'")
    const settings = readFileSync(new URL('../SettingsScreen.tsx', import.meta.url), 'utf8')
    expect(settings).not.toContain('blue badge')
  })
})
