import type { PendingMapPost } from './cameraStore'
import type { ComposerMedia } from './PostComposer'
import { MESSAGE_MAX } from './newsMessages'

export function messageCardLines(text: string, width = 30): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && Array.from(`${line} ${word}`).length > width) { lines.push(line); line = '' }
      for (const character of Array.from(word)) {
        if (Array.from(line).length >= width) { lines.push(line); line = '' }
        line += character
      }
      line += ' '
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** A written pop has a real shareable preview for the existing media/map pipeline. */
export function renderMessageCard(body: string): ComposerMedia {
  const canvas = document.createElement('canvas')
  canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare your message. Please try again.')
  ctx.fillStyle = '#1a101b'; ctx.fillRect(0, 0, 1080, 1350)
  ctx.fillStyle = '#ff4fa5'; ctx.font = 'bold 42px system-ui'; ctx.fillText('POPLUR · POP MESSAGE', 72, 110)
  const lines = messageCardLines(body.trim().slice(0, MESSAGE_MAX))
  const size = Math.min(54, Math.floor(1040 / Math.max(lines.length, 1) / 1.3))
  ctx.fillStyle = '#fff4f9'; ctx.font = `600 ${size}px system-ui`
  lines.forEach((line, index) => ctx.fillText(line, 72, 220 + index * size * 1.3, 936))
  ctx.fillStyle = '#ff4fa5'; ctx.fillRect(72, 1255, 140, 8)
  return { kind: 'photo', src: canvas.toDataURL('image/jpeg', .9) }
}

export function newsMessageDraft(body: string, attachment: ComposerMedia | null, channelId: string): PendingMapPost {
  const caption = body.trim().slice(0, MESSAGE_MAX)
  if (!caption) throw new Error('Write a message before choosing a map location.')
  return {
    caption, media: attachment ?? renderMessageCard(caption), messageCard: !attachment, newsMessage: true,
    channelId, filterId: 'none', effectId: 'none', usedAI: false,
    photoViewSeconds: null, rightsAttested: false, sceneTerms: [],
  }
}
