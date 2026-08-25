export type DMDeliveryStatus = 'sending' | 'sent' | 'read' | 'failed'
export type DMAttachmentKind = 'image' | 'video' | 'audio'

const MESSAGE_ID = /^msg-[a-zA-Z0-9-]{16,96}$/

export function createClientMessageId(randomUUID?: () => string): string {
  const uuid = randomUUID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`
  return `msg-${uuid.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 96)}`
}

export function isClientMessageId(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_ID.test(value)
}

export function sentMessageStatus(
  createdAtMillis: number,
  otherReadAtMillis: number | undefined,
  pending: boolean,
): DMDeliveryStatus {
  if (pending) return 'sending'
  if (otherReadAtMillis != null && createdAtMillis > 0 && otherReadAtMillis >= createdAtMillis) {
    return 'read'
  }
  return 'sent'
}

export function activeTyping(typingAtMillis: number | undefined, now = Date.now()): boolean {
  return typingAtMillis != null
    && Number.isFinite(typingAtMillis)
    && typingAtMillis <= now + 1_000
    && now - typingAtMillis < 6_000
}

export function attachmentLabel(kind: DMAttachmentKind): string {
  if (kind === 'image') return 'Photo'
  if (kind === 'video') return 'Video'
  return 'Voice message'
}

export function validAttachmentMime(kind: DMAttachmentKind, mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase()
  return normalized.startsWith(`${kind === 'image' ? 'image' : kind}/`)
}
