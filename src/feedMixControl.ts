import { useEffect, useState } from 'react'
import { postNativeEvent } from './nativeBridge'

/**
 * How the Feed's demo inventory is blended: branded photo cards, the demo
 * video creatives, and Google ad slots. Three weights that always total 100.
 *
 * This is a TEST control. It shapes demo inventory only — it can never change
 * the order or share of real published posts, which are ranked ahead of all of
 * it and are not part of the mix.
 */

export type FeedMixSource = 'photos' | 'videos' | 'ads'
export const FEED_MIX_SOURCES: readonly FeedMixSource[] = ['photos', 'videos', 'ads']

export type FeedMix = Record<FeedMixSource, number>

const STORAGE_KEY = 'poplur.workbench.feedMix'
export const FEED_MIX_CHANGE_EVENT = 'poplur-feed-mix-change'

/** Video-led, because the demo creatives are the only inventory that is
 *  guaranteed present in the asset pack. */
export const DEFAULT_FEED_MIX: FeedMix = { photos: 40, videos: 50, ads: 10 }

let memoryMix: FeedMix | null = null

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function clampWhole(value: unknown): number {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

/**
 * Force any triple onto an exact total of 100 using largest-remainder, so the
 * displayed percentages always add up and no share is silently lost to
 * rounding. An all-zero input falls back to the default rather than producing
 * a feed with no inventory at all.
 */
export function normalizeFeedMix(input: Partial<FeedMix> | null | undefined): FeedMix {
  const raw = FEED_MIX_SOURCES.map(source => clampWhole(input?.[source]))
  const total = raw.reduce((sum, value) => sum + value, 0)
  if (total === 0) return { ...DEFAULT_FEED_MIX }

  const exact = raw.map(value => (value / total) * 100)
  const floored = exact.map(value => Math.floor(value))
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)

  const out = [...floored]
  for (let step = 0; remainder > 0; step += 1, remainder -= 1) {
    out[order[step % order.length].index] += 1
  }
  return { photos: out[0], videos: out[1], ads: out[2] }
}

/**
 * Move one slider and let the other two absorb the difference in proportion to
 * their current sizes, so dragging one handle never silently zeroes another.
 * When both others are at zero the remainder is split evenly.
 */
export function adjustFeedMix(current: FeedMix, source: FeedMixSource, next: number): FeedMix {
  const target = clampWhole(next)
  const others = FEED_MIX_SOURCES.filter(key => key !== source)
  const remaining = 100 - target
  const otherTotal = others.reduce((sum, key) => sum + current[key], 0)

  const out = { ...current, [source]: target } as FeedMix
  if (otherTotal === 0) {
    others.forEach((key, index) => {
      out[key] = index === 0 ? Math.ceil(remaining / 2) : Math.floor(remaining / 2)
    })
  } else {
    others.forEach(key => { out[key] = (current[key] / otherTotal) * remaining })
  }
  // Re-normalize so the pinned slider keeps the value the user chose.
  const normalized = normalizeFeedMix(out)
  const drift = target - normalized[source]
  if (drift !== 0) {
    normalized[source] = target
    const donor = others.reduce((widest, key) =>
      normalized[key] > normalized[widest] ? key : widest, others[0])
    normalized[donor] = Math.max(0, normalized[donor] + drift)
  }
  return normalizeFeedMix(normalized)
}

export function readFeedMix(): FeedMix {
  if (memoryMix) return memoryMix
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    memoryMix = raw ? normalizeFeedMix(JSON.parse(raw) as Partial<FeedMix>) : { ...DEFAULT_FEED_MIX }
  } catch {
    memoryMix = { ...DEFAULT_FEED_MIX }
  }
  return memoryMix
}

export function writeFeedMix(mix: Partial<FeedMix>): FeedMix {
  const next = normalizeFeedMix(mix)
  memoryMix = next
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* memory keeps it */ }
  try { window.dispatchEvent(new CustomEvent(FEED_MIX_CHANGE_EVENT, { detail: next })) } catch { /* SSR */ }
  publishFeedMixToShell(next)
  return next
}

/**
 * Hand the Google share to the native shell.
 *
 * AdMob is a native SDK, and the shell already owns the placement split in
 * FeedAdProbability.swift (content / poplurAd / googleMobileAd). Without this
 * the panel would be a second, silently diverging source of truth for the same
 * number. Photos and videos are both Poplur creative from the shell's point of
 * view, so they collapse into its poplurAd share.
 *
 * Returns false in the browser workbench, where there is no shell to tell.
 */
export function publishFeedMixToShell(mix: FeedMix): boolean {
  return postNativeEvent({
    type: 'feedAdProbabilityChanged',
    googleMobileAdPercent: mix.ads,
    poplurAdPercent: mix.photos + mix.videos,
  })
}

export function onFeedMixChange(listener: (mix: FeedMix) => void): () => void {
  const apply = () => listener(readFeedMix())
  const invalidate = () => { memoryMix = null; apply() }
  window.addEventListener(FEED_MIX_CHANGE_EVENT, apply)
  window.addEventListener('storage', invalidate)
  return () => {
    window.removeEventListener(FEED_MIX_CHANGE_EVENT, apply)
    window.removeEventListener('storage', invalidate)
  }
}

/**
 * Lay `length` slots out so each source's share tracks its weight AND the
 * sources stay interleaved. Filling by block (all videos, then all photos)
 * technically honours the ratio but reads as three separate feeds, so each
 * slot goes to whichever source is furthest behind its own target — the same
 * error-diffusion idea as Bresenham line drawing.
 */
export function feedMixSequence(mix: FeedMix, length: number): FeedMixSource[] {
  const normalized = normalizeFeedMix(mix)
  const active = FEED_MIX_SOURCES.filter(source => normalized[source] > 0)
  if (length <= 0 || !active.length) return []

  const credit: Record<string, number> = {}
  active.forEach(source => { credit[source] = 0 })

  const out: FeedMixSource[] = []
  for (let slot = 0; slot < length; slot += 1) {
    active.forEach(source => { credit[source] += normalized[source] })
    const winner = active.reduce((best, source) =>
      credit[source] > credit[best] ? source : best, active[0])
    credit[winner] -= 100
    out.push(winner)
  }
  return out
}

/** What the sequence actually achieved, which can differ from the target when
 *  a source has no inventory. The panel shows both so the gap is visible. */
export function feedMixShares(sequence: readonly FeedMixSource[]): FeedMix {
  if (!sequence.length) return { photos: 0, videos: 0, ads: 0 }
  const counts = { photos: 0, videos: 0, ads: 0 } as FeedMix
  sequence.forEach(source => { counts[source] += 1 })
  return normalizeFeedMix(counts)
}

export function useFeedMix(): FeedMix {
  const [mix, setMix] = useState(readFeedMix)
  useEffect(() => onFeedMixChange(setMix), [])
  return mix
}
