// ── One person cannot talk at you forever ────────────────────────────────────
//
// A thread is a conversation, not a megaphone. Without a limit, one account can
// send as many messages as it likes to somebody who has never answered — which
// is what the owner's own inbox showed on 6 Sep 2026: four identical openers
// from one tester over sixteen hours, into a thread with no reply in it.
//
// The rule is deliberately about UNANSWERED messages rather than a rate. A
// rate limit still lets a determined sender fill an inbox, just more slowly,
// and it punishes two people talking quickly to each other — the thing a
// messenger is for. A streak that only resets when the other person speaks
// costs a real conversation nothing and stops a monologue dead.
//
// Nothing here is a block or a report: those are the safety tools, and they
// live on the profile. This is the ordinary courtesy the product should not
// need to be asked for.

/** Consecutive unanswered messages one account may send into a thread. */
export const DM_UNANSWERED_LIMIT = 5

export interface DMThrottleMessage {
  /** 'me' is the viewer; anything else is the other party. */
  from: 'me' | 'them'
}

/**
 * How many messages the viewer has sent since the other person last spoke.
 * Counts from the end, and stops at their most recent message.
 */
export function unansweredRun(messages: readonly DMThrottleMessage[]): number {
  let run = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from !== 'me') break
    run += 1
  }
  return run
}

/** Whether the viewer may send another message into this thread. */
export function canSendIntoThread(
  messages: readonly DMThrottleMessage[],
  limit = DM_UNANSWERED_LIMIT,
): boolean {
  return unansweredRun(messages) < limit
}

/**
 * What to tell someone who has hit it. Names the person where we know them, so
 * it reads as "they have not answered yet" rather than "you are being
 * punished" — the limit is about the other person's inbox, not the sender's
 * conduct.
 */
export function dmThrottleNotice(handle?: string | null): string {
  const who = handle?.trim().replace(/^@/, '')
  return who
    ? `Give @${who} a chance to reply before sending more.`
    : 'Give them a chance to reply before sending more.'
}
