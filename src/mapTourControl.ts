import type { SideControlIconId } from './sideControlIcons'

export type MapTourControlAction = 'tour' | 'pauseTour' | 'resumeTour'

export interface MapTourControlState {
  action: MapTourControlAction
  icon: SideControlIconId
  label: string
  pressed: boolean
}

/**
 * One map-rail position owns all three landmark-tour states. While a tour is
 * moving it wears the supplied pause artwork; a paused tour returns to Play
 * so the next gesture has the familiar resume affordance.
 */
export function mapTourControlState(
  active: boolean,
  paused: boolean,
): MapTourControlState {
  if (!active) {
    return {
      action: 'tour',
      icon: 'map.tour_play',
      label: 'Start map tour',
      pressed: false,
    }
  }
  if (paused) {
    return {
      action: 'resumeTour',
      icon: 'map.tour_play',
      label: 'Resume map tour',
      pressed: true,
    }
  }
  return {
    action: 'pauseTour',
    icon: 'map.tour_pause',
    label: 'Pause map tour',
    pressed: true,
  }
}
