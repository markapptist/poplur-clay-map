import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RADIUS_TROPHIES, STRIKER_MS, radiusMeterLevel } from '../radiusTrophies'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const profile = read('../ProfileTwin.tsx')
const rail = read('../RadiusStrikerRail.tsx')
const railCss = read('../RadiusStrikerRail.module.css')
const mapCss = read('../ClayMap.module.css')
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

  it('over the GRID stands exactly as tall as the control rail opposite, wearing a rail-sized trophy', () => {
    // Profile overrides the default rail to span the 200px avatar.
    expect(profile).toContain('const profileRailSpan = 200')
    expect(read('../ProfileTwin.module.css')).toContain('top: var(--profile-control-top);')
    expect(profile).toContain('span={viewerPost ? undefined : profileRailSpan}')
    expect(profile).toContain('thumbSize={viewerPost ? 68 : 44}')
    expect(rail).toContain("'--mapControlSpan': `${Math.max(0, Math.round(span))}px`")
    expect(railCss).toContain('top: var(--profile-control-top')
  })

  it('over an OPENED pop stands the full screen, on the guides the post’s own action rail uses', () => {
    // An opened pop is a full-screen picture; measuring it on the grid's 200px
    // tower bunched the five trophies into a fifth of the screen.
    expect(profile).toContain('fill={Boolean(viewerPost)}')
    expect(rail).toContain('fill = false')
    expect(rail).toContain('${fill ? styles.fill : \'\'}')
    // `span` is ignored while filling — publishing it would leave the capped
    // height rule fighting the bottom guide.
    expect(rail).toContain("...(span != null && !fill ? { '--mapControlSpan'")
    // The SAME two variables the action rail opposite is hung from
    // (TabControlRail's .fill), not numbers measured to match it.
    const fillRule = railCss.slice(railCss.indexOf('.fill {'))
    expect(fillRule).toContain('--poplur-map-control-top')
    expect(fillRule).toContain('bottom: var(--poplur-home-clearance')
    // Without this the base rule's capped height wins and the bottom guide
    // does nothing at all.
    expect(fillRule.slice(0, fillRule.indexOf('}'))).toContain('height: auto')
    expect(read('../TabControlRail.module.css')).toContain('--poplur-map-control-top')
    // Still a meter: going full screen does not make it a control.
    expect(rail).not.toContain('onPointerDown')
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
    expect(home).toMatch(/profileReachKm != null\s*\? `profile-pop:\$\{profileReachKm\}`/)
  })
})

describe('the block control wears the supplied clay art', () => {
  const feed = read('../FeedTwin.tsx')
  const ids = read('../sideControlIcons.ts')
  const manifest = JSON.parse(read('../side-control-icons/manifest.json')) as { buttons: { id: string; asset: string }[] }

  it('is registered once, as global.block, backed by the 512/256 pack files', () => {
    expect(ids).toContain("'global.block'")
    const entry = manifest.buttons.find(button => button.id === 'global.block')
    expect(entry?.asset).toBe('global/block')
    for (const size of [256, 512]) {
      expect(existsSync(fileURLToPath(new URL(`../../public/poplur-side-buttons/assets/${size}/global/block.png`, import.meta.url))), `${size}`).toBe(true)
    }
  })

  it('replaces the drawn glyph in the feed column and the moulded ring on a visited profile', () => {
    expect(feed).toMatch(/<SideControlIconImage icon="global.block" displaySize=\{44\}(?: fluid)? \/>/)
    expect(feed).not.toContain('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>')
    expect(profile).toContain('<SideControlIconImage icon="global.block" displaySize={44} />')
    expect(profile).not.toContain('kind="block"')
  })
})

describe('an opened post steps on the shared D-pad', () => {
  it('uses ClayArrowCluster — the same one the map, camera and feed step with', () => {
    expect(profile).toContain("import ClayArrowCluster from './ClayArrowCluster'")
    expect(profile).toContain('<ClayArrowCluster')
    expect(profile).not.toContain('<ProfilePostStep')
  })

  it('keeps this grid’s meaning on the cluster’s two axes', () => {
    // ▲▼ = the tile above and below (one row, same column);
    // ◀▶ = previous and next in reading order. profilePostSteps.ts owns both.
    for (const wiring of [
      "onUp={() => stepViewerPost('up')}",
      "onDown={() => stepViewerPost('down')}",
      "onLeft={() => stepViewerPost('left')}",
      "onRight={() => stepViewerPost('right')}",
    ]) {
      expect(profile, wiring).toContain(wiring)
    }
    for (const label of ['Post above', 'Post below', 'Previous post', 'Next post']) {
      expect(profile, label).toContain(label)
    }
  })

  it('walks the grid through ONE stepper, whatever asked — D-pad or swipe', () => {
    // The swipe gesture used to duplicate the index arithmetic; both go through
    // stepViewerPost now, so the two can never disagree about an edge.
    expect(profile.match(/stepProfilePostIndex\(/g) ?? []).toHaveLength(1)
    expect(profile).toContain('stepViewerPost(direction)')
  })

  it('does not switch the post under a sheet the user is deciding on', () => {
    expect(profile).toMatch(/const stepViewerPost = \(direction: ProfilePostStepDirection\) => \{\s*if \(viewerCoveredRef\.current\) return false/)
  })

  it('gives the rail back the column the chevrons were holding', () => {
    // The same move the map made when its travel button became the cluster's
    // up arrow: nothing shares this column now, so nothing is reserved below.
    // The declaration and the prop, not the word — the comment that explains
    // why the reserve went still names it, and should.
    expect(profile).not.toContain('const PROFILE_POST_STEP_RESERVE =')
    expect(profile).not.toContain('reserveBelow=')
    // Both screens now keep their D-pad in the centre, outside this column.
    expect(read('../PostActionRail.tsx')).toContain("fillReserveBelow={reserveBelow ?? '0px'}")
  })
})

describe('the opened pop and its meter hang from the same two guides', () => {
  const railCssShared = read('../TabControlRail.module.css')
  const profileCss = read('../ProfileTwin.module.css')

  it('starts both rails on the header line, with the profile override standing clear', () => {
    // The action rail and the tower opposite it are a PAIR: same top, same
    // bottom. The profile's own rule re-hung the left one at the avatar's
    // 110px, so the two columns started 43px apart.
    expect(railCssShared).toContain('--poplur-map-control-top')
    expect(railCss).toContain('--poplur-map-control-top')
    expect(read('../TabControlRail.tsx')).toContain("data-poplur-control-rail-fill={fill ? 'true' : undefined}")
    expect(profileCss).toContain('.profile :global([data-poplur-control-rail]:not([data-poplur-control-rail-fill])) {')
    // The profile's three selfie actions still span the avatar; only the
    // filling rail is exempt.
    expect(profileCss).toContain('top: var(--profile-control-top);')
  })

  it('drops the two lines of text the home chrome was covering', () => {
    for (const gone of ['viewerHint', 'browse your posts', 'styles.viewerTitle']) {
      expect(profile, gone).not.toContain(gone)
      }
    expect(profileCss).not.toContain('.viewerHint')
    expect(profileCss).not.toContain('.viewerTitle')
    // What stays in that band clears the chrome instead of hiding behind it.
    expect(profileCss).toContain('bottom: calc(var(--poplur-home-clearance) + 10px);')
    expect(profileCss).toContain('bottom: calc(var(--poplur-home-clearance) + 64px);')
  })
})
