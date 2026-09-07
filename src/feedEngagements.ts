import { track } from './analytics'
import { isNativeShell } from './nativeBridge'
import { authToken, requestAuthToken } from './nativeAuth'

export const POST_ENGAGEMENT_KINDS = ['view', 'like', 'dislike', 'comment'] as const
export type PostEngagementKind = typeof POST_ENGAGEMENT_KINDS[number]

export interface PostEngagementCounters {
  radiusMeters: number
  organicRadiusMeters: number
  viewCount: number
  likeCount: number
  downvoteCount: number
  commentCount: number
}

export interface PostEngagementResult {
  postId: string
  eventId: string
  kind: PostEngagementKind
  applied: boolean
  duplicate: boolean
  radiusDeltaMeters: number
  counters: PostEngagementCounters
}

interface CallableResult<T> {
  result?: T
  error?: { message?: string; status?: string }
}

const FUNCTION_URL = 'https://us-central1-poplur2025.cloudfunctions.net/recordPostEngagement'
const POST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/
const CLIENT_VIEW_MIN_MS = 30_000
const viewAttemptAt = new Map<string, number>()

function canonicalPostId(value: string): string {
  const postId = value.trim().replace(/^firestore:/, '')
  if (!POST_ID_PATTERN.test(postId)) throw new Error('This post cannot receive engagement.')
  return postId
}

function randomSuffix(): string {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { /* older WebKit */ }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

export function createPostEngagementEventId(now = Date.now()): string {
  return `evt_${Math.max(0, Math.round(now)).toString(36)}_${randomSuffix()}`.slice(0, 128)
}

export function postEngagementPayload(
  postIdValue: string,
  kind: PostEngagementKind,
  eventIdValue = createPostEngagementEventId(),
  text?: string,
): { postId: string; eventId: string; kind: PostEngagementKind; text?: string } {
  if (!(POST_ENGAGEMENT_KINDS as readonly string[]).includes(kind)) {
    throw new Error('Unsupported post engagement.')
  }
  const postId = canonicalPostId(postIdValue)
  const eventId = eventIdValue.trim()
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Invalid post engagement event.')
  // Comment text is public content; counters and radius deltas are always
  // derived by the server and cannot enter this payload.
  return { postId, eventId, kind, ...(kind === 'comment' && text ? { text: text.trim().slice(0, 500) } : {}) }
}

async function waitForNativeToken(): Promise<string | null> {
  const current = authToken()
  if (current) return current
  requestAuthToken()
  return new Promise(resolve => {
    const finish = () => {
      window.removeEventListener('poplur-native-auth-token', onToken)
      window.clearTimeout(timeout)
      resolve(authToken())
    }
    const onToken = () => finish()
    const timeout = window.setTimeout(finish, 1_500)
    window.addEventListener('poplur-native-auth-token', onToken, { once: true })
  })
}

async function requestToken(): Promise<string | null> {
  if (isNativeShell()) return waitForNativeToken()
  const firebase = await import('./webFirebase')
  return firebase.webAuth().currentUser?.getIdToken() ?? null
}

async function invokePostEngagement(
  data: ReturnType<typeof postEngagementPayload>,
): Promise<PostEngagementResult> {
  const token = await requestToken()
  if (!token) throw new Error('Sign in to react to this post.')
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data }),
  })
  const body = await response.json().catch(() => ({})) as CallableResult<PostEngagementResult>
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || 'Post engagement is temporarily unavailable.')
  }
  if (!body.result) throw new Error('Post engagement returned no result.')
  return body.result
}

/** One automatic retry uses the exact same event id, so an uncertain network
 * response can never double-increment the parent post. UI callers deliberately
 * do not await this before showing their existing reaction/comment feedback. */
export async function recordPostEngagement(
  postId: string,
  kind: PostEngagementKind,
  eventId = createPostEngagementEventId(),
  text?: string,
): Promise<PostEngagementResult> {
  const payload = postEngagementPayload(postId, kind, eventId, text)
  // Analytics sees the action only, never the post. This is the single funnel
  // for like/dislike/comment on both the Feed and the Profile; a `view` only
  // reaches here through recordVisiblePostView, which owns pop_view.
  // Counted once the server has taken it: an attempt the server refused (not
  // signed in, a 5xx after the retry) is not an engagement.
  let result: PostEngagementResult
  try {
    result = await invokePostEngagement(payload)
  } catch (firstError) {
    try {
      result = await invokePostEngagement(payload)
    } catch {
      throw firstError
    }
  }
  if (kind !== 'view') track('pop_engagement', { action: kind })
  return result
}

/** Media readiness can fire again after WebKit decoder recovery. The server is
 * still authoritative, but this small client fence avoids needless calls; a
 * genuine return after 30 seconds reaches the server as a half-kilometre replay. */
export function recordVisiblePostView(
  postIdValue: string,
  now = Date.now(),
): Promise<PostEngagementResult | null> {
  const postId = canonicalPostId(postIdValue)
  const previous = viewAttemptAt.get(postId)
  if (previous != null && now - previous < CLIENT_VIEW_MIN_MS) return Promise.resolve(null)
  viewAttemptAt.set(postId, now)
  // pop_view shares this 30 s fence, so it counts engagement views the way
  // the server does, not raw impressions. No params: the surface is already
  // the current screen_view, and the post id never crosses.
  track('pop_view')
  return recordPostEngagement(postId, 'view')
}

/** Focused-test reset; production code never clears the view fence. */
export function resetFeedEngagementsForTests(): void {
  viewAttemptAt.clear()
}
