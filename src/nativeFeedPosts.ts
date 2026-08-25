import { isNativeShell, postNativeEvent } from './nativeBridge'

export interface NativeFeedPost {
  id: string
  mediaURL: string
  mediaType: 'photo' | 'video'
  posterURL?: string
  username: string
  caption?: string
  channelId: string
  radiusMeters?: number
  createdAtMillis: number
}

type NativeFeedDetail = { posts?: unknown[] }

let snapshot: NativeFeedPost[] = []
let listening = false
const listeners = new Set<() => void>()

function safeRemoteURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, limit)
  return text || undefined
}

export function normalizeNativeFeedPosts(detail: NativeFeedDetail): NativeFeedPost[] {
  if (!Array.isArray(detail.posts)) return []
  return detail.posts.slice(0, 96).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const id = boundedText(row.id, 128)
    const mediaURL = safeRemoteURL(row.mediaURL)
    if (!id || !mediaURL) return []
    const posterURL = safeRemoteURL(row.posterURL) ?? undefined
    const username = boundedText(row.username, 40) ?? 'Poplur user'
    const channelId = boundedText(row.channelId, 40) ?? 'live'
    const radiusMeters = Number(row.radiusMeters)
    const createdAtMillis = Number(row.createdAtMillis)
    const mediaType: NativeFeedPost['mediaType'] = row.mediaType === 'photo' ? 'photo' : 'video'
    const post: NativeFeedPost = {
      id,
      mediaURL,
      mediaType,
      posterURL,
      username: username.startsWith('@') ? username : `@${username}`,
      caption: boundedText(row.caption, 2_000),
      channelId,
      radiusMeters: Number.isFinite(radiusMeters) ? Math.max(0, radiusMeters) : undefined,
      createdAtMillis: Number.isFinite(createdAtMillis) ? createdAtMillis : 0,
    }
    return [post]
  }).sort((a, b) => b.createdAtMillis - a.createdAtMillis)
}

function receiveNativePosts(event: Event): void {
  snapshot = normalizeNativeFeedPosts(
    (event as CustomEvent<NativeFeedDetail>).detail ?? {},
  )
  listeners.forEach(listener => listener())
}

export function requestNativeFeedPosts(): void {
  if (!isNativeShell()) return
  if (!listening) {
    window.addEventListener('poplur-native-feed-posts', receiveNativePosts)
    listening = true
  }
  postNativeEvent({ type: 'requestFeedPosts' })
}

export function onNativeFeedPosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function nativeFeedPostsSnapshot(): NativeFeedPost[] {
  return snapshot
}
