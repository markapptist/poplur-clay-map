import type { SkyShade } from './skyCycle'

export const BUILDING_LOOKS = {
  original: { name: 'Warm stone', colors: ['#cfc7bb', '#e6dfd4', '#dbd3c7', '#efe9df', '#cfc7bb', '#dbd3c7'], roof: '#efe9df' },
  candy: { name: 'Poplur candy', colors: ['#b7a2d1', '#dfa6c6', '#a4c8bf', '#91c4d2', '#d8c1a2', '#9aaeda'], roof: '#e3e5fa' },
  porcelain: { name: 'Blue porcelain', colors: ['#6babc4', '#9abdd5', '#a2d5df', '#839ccc', '#b6cada', '#87b8bc'], roof: '#e3e5fa' },
  terracotta: { name: 'Terracotta', colors: ['#c78f79', '#d9ac87', '#b88b84', '#e2c29d', '#c5a181', '#d3a1a0'], roof: '#f2d0b3' },
  midnight: { name: 'Midnight', colors: ['#454174', '#355b74', '#704664', '#395b62', '#635586', '#43567f'], roof: '#cf9ce5' },
} as const
export type BuildingLook = keyof typeof BUILDING_LOOKS

const phaseLooks: Record<string, BuildingLook> = {
  'pre-dawn': 'midnight', dawn: 'terracotta', morning: 'original',
  'high-day': 'porcelain', afternoon: 'porcelain',
  'golden-hour': 'candy', dusk: 'candy', evening: 'midnight', 'deep-night': 'midnight',
}

function mixColor(from: string, to: string, mix: number): string {
  return '#' + [1, 3, 5].map(offset => {
    const a = parseInt(from.slice(offset, offset + 2), 16)
    const b = parseInt(to.slice(offset, offset + 2), 16)
    return Math.round(a + (b - a) * mix).toString(16).padStart(2, '0')
  }).join('')
}

/** Reuse the sky's seasonal local clock and eased 18-minute boundary blend.
 * No timer, geometry, texture or per-frame colour work lives here. */
export function buildingDayPalette(shade: SkyShade) {
  const from = phaseLooks[shade.phase.from] ?? 'midnight'
  const to = phaseLooks[shade.phase.to] ?? 'midnight'
  const mix = Math.max(0, Math.min(1, shade.phase.mix))
  const a = BUILDING_LOOKS[from]
  const b = BUILDING_LOOKS[to]
  return {
    look: mix < 0.5 ? from : to,
    colors: a.colors.map((color, index) => mixColor(color, b.colors[index], mix)),
    roof: mixColor(a.roof, b.roof, mix),
  }
}

export function buildingDayMaterial(shade: SkyShade, cap = false): unknown {
  const palette = buildingDayPalette(shade)
  if (cap) return palette.roof
  // Every palette has the same six slots so each building keeps its identity
  // through a blend. Overture's string IDs fall back safely to its height.
  const variation = ['%', ['floor', ['+', ['to-number', ['id'], 0],
    ['*', ['to-number', ['get', 'height'], 8], 3]]], palette.colors.length]
  return ['match', variation, ...palette.colors.slice(0, -1).flatMap((color, index) => [index, color]),
    palette.colors[palette.colors.length - 1]]
}
