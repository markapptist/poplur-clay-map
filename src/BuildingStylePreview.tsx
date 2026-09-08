import { useState } from 'react'

export const BUILDING_STYLE_PREVIEW = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('buildingStyles') === '1'

const looks = [
  { id: 'original', name: 'Current', note: 'Your existing stone buildings', colors: ['#cfc7bb', '#e6dfd4', '#dbd3c7', '#efe9df'] },
  { id: 'candy', name: 'Poplur candy', note: 'Lavender, blush and mint clay', colors: ['#b7a2d1', '#dfa6c6', '#a4c8bf', '#91c4d2', '#d8c1a2', '#9aaeda'] },
  { id: 'porcelain', name: 'Blue porcelain', note: 'Cool blue walls and pale roofs', colors: ['#6babc4', '#9abdd5', '#a2d5df', '#839ccc', '#b6cada', '#87b8bc'] },
  { id: 'terracotta', name: 'Terracotta', note: 'Peach, clay and warm sandstone', colors: ['#c78f79', '#d9ac87', '#b88b84', '#e2c29d', '#c5a181', '#d3a1a0'] },
  { id: 'midnight', name: 'Midnight', note: 'Ink, plum and electric blue accents', colors: ['#454174', '#355b74', '#704664', '#395b62', '#635586', '#43567f'] },
] as const
type Style = typeof looks[number]['id']
let selected: Style = BUILDING_STYLE_PREVIEW ? 'candy' : 'original'

export function previewBuildingMaterial(cap = false): unknown | undefined {
  if (!BUILDING_STYLE_PREVIEW || selected === 'original') return undefined
  const look = looks.find(item => item.id === selected)!
  if (cap) return selected === 'midnight' ? '#cf9ce5' : selected === 'terracotta' ? '#f2d0b3' : '#e3e5fa'
  const variation = ['%', ['floor', ['+', ['to-number', ['id'], 0],
    ['*', ['to-number', ['get', 'height'], 8], 3]]], look.colors.length]
  return ['match', variation, ...look.colors.slice(0, -1).flatMap((color, index) => [index, color]), look.colors.at(-1)]
}

export default function BuildingStylePreview({ onChange, onCity }: {
  onChange: () => void; onCity: (coords: [number, number]) => void
}) {
  const [style, setStyle] = useState<Style>(selected)
  if (!BUILDING_STYLE_PREVIEW) return null
  const look = looks.find(item => item.id === style)!
  return <aside aria-label="Building style preview" style={{ position: 'absolute', zIndex: 1000, bottom: 18,
    left: '50%', transform: 'translateX(-50%)', width: 'min(700px, calc(100% - 28px))', boxSizing: 'border-box',
    padding: '17px 18px', borderRadius: 28, background: 'rgba(255,246,252,.96)', border: '2px solid #ffd0e9',
    boxShadow: '0 8px 0 #692247, 0 16px 32px #210d3044', color: '#2f1930', fontFamily: 'system-ui' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <strong style={{ fontSize: 22 }}>Choose the city’s look</strong>
      <div style={{ display: 'flex', gap: 6 }}>{[
        ['Toronto', [-79.387, 43.644]], ['Dubai', [55.2744, 25.1972]], ['New York', [-73.9857, 40.7484]],
      ].map(([name, coords]) => <button key={String(name)} onClick={() => onCity(coords as [number, number])}
        style={{ border: '1px solid #e8bfd7', background: '#fff', borderRadius: 20, padding: '6px 10px', color: '#70405e', cursor: 'pointer' }}>{String(name)}</button>)}</div>
    </div>
    <p style={{ margin: '5px 0 12px', color: '#784964', fontSize: 13 }}>{look.note}. Browser preview only.</p>
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>{looks.map(item =>
      <button key={item.id} aria-pressed={style === item.id} onClick={() => { selected = item.id; setStyle(item.id); onChange() }}
        style={{ flex: '1 0 104px', borderRadius: 18, border: `2px solid ${style === item.id ? '#ed328e' : '#ead5e2'}`,
          padding: 9, color: '#472337', background: style === item.id ? '#ffe1f0' : '#fffafd', cursor: 'pointer' }}>
        <span style={{ display: 'flex', justifyContent: 'center', height: 32, gap: 3, marginBottom: 7 }} aria-hidden="true">
          {item.colors.slice(0, 4).map((color, i) => <i key={color} style={{ display: 'block', width: 17, height: 18 + i * 4, alignSelf: 'end', background: color, borderRadius: '4px 4px 0 0', boxShadow: 'inset -4px 0 #0002' }} />)}
        </span>
        <strong style={{ fontSize: 12 }}>{item.name}</strong>
      </button>)}</div>
  </aside>
}
