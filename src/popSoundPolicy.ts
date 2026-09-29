/** Which app events may make the house pop. Notifications use their own settings. */
export type PopSoundEvent = 'notification' | 'action' | 'navigation' | 'refresh' | 'wheel' | 'decoration' | 'radius' | 'ambient'

const enabled: Readonly<Record<PopSoundEvent, boolean>> = Object.freeze({
  notification: true,
  action: true,
  navigation: true,
  refresh: true,
  wheel: false,
  decoration: false,
  radius: false,
  ambient: false,
})

export function shouldPlayPop(event: PopSoundEvent): boolean {
  return enabled[event]
}
