import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { channelUrl, ensurePack, feedUrl, packBase, packUrl } from '../assetPacks'

const manifest = JSON.parse(readFileSync(resolve('public/asset-manifest.json'), 'utf8'))

describe('bundled core screens', () => {
  it('resolves interface artwork before the manifest network request completes', () => {
    expect(channelUrl('poplur_channel_103_beauty.png')).toBe('channels/poplur_channel_103_beauty.png')
    expect(feedUrl('photos/poplur-selfies.jpg')).toBe('feed/photos/poplur-selfies.jpg')
    expect(packBase('subscreens', '')).toBe('subscreens')
    expect(packBase('profile-themes', '')).toBe('profile-themes')
  })

  it('has every core pack file locally and never downloads those packs', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('storage unavailable'))
    try {
      for (const id of ['subscreens', 'profile-themes', 'feed', 'channels']) {
        const pack = manifest.packs.find((p: {id: string}) => p.id === id)
        expect(pack).toBeDefined()
        for (const file of pack.files) {
          expect(existsSync(resolve('public', packUrl(pack, file))), `${id}/${file}`).toBe(true)
        }
        expect(await ensurePack(pack)).toBe(true)
      }
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })
})
