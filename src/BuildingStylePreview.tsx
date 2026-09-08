import { useState } from 'react'
import { BUILDING_LOOKS, buildingDayPalette } from './buildingDayStyle'
import { skySchedule, skyShadeAt, type SkyShade } from './skyCycle'

export const BUILDING_STYLE_PREVIEW = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('buildingStyles') === '1'

const moments = [
  { phase: 'dawn', name: 'Sunrise', look: 'terracotta' },
  { phase: 'morning', name: 'Morning', look: 'original' },
  { phase: 'high-day', name: 'Midday', look: 'porcelain' },
  { phase: 'golden-hour', name: 'Evening', look: 'candy' },
  { phase: 'deep-night', name: 'Night', look: 'midnight' },
] as const
let previewMoment: Date | null = null

export function buildingPreviewShade(): SkyShade | null {
  return BUILDING_STYLE_PREVIEW && previewMoment ? skyShadeAt(previewMoment) : null
}

export default function BuildingStylePreview({ sky, onChange, onCity }: {
  sky: SkyShade; onChange: () => void; onCity: (coords: [number, number]) => void
}) {
  const [selected, setSelected] = useState('live')
  if (!BUILDING_STYLE_PREVIEW) return null
  const look = BUILDING_LOOKS[buildingDayPalette(sky).look]
  const choose = (phase: string) => {
    setSelected(phase)
    previewMoment = null
    if (phase !== 'live') {
      const when = new Date()
      const band = skySchedule(when).find(item => item.key === phase)!
      const [hours, minutes] = band.startsAt.split(':').map(Number)
      // Inside a stable band, beyond its boundary blend; the same clock
      // changes both buildings and sky. No saved production preference.
      when.setHours(hours, minutes + 25, 0, 0)
      previewMoment = when
    }
    onChange()
  }
  return <aside aria-label="Building style preview" style={{ position: 'absolute', zIndex: 1000, bottom: 18,
    left: '50%', transform: 'translateX(-50%)', width: 'min(700px, calc(100% - 28px))', boxSizing: 'border-box',
    padding: '17px 18px', borderRadius: 28, background: 'rgba(255,246,252,.96)', border: '2px solid #ffd0e9',
    boxShadow: '0 8px 0 #692247, 0 16px 32px #210d3044', color: '#2f1930', fontFamily: 'system-ui' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <strong style={{ fontSize: 22 }}>A city that changes with the day</strong>
      <div style={{ display: 'flex', gap: 6 }}>{[
        ['Toronto', [-79.387, 43.644]], ['Dubai', [55.2744, 25.1972]], ['New York', [-73.9857, 40.7484]],
      ].map(([name, coords]) => <button key={String(name)} onClick={() => onCity(coords as [number, number])}
        style={{ border: '1px solid #e8bfd7', background: '#fff', borderRadius: 20, padding: '6px 10px', color: '#70405e', cursor: 'pointer' }}>{String(name)}</button>)}</div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, margin: '8px 0 12px' }}>
      <p aria-live="polite" style={{ margin: 0, color: '#784964', fontSize: 13 }}>{sky.name} · {look.name}<br />
        {selected === 'live' ? 'Following your local time. Colours blend gradually.' : 'Time preview. Return to Live time to follow your clock.'}</p>
      <button aria-pressed={selected === 'live'} onClick={() => choose('live')}
        style={{ flexShrink: 0, border: '2px solid #ed328e', borderRadius: 20, padding: '8px 12px', background: selected === 'live' ? '#ed328e' : '#fff', color: selected === 'live' ? '#fff' : '#a52868', cursor: 'pointer' }}>Live time</button>
    </div>
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>{moments.map(item =>
      <button key={item.phase} aria-pressed={selected === item.phase} onClick={() => choose(item.phase)}
        style={{ flex: '1 0 104px', borderRadius: 18, border: `2px solid ${selected === item.phase ? '#ed328e' : '#ead5e2'}`,
          padding: 9, color: '#472337', background: selected === item.phase ? '#ffe1f0' : '#fffafd', cursor: 'pointer' }}>
        <span style={{ display: 'flex', justifyContent: 'center', height: 32, gap: 3, marginBottom: 7 }} aria-hidden="true">
          {BUILDING_LOOKS[item.look].colors.slice(0, 4).map((color, i) => <i key={i} style={{ display: 'block', width: 17, height: 18 + i * 4, alignSelf: 'end', background: color, borderRadius: '4px 4px 0 0', boxShadow: 'inset -4px 0 #0002' }} />)}
        </span>
        <strong style={{ fontSize: 13 }}>{item.name}</strong><br />
        <span style={{ fontSize: 11 }}>{BUILDING_LOOKS[item.look].name}</span>
      </button>)}</div>
  </aside>
}
