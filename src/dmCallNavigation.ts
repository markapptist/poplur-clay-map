import type { CallPhase } from './webCall'

/**
 * Tracks the one transition that matters for a Phone call opened from Mail:
 * the call must have genuinely started before an ended/idle snapshot is
 * allowed to navigate back. `subscribeCall` immediately publishes its current
 * idle snapshot, so navigating on idle alone would bounce out of the handset
 * before the DM call had even begun.
 */
export interface DMPhoneReturnState {
  began: boolean
  returned: boolean
}

export const INITIAL_DM_PHONE_RETURN_STATE: DMPhoneReturnState = {
  began: false,
  returned: false,
}

/** The complete handoff between one saved Mail thread and Phone call mode. */
export interface DMPhoneCallRoute {
  id: string
  name: string
  threadId: string
}

export function createDMPhoneCallRoute(
  id: string,
  name: string,
  threadId: string,
): DMPhoneCallRoute {
  return { id, name, threadId }
}

export function dmPhoneReturnThreadId(route: DMPhoneCallRoute | null): string | null {
  return route?.threadId || null
}

export function advanceDMPhoneReturn(
  state: DMPhoneReturnState,
  phase: CallPhase,
): { state: DMPhoneReturnState; shouldReturn: boolean } {
  if (state.returned) return { state, shouldReturn: false }

  if (phase === 'calling' || phase === 'connecting' || phase === 'connected') {
    return {
      state: state.began ? state : { began: true, returned: false },
      shouldReturn: false,
    }
  }

  if (state.began && (phase === 'ended' || phase === 'idle')) {
    return {
      state: { began: true, returned: true },
      shouldReturn: true,
    }
  }

  return { state, shouldReturn: false }
}

/**
 * Resolves a one-shot Mail return only against a thread list the caller is
 * allowed to trust. Native callers pass `authoritative = false` until their
 * participant-validated snapshot arrives; the browser preview can trust its
 * local seeded list immediately.
 */
export function resolvePendingDMThreadId(
  pendingThreadId: string | undefined,
  availableThreadIds: readonly string[],
  authoritative: boolean,
): string | null {
  if (!authoritative || !pendingThreadId) return null
  return availableThreadIds.includes(pendingThreadId) ? pendingThreadId : null
}

/**
 * A saved DM already carries the authoritative peer id needed to place its
 * call. The radius address book is useful for richer contact details, but an
 * empty or failed address-book response must not prevent that established
 * conversation from dialing.
 */
export function resolveDMAutoCallPeer(
  autoCall: { id: string; name: string },
  contacts: readonly { id: string; handle: string }[],
): { id: string; handle: string; contactIndex: number } {
  const contactIndex = contacts.findIndex(contact =>
    contact.id === autoCall.id || contact.handle === autoCall.name)
  const contact = contactIndex >= 0 ? contacts[contactIndex] : null
  return {
    id: contact?.id ?? autoCall.id,
    handle: contact?.handle ?? autoCall.name,
    contactIndex,
  }
}
