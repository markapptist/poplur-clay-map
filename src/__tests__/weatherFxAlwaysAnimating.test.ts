import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Live weather is a map CONDITION, not decoration. The frame governor's
// ambient sleep pauses every particle animation by class-name substring
// (index.css: `.poplur-ambient-sleep [class*="drop_"]`), and on a native shell
// ambient sleep is the normal state — a 3s burst, a 12s rest, and a return
// visit to the map that is asleep on arrival. A paused drop sits at top:-30px,
// above the viewport, so a rainy day renders as clear sky.
//
// WeatherFX.module.css exempts the weather layer from that pause. The exemption
// has been silently lost once already (authored in cd21f96, gone by 1 Sep) while
// WeatherFX.tsx kept applying `styles.weatherAlwaysAnimating` — which quietly
// resolves to `undefined` when the class is missing, so nothing failed and the
// rain simply stopped. These tests pin the two halves to each other.

const src = (name: string) => readFileSync(join(__dirname, '..', name), 'utf8')

const WEATHER_FX_TSX = src('WeatherFX.tsx')
const WEATHER_FX_CSS = src('WeatherFX.module.css')
const INDEX_CSS = src('index.css')

/** Every `styles.foo` in a component must be a real class in its module. */
function undefinedStyleRefs(tsx: string, css: string): string[] {
  const referenced = [...tsx.matchAll(/\bstyles\.([A-Za-z_][\w]*)/g)].map(m => m[1])
  return [...new Set(referenced)].filter(name => !new RegExp(`\\.${name}\\b`).test(css))
}

describe('WeatherFX ambient-sleep exemption', () => {
  it('defines every class WeatherFX.tsx applies', () => {
    // A missing CSS-module class is not a type error and not a runtime error —
    // it renders the string "undefined" into the class list. This is the check
    // that would have caught the lost exemption the day it went.
    expect(undefinedStyleRefs(WEATHER_FX_TSX, WEATHER_FX_CSS)).toEqual([])
  })

  it('still applies the always-animating hook to the weather layer', () => {
    expect(WEATHER_FX_TSX).toContain('styles.weatherAlwaysAnimating')
  })

  it('keeps the weather layer and its particles running through ambient sleep', () => {
    const rule = WEATHER_FX_CSS.slice(WEATHER_FX_CSS.indexOf('.weatherAlwaysAnimating'))
    expect(rule).toContain('poplur-ambient-sleep')
    // Both halves: the layer itself and the drops/flakes/stones inside it.
    expect(WEATHER_FX_CSS).toMatch(/\.weatherAlwaysAnimating \*/)
    expect(rule).toMatch(/animation-play-state:\s*running\s*!important/)
  })

  it('retains low-power and emergency as the thermal safety valve', () => {
    // The iOS shell writes LOW_POWER / EMERGENCY (PoplurPerformanceMode
    // .diagnosticName); index.css spells them lower-case. The guard matches
    // either, so the valve cannot be defeated by casing.
    expect(WEATHER_FX_CSS).toMatch(/:not\(\[data-poplur-performance-mode="low_power" i\]\)/)
    expect(WEATHER_FX_CSS).toMatch(/:not\(\[data-poplur-performance-mode="emergency" i\]\)/)
  })

  it('documents why the exemption is needed: ambient sleep pauses the particles', () => {
    // If this pause ever goes away the exemption is harmless, but while it
    // exists the exemption is the only thing keeping real rain on screen.
    expect(INDEX_CSS).toContain('.poplur-ambient-sleep [class*="drop_"]')
    expect(INDEX_CSS).toMatch(/animation-play-state:\s*paused\s*!important/)
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
