import { describe, expect, it } from 'vitest'
import { avaturnEditorUrl, validateAvaturnExport } from '../../avaturnAvatarStore'

const validExport = {
  url: 'https://assets.avaturn.me/avatars/fitted.glb',
  urlType: 'httpURL' as const,
  avatarId: 'avatar-1',
  sessionId: 'session-1',
  avatarSupportsFaceAnimations: true,
  bodyId: 'body-1',
  gender: 'female' as const,
}

describe('free Avaturn wardrobe boundary', () => {
  it('uses the free demo when no project subdomain is configured', () => {
    expect(avaturnEditorUrl()).toBe('https://demo.avaturn.dev')
  })

  it('accepts a safe project subdomain and rejects host injection', () => {
    expect(avaturnEditorUrl('poplur')).toBe('https://poplur.avaturn.dev')
    expect(avaturnEditorUrl('poplur.evil.example')).toBe('https://demo.avaturn.dev')
  })

  it('accepts an HTTPS GLB export', () => {
    expect(validateAvaturnExport(validExport)).toEqual(validExport)
  })

  it('rejects insecure remote exports and arbitrary data URLs', () => {
    expect(validateAvaturnExport({ ...validExport, url: 'http://assets.example/avatar.glb' })).toBeNull()
    expect(validateAvaturnExport({ ...validExport, urlType: 'dataURL', url: 'data:text/html;base64,PGgxPmJhZDwvaDE+' })).toBeNull()
  })
})
