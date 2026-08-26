export type FashionTier = 'classic' | 'atelier'

export type FashionRender =
  | { kind: 'procedural' }
  | {
      kind: 'gltf'
      femaleFile?: string
      maleFile?: string
      femaleUrl?: string
      maleUrl?: string
      tintMaterial: string
      version: string
    }

export type FashionStyle = {
  id: string
  label: string
  glyph: string
  tier: FashionTier
  render: FashionRender
}

export const TOP_FASHION_STYLES = [
  { id: 'tee', label: 'Tee', glyph: 'T', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'hoodie', label: 'Hoodie', glyph: 'H', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'jacket', label: 'Jacket', glyph: 'J', tier: 'classic', render: { kind: 'procedural' } },
  {
    id: 'tailored-blazer',
    label: 'Arc fitted jacket',
    glyph: '◈',
    tier: 'atelier',
    render: {
      kind: 'gltf',
      femaleFile: 'Poplur_Atelier_Jacket_Female.glb',
      maleFile: 'Poplur_Atelier_Jacket_Male.glb',
      tintMaterial: 'PoplurAtelierTint',
      version: '2026-08-26.28',
    },
  },
] as const satisfies readonly FashionStyle[]

export const BOTTOM_FASHION_STYLES = [
  { id: 'jeans', label: 'Jeans', glyph: 'J', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'shorts', label: 'Shorts', glyph: 'S', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'skirt', label: 'Skirt', glyph: 'K', tier: 'classic', render: { kind: 'procedural' } },
  {
    id: 'tailored-trousers',
    label: 'Arc tailored trousers',
    glyph: 'Ⅱ',
    tier: 'atelier',
    render: {
      kind: 'gltf',
      femaleFile: 'Poplur_Atelier_Trousers_Female.glb',
      maleFile: 'Poplur_Atelier_Trousers_Male.glb',
      tintMaterial: 'PoplurAtelierBottomTint',
      version: '2026-08-26.24',
    },
  },
] as const satisfies readonly FashionStyle[]

export const ACCESSORY_FASHION_STYLES = [
  { id: 'none', label: 'None', glyph: '—', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'glasses', label: 'Glasses', glyph: '⌐', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'cap', label: 'Cap', glyph: '⌒', tier: 'classic', render: { kind: 'procedural' } },
  { id: 'chain', label: 'Chain', glyph: '◆', tier: 'classic', render: { kind: 'procedural' } },
] as const satisfies readonly FashionStyle[]

export const FASHION_STYLES_BY_SLOT = {
  top: TOP_FASHION_STYLES,
  bottom: BOTTOM_FASHION_STYLES,
  accessory: ACCESSORY_FASHION_STYLES,
} as const

export type FashionSlot = keyof typeof FASHION_STYLES_BY_SLOT
export type TopFashionStyleId = typeof TOP_FASHION_STYLES[number]['id']
export type BottomFashionStyleId = typeof BOTTOM_FASHION_STYLES[number]['id']
export type AccessoryFashionStyleId = typeof ACCESSORY_FASHION_STYLES[number]['id']
export type FashionStyleIdBySlot = {
  top: string
  bottom: string
  accessory: string
}
export type FashionOutfit = { [Slot in FashionSlot]?: FashionStyleIdBySlot[Slot] }

const FASHION_DEFAULTS: { [Slot in FashionSlot]: FashionStyleIdBySlot[Slot] } = {
  top: 'tailored-blazer',
  bottom: 'tailored-trousers',
  accessory: 'none',
}

/** Persisted characters can outlive a catalog version. Unknown or layered-art
    part ids therefore resolve to a predictable 3D garment instead of being
    interpreted as a vaguely similar procedural shape. */
export function coerceFashionStyle<Slot extends FashionSlot>(slot: Slot, value: unknown): FashionStyleIdBySlot[Slot] {
  const styles = FASHION_STYLES_BY_SLOT[slot] as readonly FashionStyle[]
  // CLO-authored catalog ids are resolved after the lightweight Wardrobe UI
  // has appeared. Preserve a previously selected remote garment while that
  // catalog is loading; the renderer still falls back safely if it is no
  // longer published.
  const remoteId = typeof value === 'string' && /^clo-[a-z0-9](?:[a-z0-9-]{0,62})$/.test(value)
  return (typeof value === 'string' && styles.some(style => style.id === value)
    ? value
    : remoteId && slot !== 'accessory'
      ? value
    : FASHION_DEFAULTS[slot]) as FashionStyleIdBySlot[Slot]
}
