/**
 * The Camera tab has capture modes and deliberate creation destinations, but
 * no LIVE broadcast destination and no direct Music-capture page. Music still
 * belongs inside Studio; it is not a separate Camera screen. Keeping the
 * inventory outside the rendering components makes those removals testable
 * product rules instead of comments that can quietly regress in either the
 * hold wheel or channel-arrow ring.
 */
export const CAMERA_HOLD_MENU_ITEMS = [
  { icon: 'Photo', title: 'PHOTO', screen: 'camera-capture', action: 'photo' },
  { icon: 'Video', title: 'VIDEO', screen: 'camera-capture', action: 'video' },
  { icon: 'Create', title: 'CREATE', screen: 'camera-ai-chat', nativeAction: 'create', native: true },
  { icon: 'Games', title: 'GAMES', screen: 'feed-games', native: true },
  { icon: 'Studio', title: 'STUDIO', screen: 'camera-studio', native: true },
  // A PAGE, not an `action`. The old ROLL tile carried action: 'roll', and an
  // action tile is handled before the page path in HoldMenuTwin — it fires,
  // closes the menu and returns, so it could only page the camera's pager. The
  // roll now owns a screen so it can carry selection, deletion and preview.
  { icon: 'CameraRoll', title: 'CAMERA ROLL', screen: 'camera-roll', native: true },
] as const

export const CAMERA_CYCLE = ['photo', 'video', 'create', 'games', 'studio'] as const
export type CameraCycleStop = (typeof CAMERA_CYCLE)[number]

export const CAMERA_CYCLE_SCREEN = {
  create: 'camera-ai-chat',
  games: 'feed-games',
  studio: 'camera-studio',
} as const

export const CAMERA_STOP_BY_SCREEN: Readonly<Record<string, Exclude<CameraCycleStop, 'photo' | 'video'>>> = {
  'camera-ai-chat': 'create',
  'feed-games': 'games',
  'camera-studio': 'studio',
}
