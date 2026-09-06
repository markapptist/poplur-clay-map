import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DM_UNANSWERED_LIMIT,
  canSendIntoThread,
  dmThrottleNotice,
  unansweredRun,
} from '../dmThrottle'

const me = { from: 'me' as const }
const them = { from: 'them' as const }

describe('one person cannot talk at you forever', () => {
  it('counts only the messages sent since the other person last spoke', () => {
    expect(unansweredRun([])).toBe(0)
    expect(unansweredRun([them])).toBe(0)
    expect(unansweredRun([me])).toBe(1)
    expect(unansweredRun([me, me, me])).toBe(3)
    // Their reply ends the run, however long it was.
    expect(unansweredRun([me, me, me, them])).toBe(0)
    expect(unansweredRun([me, me, me, them, me])).toBe(1)
  })

  it('stops a monologue and costs a conversation nothing', () => {
    const monologue = Array.from({ length: DM_UNANSWERED_LIMIT }, () => me)
    expect(canSendIntoThread(monologue.slice(0, -1))).toBe(true)
    expect(canSendIntoThread(monologue)).toBe(false)
    // One word back, and the sender may write again.
    expect(canSendIntoThread([...monologue, them])).toBe(true)
    // Two people talking quickly are never touched.
    const conversation = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? me : them))
    expect(canSendIntoThread(conversation)).toBe(true)
  })

  it('says it is about their reply, not the sender', () => {
    expect(dmThrottleNotice('@citydesk')).toBe('Give @citydesk a chance to reply before sending more.')
    expect(dmThrottleNotice(null)).toBe('Give them a chance to reply before sending more.')
  })

  it('is enforced on the one path every DM leaves by', () => {
    // sendText is the single gate: the composer, stickers, game invites and
    // shared work all go through it, so the limit cannot be walked around by
    // sending a sticker instead of a sentence.
    const mail = readFileSync(new URL('../MailScreen.tsx', import.meta.url), 'utf8')
    expect(mail).toContain('if (!canSendIntoThread(activeThread.messages))')
    expect(mail).toContain('setThrottleNotice(dmThrottleNotice(')
  })
})
