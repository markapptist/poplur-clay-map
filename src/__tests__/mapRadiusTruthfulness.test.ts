import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The radius on screen has to be the radius, in the user's unit, for the
 * subject actually being shown.
 *
 * Three separate defects met on one screen. The account total was derived from
 * the web Firestore client on a device, where it has no authenticated user, so
 * it reported 0.0mi for an account holding a 6.5km pop. The pin callout
 * hardcoded KM while the HUD one layer up rendered miles, so a single 6500m
 * radius appeared as both "6.5 KM" and "4.0 mi" and read as two different
 * radii. And a pin with no handle fell back to the label "YOU", which is the
 * shape of bug that makes a stranger's pop look like your own.
 *
 * These are component internals with no DOM available here, so the source is
 * read — the same approach the other map tests in this suite take.
 */
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

describe('the account total is derived from something a phone can see', () => {
  const mapApp = src('MapApp.tsx')

  it('sums the forwarded pins on a device, not only on the Expo web route', () => {
    // The bug: `if (!rnWebShellRoute) return` meant the sum never ran on a
    // phone, because a phone is the native shell and not that route.
    expect(mapApp).toContain('if (!rnWebShellRoute && !nativeShell) return')
  })

  it('does not ask the unauthenticated web client for the total on a device', () => {
    expect(mapApp).toContain("if (rnWebShellRoute || nativeShell) return undefined")
  })

  it('still zeroes only as an explicit fallback, never as the device path', () => {
    // Both non-happy paths of the subscription emit {0, 0}; that is fine as an
    // error fallback and fatal as the routine path.
    const accountRadius = src('accountRadiusPosts.ts')
    expect(accountRadius).toContain('listener({ radiusKm: 0, totalReachKm: 0, postCount: 0 })')
  })
})

describe('one radius, one unit, per screen', () => {
  const mapApp = src('MapApp.tsx')

  it('the map knows about the shared unit preference at all', () => {
    expect(mapApp).toContain("import { KM_TO_MI, shouldUseMiles } from './units'")
  })

  it('the pin callout no longer hardcodes kilometres', () => {
    expect(mapApp).not.toContain('} KM RADIUS')
    expect(mapApp).toContain("preferMiles ? 'MI' : 'KM'")
  })

  it('re-reads the preference when the other document changes it', () => {
    // The toggle lives in the shell; this is an iframe. `storage` is what
    // crosses that boundary for a same-origin document.
    expect(mapApp).toContain("window.addEventListener('storage', reread)")
  })

  it('keeps the probe attribute in kilometres whatever is displayed', () => {
    // A probe that changed unit with a user preference would be measuring the
    // label rather than the radius.
    expect(mapApp).toContain('data-map-point-radius-km={focusedMapPoint.radiusKm}')
  })
})

describe('only your own pins say YOU', () => {
  it('keys the owner label off ownership, not off a missing handle', () => {
    expect(src('ClayMap.tsx')).toContain("pin.mine ? 'YOU' : (pin.user ?? '')")
  })
})

describe('the corner card reports the person on screen', () => {
  const home = src('HomeTwin.tsx')
  const profile = src('ProfileTwin.tsx')

  it("reads a visited profile's own totals instead of your account", () => {
    // Standing on somebody else's grid, the card used to fall through to
    // earnedRadiusKm and print YOUR radius over THEIR posts.
    expect(profile).toContain('onVisitedTotals?.(visiting || uploadedPostsLoaded ? { radiusKm: visiting ? visitedRadiusKm : accountRadiusKm, posts: visitedPostCount } : null)')
    expect(home).toContain('onVisitedTotals={setVisitedTotals}')
    expect(home).toContain("activeTab === 'profile' && visitedTotals != null\n              ? visitedTotals.radiusKm")
  })

  it('names whose total it is, and counts their pops not yours', () => {
    expect(home).toContain('`${viewingUser} ◆`')
    expect(home).toContain('${visitedTotals != null ? visitedTotals.posts : profilePostCount} posts')
  })

  it('hands the card back when the visit ends', () => {
    // Both the leave-effect and the null branch, so a closed profile cannot
    // strand somebody else's number in the corner.
    expect(profile).toContain('useEffect(() => () => { onVisitedTotals?.(null) }, [onVisitedTotals])')
  })

  it("re-tallies per person so one profile's climb does not drift into the next", () => {
    expect(home).toContain('`profile-visited:${viewingUser}`')
  })
})
