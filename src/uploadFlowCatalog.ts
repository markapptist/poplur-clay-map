export type UploadFlowId = 'camera' | 'map'
export type UploadMediaKind = 'photo' | 'video'

export type UploadReviewScreenId =
  | 'location'
  | 'capture'
  | 'edit'
  | 'effects'
  | 'finish'
  | 'publish'
  | 'uploading'
  | 'posted'

export interface UploadReviewScreen {
  id: UploadReviewScreenId
  label: string
  note: string
}

export const UPLOAD_REVIEW_FLOWS: Record<UploadFlowId, readonly UploadReviewScreen[]> = {
  camera: [
    { id: 'capture', label: 'Capture', note: 'Take a photo or record a video' },
    { id: 'edit', label: 'Review & edit', note: 'Keep the capture, apply filters, or open video tools' },
    { id: 'effects', label: 'VFX Studio', note: 'Add timed 3D objects and effects' },
    { id: 'finish', label: 'Finish creation', note: 'Use this edit or create with Poplur AI' },
    { id: 'location', label: 'Choose location', note: 'Place the pop and set its claim radius' },
    { id: 'publish', label: 'Review & post', note: 'Confirm caption, channel, rights, and location' },
    { id: 'uploading', label: 'Uploading', note: 'Transfer the finished pop' },
    { id: 'posted', label: 'Posted', note: 'Confirm success and return to Camera' },
  ],
  map: [
    { id: 'location', label: 'Choose location', note: 'Place the pop and set its claim radius' },
    { id: 'capture', label: 'Capture', note: 'Take a photo or video with the spot retained' },
    { id: 'edit', label: 'Review & edit', note: 'Keep the capture, apply filters, or open video tools' },
    { id: 'effects', label: 'VFX Studio', note: 'Add timed 3D objects and effects' },
    { id: 'finish', label: 'Finish creation', note: 'Use this edit or create with Poplur AI' },
    { id: 'publish', label: 'Review & post', note: 'Confirm caption, channel, rights, and location' },
    { id: 'uploading', label: 'Uploading', note: 'Transfer the finished pop' },
    { id: 'posted', label: 'Posted', note: 'Confirm success and return to Map' },
  ],
}

/** Old review links remain useful in notes and screenshots, but now resolve to
 * the single canonical stage they were previewing instead of recreating a
 * duplicate step in the sidebar. */
const LEGACY_SCREEN_ALIASES: Record<string, UploadReviewScreenId> = {
  confirm: 'edit',
  video: 'edit',
  choice: 'finish',
  ai: 'finish',
  channel: 'publish',
  'channel-ready': 'publish',
  'location-return': 'location',
}

export function screensForUploadFlow(flow: UploadFlowId): readonly UploadReviewScreen[] {
  return UPLOAD_REVIEW_FLOWS[flow]
}

export function resolveUploadReviewRoute(search: string): {
  flow: UploadFlowId
  screen: UploadReviewScreenId
  media: UploadMediaKind
} {
  const params = new URLSearchParams(search)
  const flow: UploadFlowId = params.get('flow') === 'map' ? 'map' : 'camera'
  const rawScreen = params.get('screen') ?? ''
  const aliasedScreen = LEGACY_SCREEN_ALIASES[rawScreen] ?? rawScreen
  const screens = screensForUploadFlow(flow)
  const screen = screens.some(item => item.id === aliasedScreen)
    ? aliasedScreen as UploadReviewScreenId
    : screens[0].id
  const media: UploadMediaKind = params.get('media') === 'video' || rawScreen === 'video'
    ? 'video'
    : 'photo'
  return { flow, screen, media }
}
