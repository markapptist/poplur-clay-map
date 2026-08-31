export type NewsEngagementAction = 'reply' | 'repop'

export interface NewsEngagementDeliveryFailure {
  delivered: false
  code: 'delivery-unavailable'
  action: NewsEngagementAction
  entryId: string
  title: string
  detail: string
}

/**
 * News entries currently have no durable reply/repop target. The existing
 * post-engagement endpoint records a comment counter but accepts no body, and
 * the native share bridge opens a share sheet rather than creating a repop.
 * Keep this boundary explicit so the UI cannot mistake a local cache write for
 * multi-device delivery while a real service contract is still absent.
 */
export function newsEngagementDeliveryFailure(
  action: NewsEngagementAction,
  entryId: string,
): NewsEngagementDeliveryFailure {
  return {
    delivered: false,
    code: 'delivery-unavailable',
    action,
    entryId,
    title: action === 'reply' ? 'Reply not posted' : 'Repop not posted',
    detail: 'No delivery route is available. Nothing was posted.',
  }
}

const INTERACTIVE_ENTRY_TARGET = [
  'button',
  'a',
  'figure',
  'form',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
].join(', ')

type ClosestTarget = EventTarget & {
  closest?: (selector: string) => unknown
}

export interface NewsEntryKeyboardEvent {
  key: string
  target: EventTarget | null
  currentTarget: EventTarget | null
  preventDefault: () => void
}

/**
 * Make an article keyboard-activatable without stealing Space/Enter from a
 * nested form control. Returning false means the event remains untouched, so
 * Space can be typed and Enter can perform the form's native submit.
 */
export function handleNewsEntryKey(
  event: NewsEntryKeyboardEvent,
  openStory: () => void,
): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') return false

  const target = event.target as ClosestTarget | null
  if (
    target
    && target !== event.currentTarget
    && typeof target.closest === 'function'
    && target.closest(INTERACTIVE_ENTRY_TARGET)
  ) {
    return false
  }

  event.preventDefault()
  openStory()
  return true
}
