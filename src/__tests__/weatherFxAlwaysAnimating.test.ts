import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Idle weather remains visible, but must stop compositor motion alongside
// the map renderer. Particle negative delays preserve the still weather.

const src = (name: string) => readFileSync(join(__dirname, '..', name), 'utf8')

const WEATHER_FX_TSX = src('WeatherFX.tsx')
const WEATHER_FX_CSS = src('WeatherFX.module.css')
const INDEX_CSS = src('index.css')

/** Every `styles.foo` in a component must be a real class in its module. */
function undefinedStyleRefs(tsx: string, css: string): string[] {
  const referenced = [...tsx.matchAll(/\bstyles\.([A-Za-z_][\w]*)/g)].map(m => m[1])
  return [...new Set(referenced)].filter(name => !new RegExp(`\\.${name}\\b`).test(css))
}

describe('WeatherFX idle motion', () => {
  it('defines every class the weather layer applies', () => {
    expect(undefinedStyleRefs(WEATHER_FX_TSX, WEATHER_FX_CSS)).toEqual([])
    expect(WEATHER_FX_TSX).toContain('styles.weatherLayer')
  })

  it('parks all weather motion in ambient sleep and under OS pressure', () => {
    for (const selector of [
      ':global(html.poplur-ambient-sleep) .weatherLayer *',
      ':global(html[data-poplur-performance-mode="low_power" i]) .weatherLayer *',
      ':global(html[data-poplur-performance-mode="emergency" i]) .weatherLayer *',
    ]) expect(WEATHER_FX_CSS).toContain(selector)
    expect(WEATHER_FX_CSS).toContain('animation-play-state: paused !important;')
    expect(WEATHER_FX_CSS).not.toContain('animation-play-state: running !important;')
    expect(INDEX_CSS).toContain('.poplur-ambient-sleep')
  })

  it('keeps idle clouds in their visible resting position', () => {
    expect(WEATHER_FX_CSS).toContain(':global(html.poplur-ambient-sleep) .weatherLayer .cloud')
    expect(WEATHER_FX_CSS).toContain('animation: none !important;')
  })
})

describe('Weather never renders as nothing', () => {
  // The whole class of bug behind "it was raining but I saw no rain": a
  // particle rests at its authored top:-30px, ABOVE the viewport, so every
  // mechanism that stops the motion — ambient sleep, low power, emergency,
  // reduced motion — turned a rainy map into clear sky rather than into still
  // rain. A negative animation-delay moves the resting frame on screen, so
  // stopping the motion can only ever make the weather STILL, never absent.

  it('starts every particle already in flight, so a paused frame is on screen', () => {
    expect(WEATHER_FX_TSX).toMatch(/delay:\s*-rand\(\)/)
    // A positive delay also meant the native shell's 3s ambient burst could
    // expire before a drop with a 4s delay had started at all.
    expect(WEATHER_FX_TSX).not.toMatch(/delay:\s*rand\(\)\s*\*/)
  })

  it('keeps reduced motion still rather than empty', () => {
    const reduced = WEATHER_FX_CSS.slice(WEATHER_FX_CSS.indexOf('prefers-reduced-motion'))
    // Particles pause (visible, motionless); they must not lose the animation
    // outright, which is what put them back above the viewport.
    expect(reduced).toMatch(/\.drop,\s*\.flake,\s*\.stone\s*\{\s*animation-play-state:\s*paused/)
    expect(reduced).not.toMatch(/\.drop[^{]*\{\s*animation:\s*none/)
  })

  it('applies the motion preference to hail too', () => {
    // .stone was absent from the reduced-motion block entirely, so hail kept
    // hammering down for a user who had asked for less motion.
    const reduced = WEATHER_FX_CSS.slice(WEATHER_FX_CSS.indexOf('prefers-reduced-motion'))
    expect(reduced).toContain('.stone')
  })

  it('leaves clouds on `animation: none`, whose resting frame is the visible one', () => {
    // Inverse of the particles: `drift` STARTS at translate -240px, off the
    // left edge, so pausing a cloud would hide it. Natural position is correct.
    const reduced = WEATHER_FX_CSS.slice(WEATHER_FX_CSS.indexOf('prefers-reduced-motion'))
    expect(reduced).toMatch(/\.cloud,\s*\.lightning,\s*\.fog\s*\{\s*animation:\s*none/)
  })
})
