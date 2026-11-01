import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// OWNER DECISION 1 Nov 2026 (replaces the 11 Sep press-to-Feed hop): "when i
// click a pin on the map, i should be able to swipe on the swipe area to
// browse that users posts." A press stays on the map, opens the pop's card and
// arms that poster's route, so the gesture pad walks only their pins — never
// the landmarks and strangers of the whole board. VIEW IN FEED on the card is
// still the way into the Feed.
const src = readFileSync(join(__dirname, '..', 'MapApp.tsx'), 'utf8')
const start = src.indexOf('const openClickedMapPinContent = useCallback(')
const body = src.slice(start, src.indexOf('/** Where the radius bench has planted its pin', start))

describe('pressing a pin selects its poster on the map', () => {
  it('arms the pressed poster\'s route on a press, without toggling it off', () => {
    expect(body).toContain('if (!automatic) {')
    expect(body).toContain('const ownerKey = pinOwnerKey(pin)')
    expect(body).toContain('if (focusedUserKeyRef.current !== ownerKey) toggleOwnerFilter(ownerKey, pin.id)')
    // Arming happens before the focus so the filtered route resolves "k of N"
    // on this pin.
    expect(body.indexOf('toggleOwnerFilter(ownerKey, pin.id)')).toBeLessThan(body.indexOf('focusMapPointForPin(pin.id)'))
  })

  it('opens the card instead of leaving for the Feed', () => {
    expect(body).not.toContain('openPinInFeed(')
    expect(body).not.toContain('directToFeed')
    expect(body).toMatch(/\n\s*showPinContentCard\(pin\)\n\s*\}, \[/)
  })

  it('walks only the armed poster\'s pins, with no landmarks or current location', () => {
    expect(src).toMatch(/const userPins = mapPins\.filter\(pin => !pin\.ghost && pinOwnerKey\(pin\) === focusedUserKey\)\s*\n\s*return buildMapPointCycle\(\{ currentLocation: null, pins: userPins, landmarks: \[\] \}\)/)
  })

  it('keeps one Feed handoff, on the card\'s VIEW IN FEED', () => {
    expect(src.match(/type: 'poplur-map-open-feed-content'/g)?.length).toBe(1)
    expect(src).toContain("onActivate: pin.media && pin.contentType !== 'message' ? () => { openPinInFeed(pin) } : undefined")
  })

  // Mark, 1 Nov: "there needs to be a way to change between just my posts and
  // other posts for swiping." The layers button is that switch.
  it('walks only the picked level\'s pins on My pops or Other pops', () => {
    expect(src).toMatch(/if \(popLevel !== 'all'\) \{\s*\n\s*return buildMapPointCycle\(\{ currentLocation: null, pins: mapPins\.filter\(pin => !pin\.ghost\), landmarks: \[\] \}\)/)
    expect(src).toContain('}, [currentLocation, mapPins, focusedUserKey, popLevel])')
  })

  it('lets a level pick release a poster armed by a pin press', () => {
    const i = src.indexOf('const lastPopLevelRef = useRef(popLevel)')
    expect(i).toBeGreaterThan(0)
    const block = src.slice(i, i + 400)
    expect(block).toContain('setFocusedUserKey(null)')
    expect(block).toContain('}, [popLevel])')
  })

  it('names what the swipe walks on the pad', () => {
    expect(src).toContain("popLevel === 'mine' ? 'MY POPS' : popLevel === 'others' ? 'OTHER POPS' : 'ALL POINTS'")
  })
})
