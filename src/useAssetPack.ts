/**
 * Wait for an optional asset pack before rendering a screen that needs it.
 *
 * The contract the rest of the app relies on: a screen never draws against
 * files that are not there. It shows that it is fetching, or says plainly that
 * it could not — it does not render a half-populated version and let the gaps
 * look like bugs.
 *
 * Packs already on the device resolve on the first render with no flash of a
 * loading state, because the cache is checked before any network call.
 */

import { useEffect, useState } from 'react'
import { MANIFEST_URL, ensurePack, loadManifest, packUrl, type AssetPack } from './assetPacks'

export type PackStatus = 'checking' | 'fetching' | 'ready' | 'unavailable'

export interface PackHandle {
  status: PackStatus
  /** Resolve a file inside the pack. Empty string until the pack is ready. */
  url: (file: string) => string
}

export function useAssetPack(packId: string): PackHandle {
  const [status, setStatus] = useState<PackStatus>('checking')
  const [pack, setPack] = useState<AssetPack | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const manifest = await loadManifest(`${import.meta.env.BASE_URL}${MANIFEST_URL}`)
        const found = manifest.packs.find(p => p.id === packId)
        if (!found) { if (!cancelled) setStatus('unavailable'); return }
        if (!cancelled) { setPack(found); setStatus('fetching') }
        const ok = await ensurePack(found)
        if (!cancelled) setStatus(ok ? 'ready' : 'unavailable')
      } catch {
        // A missing or unreachable manifest is a normal offline state, not a
        // crash: the screen says so and the app keeps working.
        if (!cancelled) setStatus('unavailable')
      }
    })()
    return () => { cancelled = true }
  }, [packId])

  return {
    status,
    url: (file: string) => (pack && status === 'ready' ? packUrl(pack, file) : ''),
  }
}
