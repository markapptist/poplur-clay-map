import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RADIUS_TROPHIES, STRIKER_MS, radiusMeterLevel } from '../radiusTrophies'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const profile = read('../ProfileTwin.tsx')
const rail = read('../RadiusStrikerRail.tsx')
const railCss = read('../RadiusStrikerRail.module.css')
const mapCss = read('../ClayMap.module.css')
const step = read('../ProfilePostStep.tsx')
const stepCss = read('../ProfilePostStep.module.css')
const home = read('../HomeTwin.tsx')

describe('the profile radius meter is the map’s striker, in sync with the radius', () => {
  it('stands on the rail the controls are not on and measures what the RADIUS card shows', () => {
    expect(profile).toContain("side={controlSide === 'right' ? 'left' : 'right'}")
    expect(profile).toContain('radiusKm={meterRadiusKm}')
    expect(profile).toContain('subjectKey={meterSubjectKey}')
    // Open pop → that pop's reach; own profile → the account total the map
    // and shell share; a visited profile → their pops' reach combined.
    expect(profile).toMatch(/const meterRadiusKm = viewerPost\s*\?\s*\(viewerPost\.reachKm \?\? 0\)\s*:\s*visiting \? visitedRadiusKm : accountRadiusKm/)
    expect(profile).toContain('readAccountRadiusKm')
    expect(profile).toContain('window.addEventListener(ACCOUNT_RADIUS_CHANGE_EVENT, refresh)')
  })

  it('climbs on the map striker’s own tower: same tiers, same log rail, same beat', () => {
    expect(rail).toContain("from './radiusTrophies'")
    for (const name of ['RADIUS_TROPHIES', 'radiusMeterLevel', 'radiusTrophyLevel', 'strikerEase', 'STRIKER_MS']) {
      expect(rail, name).toContain(name)
    }
    expect(rail).toContain('playPop(0.55)')
    expect(rail).toContain('modelSprite(trophy.model, RADIUS_TROPHY_SPRITE_VIEW)')
    expect(STRIKER_MS).toBe(880)
    expect(RADIUS_TROPHIES.map(t => t.tier)).toEqual(['bronze', 'silver', 'gold', 'platinum', 'diamond'])
    expect(radiusMeterLevel(0)).toBe(0)
    expect(radiusMeterLevel(6_371)).toBeCloseTo(1, 6)
  })

  it('re-climbs from the foot for a new subject and never takes a pointer', () => {
    expect(rail).toContain('const from = fresh ? 0 : levelRef.current')
    expect(rail).toContain('role="meter"')
    expect(rail).not.toContain('onPointerDown')
    expect(railCss).toContain('pointer-events: none;')
  })

  it('wears the map rail’s material: barber fill, trophy ring, tier ticks', () => {
    const shared = [
      'repeating-linear-gradient(45deg,',
      "url('/zoom-tick.png') center / contain no-repeat",
      'cubic-bezier(0.18, 0.86, 0.28, 1.34)',
      'inset 0 2px 5px rgba(0, 0, 0, 0.85)',
    ]
    for (const rule of shared) {
      expect(railCss, rule).toContain(rule)
      expect(mapCss, rule).toContain(rule)
    }
    expect(rail).toContain("data-radius-striker={shown.tier ?? 'below-bronze'}")
  })

  it('makes the RADIUS number re-tally on the same beat the tower climbs', () => {
    expect(home).toContain("? (profileReachKm != null ? `profile-pop:${profileReachKm}` : 'profile-total')")
  })
})

describe('the opened post’s inner arrows', () => {
  it('sit under the action rail on the control side, four chevrons from the feed’s own art', () => {
    expect(profile).toContain('<ProfilePostStep')
    expect(profile).toContain('availability={profilePostStepAvailability(viewerSlot, posts.length)}')
    expect(profile).toContain('stepProfilePostIndex(viewerSlot, posts.length, direction)')
    expect(step).toContain('icon="global.channel_up"')
    expect(step).toContain('icon="global.channel_down"')
    expect(step).toContain("transform: 'rotate(-90deg)'")
    expect(step).toContain("transform: 'rotate(90deg)'")
    for (const label of ['Post above', 'Post below', 'Previous post', 'Next post']) {
      expect(step, label).toContain(`aria-label="${label}"`)
    }
    expect(stepCss).toContain('bottom: var(--poplur-home-clearance);')
  })

  it('does not switch the post under a sheet the user is deciding on', () => {
    expect(profile).toMatch(/onStep=\{direction => \{\s*\/\/[^\n]*\n\s*if \(viewerCovered\) return/)
  })
})
