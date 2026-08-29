import { describe, expect, it } from 'vitest'
import { mapTourControlState } from '../mapTourControl'

describe('map landmark tour side control', () => {
  it('starts with Play, switches to the supplied Pause control, then resumes with Play', () => {
    expect(mapTourControlState(false, false)).toEqual({
      action: 'tour',
      icon: 'map.tour_play',
      label: 'Start map tour',
      pressed: false,
    })
    expect(mapTourControlState(true, false)).toEqual({
      action: 'pauseTour',
      icon: 'map.tour_pause',
      label: 'Pause map tour',
      pressed: true,
    })
    expect(mapTourControlState(true, true)).toEqual({
      action: 'resumeTour',
      icon: 'map.tour_play',
      label: 'Resume map tour',
      pressed: true,
    })
  })

  it('does not expose a paused appearance without an active tour', () => {
    expect(mapTourControlState(false, true)).toEqual(mapTourControlState(false, false))
  })
})
