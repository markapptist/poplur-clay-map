import { describe, expect, it } from 'vitest'
import {
  activeTyping,
  attachmentLabel,
  createClientMessageId,
  isClientMessageId,
  sentMessageStatus,
  validAttachmentMime,
} from '../dmContract'

describe('direct-message contract', () => {
  it('creates a bounded idempotency key for one logical send', () => {
    const id = createClientMessageId(() => '123e4567-e89b-12d3-a456-426614174000')
    expect(id).toBe('msg-123e4567-e89b-12d3-a456-426614174000')
    expect(isClientMessageId(id)).toBe(true)
    expect(isClientMessageId('msg/escape')).toBe(false)
  })

  it('moves a settled outgoing message to read only after the other participant read it', () => {
    expect(sentMessageStatus(1_000, undefined, true)).toBe('sending')
    expect(sentMessageStatus(1_000, 999, false)).toBe('sent')
    expect(sentMessageStatus(1_000, 1_000, false)).toBe('read')
  })

  it('expires abandoned typing state', () => {
    expect(activeTyping(8_000, 10_000)).toBe(true)
    expect(activeTyping(2_000, 10_000)).toBe(false)
  })

  it('keeps attachment labels and MIME families on the shared wire contract', () => {
    expect(attachmentLabel('image')).toBe('Photo')
    expect(attachmentLabel('video')).toBe('Video')
    expect(attachmentLabel('audio')).toBe('Voice message')
    expect(validAttachmentMime('image', 'image/jpeg')).toBe(true)
    expect(validAttachmentMime('audio', 'video/mp4')).toBe(false)
  })
})
