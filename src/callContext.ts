/**
 * Identifies the Poplur surface that owns an active call's primary controls.
 *
 * `default` preserves the phone/Mail behaviour for every existing caller.
 * House opts into `house`, allowing its in-room controls to replace the global
 * call bar while the House screen is visible without creating a second media
 * or signalling stack.
 */
export type CallContext = 'default' | 'house'

export const DEFAULT_CALL_CONTEXT: CallContext = 'default'

/** Treat all unrecognised wire values as an ordinary Poplur call. */
export function normalizeCallContext(value: unknown): CallContext {
  return value === 'house' ? 'house' : DEFAULT_CALL_CONTEXT
}

/** True only when the currently visible surface owns this call. */
export function callContextIsOwned(
  callContext: CallContext,
  visibleOwner: CallContext | undefined,
): boolean {
  return visibleOwner !== undefined && callContext === visibleOwner
}
