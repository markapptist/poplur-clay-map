import type { FashionStyle } from './characterFashion'

export const POPLUR_WARDROBE_RIG = 'poplur-humanoid-65-v1'
export const MAX_WARDROBE_GLB_BYTES = 12 * 1024 * 1024

const DEFAULT_API_BASE = 'https://us-central1-poplur2025.cloudfunctions.net/wardrobeGarmentApi'

export type WardrobeCatalogAsset = {
  url: string
  sha256: string
  bytes: number
}

export type WardrobeCatalogItem = {
  id: string
  label: string
  glyph: string
  slot: 'top' | 'bottom'
  version: string
  rig: typeof POPLUR_WARDROBE_RIG
  tintMaterial: string
  female: WardrobeCatalogAsset
  male: WardrobeCatalogAsset
}

export type WardrobeCatalog = {
  schemaVersion: 1
  generatedAt: string
  items: WardrobeCatalogItem[]
}

export type RemoteWardrobeStyles = {
  top: FashionStyle[]
  bottom: FashionStyle[]
}

const EMPTY_STYLES: RemoteWardrobeStyles = { top: [], bottom: [] }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maximum ? trimmed : null
}

function asset(value: unknown): WardrobeCatalogAsset | null {
  const input = record(value)
  if (!input) return null
  const url = text(input.url, 2_048)
  const sha256 = text(input.sha256, 64)
  const bytes = input.bytes
  if (!url || !sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) return null
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_WARDROBE_GLB_BYTES) return null
  try {
    const localHref = typeof window === 'undefined' ? 'http://127.0.0.1/' : window.location.href
    const localOrigin = new URL(localHref).origin
    const parsed = new URL(url, localHref)
    if (parsed.protocol !== 'https:' && parsed.origin !== localOrigin) return null
    if (!/\.glb(?:$|[?#])/i.test(parsed.href)) return null
  } catch {
    return null
  }
  return { url, sha256: sha256.toLowerCase(), bytes }
}

function item(value: unknown): WardrobeCatalogItem | null {
  const input = record(value)
  if (!input) return null
  const id = text(input.id, 64)
  const label = text(input.label, 80)
  const glyph = text(input.glyph, 4)
  const version = text(input.version, 80)
  const tintMaterial = text(input.tintMaterial, 80)
  const female = asset(input.female)
  const male = asset(input.male)
  if (!id || !/^clo-[a-z0-9](?:[a-z0-9-]{0,62})$/.test(id)) return null
  if (!label || !glyph || !version || !tintMaterial || !female || !male) return null
  if (input.slot !== 'top' && input.slot !== 'bottom') return null
  if (input.rig !== POPLUR_WARDROBE_RIG) return null
  return {
    id, label, glyph, version, tintMaterial, female, male,
    slot: input.slot,
    rig: POPLUR_WARDROBE_RIG,
  }
}

/** Parse the server catalog as hostile input. A malformed remote item is
    omitted instead of being allowed to reach GLTFLoader or overwrite the
    curated local fallback wardrobe. */
export function parseWardrobeCatalog(value: unknown): WardrobeCatalog {
  const input = record(value)
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.items)) {
    return { schemaVersion: 1, generatedAt: '', items: [] }
  }
  const generatedAt = text(input.generatedAt, 80) ?? ''
  const seen = new Set<string>()
  const items: WardrobeCatalogItem[] = []
  for (const candidate of input.items.slice(0, 100)) {
    const parsed = item(candidate)
    if (!parsed || seen.has(parsed.id)) continue
    seen.add(parsed.id)
    items.push(parsed)
  }
  return { schemaVersion: 1, generatedAt, items }
}

export function catalogFashionStyles(catalog: WardrobeCatalog): RemoteWardrobeStyles {
  const styles: RemoteWardrobeStyles = { top: [], bottom: [] }
  for (const garment of catalog.items) {
    styles[garment.slot].push({
      id: garment.id,
      label: garment.label,
      glyph: garment.glyph,
      tier: 'atelier',
      render: {
        kind: 'gltf',
        femaleUrl: garment.female.url,
        maleUrl: garment.male.url,
        tintMaterial: garment.tintMaterial,
        version: garment.version,
      },
    })
  }
  return styles
}

export async function loadWardrobeCatalog(signal?: AbortSignal): Promise<RemoteWardrobeStyles> {
  const configured = import.meta.env.VITE_WARDROBE_API_BASE?.trim()
  const endpoint = `${configured || DEFAULT_API_BASE}/catalog`
  try {
    const response = await fetch(endpoint, { signal, cache: 'no-store', credentials: 'omit' })
    if (!response.ok) return EMPTY_STYLES
    return catalogFashionStyles(parseWardrobeCatalog(await response.json()))
  } catch {
    return EMPTY_STYLES
  }
}
