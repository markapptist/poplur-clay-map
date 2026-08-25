import { isNativeShell, postNativeEvent } from './nativeBridge'

export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000
export const STORY_MAX_RESULTS = 96
export const STORY_REPLY_MAX = 500

export type StoryAudience = 'public' | 'favorites'
export type StorySticker = 'heart' | 'here' | 'live' | 'hype' | 'call'

export interface StoryMusic {
  title: string
  artist?: string
}

export interface StoryPoll {
  question: string
  options: string[]
  counts: number[]
  selectedIndex?: number
}

export interface PoplurStory {
  id: string
  ownerId: string
  username: string
  mediaURL: string
  mediaType: 'photo' | 'video'
  posterURL?: string
  caption?: string
  createdAtMillis: number
  expiresAtMillis: number
  audience: StoryAudience
  isOwner: boolean
  highlighted: boolean
  repliesAllowed: boolean
  mentions: string[]
  music?: StoryMusic
  sticker?: StorySticker
  poll?: StoryPoll
  reaction?: string
}

export interface StorySections {
  today: PoplurStory[]
  highlights: PoplurStory[]
  archive: PoplurStory[]
}

type NativeStoryDetail = { stories?: unknown[] }

let snapshot: PoplurStory[] = []
let listening = false
const listeners = new Set<() => void>()

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, limit)
  return text || undefined
}

function boundedCount(value: unknown): number {
  const count = Number(value)
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.min(1_000_000_000, Math.round(count)))
}

function safeRemoteURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeAudience(value: unknown): StoryAudience {
  return value === 'favorites' ? 'favorites' : 'public'
}

function normalizeSticker(value: unknown): StorySticker | undefined {
  return value === 'heart' || value === 'here' || value === 'live'
    || value === 'hype' || value === 'call'
    ? value
    : undefined
}

function normalizeMentions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const mentions = value.flatMap(item => {
    const handle = boundedText(item, 40)?.replace(/^@/, '').toLowerCase()
    return handle && /^[a-z0-9_.]+$/.test(handle) ? [`@${handle}`] : []
  })
  return [...new Set(mentions)].slice(0, 12)
}

function normalizeMusic(value: unknown): StoryMusic | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const title = boundedText(row.title, 100)
  if (!title) return undefined
  return { title, artist: boundedText(row.artist, 80) }
}

function normalizePoll(value: unknown): StoryPoll | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const question = boundedText(row.question, 160)
  if (!question || !Array.isArray(row.options)) return undefined
  const options = row.options
    .flatMap(option => boundedText(option, 80) ?? [])
    .slice(0, 4)
  if (options.length < 2) return undefined
  const rawCounts = Array.isArray(row.counts) ? row.counts : []
  const counts = options.map((_, index) => boundedCount(rawCounts[index]))
  const selected = Number(row.selectedIndex)
  return {
    question,
    options,
    counts,
    selectedIndex: Number.isInteger(selected) && selected >= 0 && selected < options.length
      ? selected
      : undefined,
  }
}

/**
 * Treat every bridge row as untrusted. Story media is remote, so invalid URLs,
 * impossible clocks, oversized text, and unknown poll/sticker values are
 * rejected before a Story screen can mount them.
 */
export function normalizeNativeStories(
  detail: NativeStoryDetail,
  now = Date.now(),
): PoplurStory[] {
  if (!Array.isArray(detail.stories)) return []
  return detail.stories.slice(0, STORY_MAX_RESULTS).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const id = boundedText(row.id, 128)
    const ownerId = boundedText(row.ownerId ?? row.ownerID ?? row.userID, 128)
    const mediaURL = safeRemoteURL(row.mediaURL)
    const createdAtMillis = Number(row.createdAtMillis)
    const expiresAtMillis = Number(row.expiresAtMillis)
    if (!id || !ownerId || !mediaURL
      || !Number.isFinite(createdAtMillis)
      || !Number.isFinite(expiresAtMillis)
      || expiresAtMillis <= createdAtMillis
      || expiresAtMillis - createdAtMillis > STORY_LIFETIME_MS + 5 * 60_000
      || createdAtMillis > now + 5 * 60_000) return []
    return [{
      id,
      ownerId,
      username: boundedText(row.username, 40) ?? 'Poplur user',
      mediaURL,
      mediaType: row.mediaType === 'video' ? 'video' : 'photo',
      posterURL: safeRemoteURL(row.posterURL) ?? undefined,
      caption: boundedText(row.caption, 2_000),
      createdAtMillis,
      expiresAtMillis,
      audience: normalizeAudience(row.audience),
      isOwner: row.isOwner === true,
      highlighted: row.highlighted === true,
      repliesAllowed: row.repliesAllowed !== false,
      mentions: normalizeMentions(row.mentions),
      music: normalizeMusic(row.music),
      sticker: normalizeSticker(row.sticker),
      poll: normalizePoll(row.poll),
      reaction: boundedText(row.reaction, 16),
    }]
  }).sort((a, b) => b.createdAtMillis - a.createdAtMillis)
}

/** One source row belongs to one section at a time. Highlights remain visible
 * after 24 hours, while Archive is owner-only and contains expired stories
 * whether or not the owner also promoted them to a highlight. */
export function storySections(stories: PoplurStory[], now = Date.now()): StorySections {
  const today = stories.filter(story => story.expiresAtMillis > now)
  const highlights = stories.filter(story => story.highlighted)
  const archive = stories.filter(story => story.isOwner && story.expiresAtMillis <= now)
  return { today, highlights, archive }
}

export function storyMentions(caption: string): string[] {
  const found = caption.match(/(^|\s)@[a-z0-9_.]{1,39}\b/gi) ?? []
  return [...new Set(found.map(value => `@${value.trim().slice(1).toLowerCase()}`))].slice(0, 12)
}

export function validateStoryPublish(value: {
  audience: StoryAudience
  repliesAllowed: boolean
  rightsAttested: boolean
  pollQuestion?: string
  pollOptions?: string[]
}): string | null {
  if (value.audience !== 'public' && value.audience !== 'favorites') {
    return 'Choose who can see this Story.'
  }
  if (typeof value.repliesAllowed !== 'boolean') return 'Choose whether Story replies are allowed.'
  if (!value.rightsAttested) return 'Confirm that you have permission to share this media and music.'
  const question = value.pollQuestion?.trim() ?? ''
  const options = (value.pollOptions ?? []).map(option => option.trim()).filter(Boolean)
  if (question && options.length < 2) return 'A Story poll needs at least two choices.'
  if (!question && options.length) return 'Add a question for this Story poll.'
  return null
}

function receiveNativeStories(event: Event): void {
  snapshot = normalizeNativeStories(
    (event as CustomEvent<NativeStoryDetail>).detail ?? {},
  )
  listeners.forEach(listener => listener())
}

export function requestNativeStories(): void {
  if (!isNativeShell()) return
  if (!listening) {
    window.addEventListener('poplur-native-stories', receiveNativeStories)
    listening = true
  }
  postNativeEvent({ type: 'requestStories' })
}

export function onNativeStories(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function nativeStoriesSnapshot(): PoplurStory[] {
  return snapshot
}

export function reactToStory(storyId: string, reaction: string): boolean {
  return postNativeEvent({ type: 'reactStory', storyId, reaction })
}

export function voteOnStory(storyId: string, optionIndex: number): boolean {
  return postNativeEvent({ type: 'voteStory', storyId, optionIndex })
}

export function replyToStory(storyId: string, ownerId: string, text: string): boolean {
  const reply = text.trim().slice(0, STORY_REPLY_MAX)
  if (!reply) return false
  return postNativeEvent({ type: 'replyStory', storyId, ownerId, text: reply })
}

export function setStoryHighlighted(storyId: string, highlighted: boolean): boolean {
  return postNativeEvent({ type: 'setStoryHighlighted', storyId, highlighted })
}

/** @internal */
export function resetStoriesForTests(): void {
  snapshot = []
}
