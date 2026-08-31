import { postNativeEvent } from './nativeBridge'
import type { LocalStation } from './mapRadio'

export type RadioShareResult =
  | 'Opening share sheet'
  | 'Station shared'
  | 'Station link copied'
  | 'Share cancelled'
  | 'Share unavailable in this preview'

export interface RadioShareEnvironment {
  postNative?: (message: Record<string, unknown>) => boolean
  share?: (data: ShareData) => Promise<void>
  copy?: (text: string) => Promise<void>
}

export function radioShareText(station: Pick<LocalStation, 'name' | 'url'>): string {
  return `Listen to ${station.name} on Poplur Radio\n${station.url}`
}

async function legacyCopy(text: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  return copied
}

/**
 * Share the station through the real native share sheet when embedded, then
 * Web Share, then a clipboard copy. The returned message is deliberately
 * precise: posting to native only means the share sheet is opening, while a
 * clipboard fallback means the link was copied rather than "shared".
 */
export async function shareRadioStation(
  station: LocalStation,
  environment: RadioShareEnvironment = {},
): Promise<RadioShareResult> {
  const text = radioShareText(station)
  const nativePost = environment.postNative ?? postNativeEvent
  if (nativePost({
    type: 'sharePost',
    channel: 'radio',
    stationId: station.id,
    title: `Listen to ${station.name} on Poplur Radio`,
    user: '',
    // React Native validates and shares `link`; iOS uses the same validated
    // field. Never invent a `/p/radio:…` post route for an external stream.
    link: station.url,
  })) return 'Opening share sheet'

  const webShare = environment.share
    ?? (typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      ? navigator.share.bind(navigator)
      : undefined)
  if (webShare) {
    try {
      await webShare({
        title: station.name,
        text: `Listen to ${station.name} on Poplur Radio`,
        url: station.url,
      })
      return 'Station shared'
    } catch (error) {
      if (typeof DOMException !== 'undefined'
        && error instanceof DOMException
        && error.name === 'AbortError') return 'Share cancelled'
      // A denied/unsupported Web Share call still has a useful clipboard path.
    }
  }

  const copy = environment.copy
    ?? (typeof navigator !== 'undefined' && navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined)
  try {
    if (copy) await copy(text)
    else if (!(await legacyCopy(text))) return 'Share unavailable in this preview'
    return 'Station link copied'
  } catch {
    return 'Share unavailable in this preview'
  }
}
