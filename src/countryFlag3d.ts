import flagIndex from './countryFlagIndex.json'
import { modelSprite } from './modelSprite'

/**
 * The supplied standard-country-flag GLB pack (public/country-flags-3d): 200
 * pole-free, double-sided unlit ripple flags, one per ISO 3166-1 alpha-2 code
 * (US_United_States.glb …), ~102 KB each. These are the REAL national flags,
 * deliberately not the Poplur-branded channel flag objects.
 *
 * The map's world-country signal already publishes an ISO-2 `code`, so a flag
 * is one lookup away. It is baked to a rippled sprite through the shared
 * modelSprite path (runtime-decoded and cached the first time a country is
 * seen, then a plain image URL) rather than standing a live GLB up per pan.
 */
const INDEX = flagIndex as Record<string, string>

/** Slightly-angled hero view so the ripple reads as a 3D flag, not a decal. */
export const COUNTRY_FLAG_SPRITE_VIEW = { yaw: -18, pitch: 8, size: 256 } as const

export function countryFlagGlbUrl(code: string | null | undefined): string | null {
  if (!code) return null
  const file = INDEX[code.trim().toUpperCase()]
  return file ? `country-flags-3d/${file}` : null
}

export function hasCountryFlag(code: string | null | undefined): boolean {
  return countryFlagGlbUrl(code) !== null
}

/** The rippled-flag sprite for a country, or null when the pack has no flag
 *  for that code (a disputed/unmapped region) — the caller then pops nothing
 *  rather than a broken image. */
export async function countryFlagSprite(code: string | null | undefined): Promise<string | null> {
  const url = countryFlagGlbUrl(code)
  if (!url) return null
  try {
    return await modelSprite(url, COUNTRY_FLAG_SPRITE_VIEW)
  } catch {
    return null
  }
}
