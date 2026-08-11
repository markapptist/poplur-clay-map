import { poplurAssetCache } from './PoplurAssetCache'

export interface PlaceCreative {
  image: string
  summary: string | null
  sourceUrl: string
  sourceLabel: string
}

const STORAGE_PREFIX = 'poplur.placeCreative:'

function readStored(query: string): PlaceCreative | null | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + query)
    if (raw == null) return undefined
    if (raw === '') return null
    const parsed = JSON.parse(raw) as PlaceCreative
    return parsed.image?.startsWith('https://') ? parsed : null
  } catch { return undefined }
}

function store(query: string, value: PlaceCreative | null) {
  try { window.localStorage.setItem(STORAGE_PREFIX + query, value ? JSON.stringify(value) : '') } catch { /* cache is optional */ }
}

async function json(url: URL): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'force-cache' })
    if (!response.ok) return null
    return await response.json()
  } finally {
    window.clearTimeout(timer)
  }
}

function concise(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > 240 ? `${clean.slice(0, 237).replace(/\s+\S*$/, '')}...` : clean
}

async function wikipediaCreative(query: string): Promise<PlaceCreative | null> {
  const url = new URL('https://en.wikipedia.org/w/api.php')
  url.search = new URLSearchParams({
    origin: '*', action: 'query', format: 'json', generator: 'search',
    gsrsearch: query, gsrnamespace: '0', gsrlimit: '6',
    prop: 'pageimages|info|extracts', piprop: 'thumbnail', pithumbsize: '1200',
    inprop: 'url', exintro: '1', explaintext: '1', exsentences: '2',
  }).toString()
  const payload = await json(url) as { query?: { pages?: Record<string, {
    title?: string; fullurl?: string; extract?: string; thumbnail?: { source?: string }
  }> } } | null
  const pages = Object.values(payload?.query?.pages ?? {})
  const page = pages.find(item => item.thumbnail?.source?.startsWith('https://') && item.fullurl?.startsWith('https://'))
  if (!page?.thumbnail?.source || !page.fullurl) return null
  return {
    image: page.thumbnail.source,
    summary: concise(page.extract),
    sourceUrl: page.fullurl,
    sourceLabel: `Wikipedia · ${page.title ?? query}`,
  }
}

async function commonsCreative(query: string): Promise<PlaceCreative | null> {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({
    origin: '*', action: 'query', format: 'json', generator: 'search',
    gsrsearch: query, gsrnamespace: '6', gsrlimit: '10',
    prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1200',
  }).toString()
  const payload = await json(url) as { query?: { pages?: Record<string, {
    title?: string; imageinfo?: Array<{ thumburl?: string; url?: string; descriptionurl?: string; mime?: string }>
  }> } } | null
  const pages = Object.values(payload?.query?.pages ?? {})
  for (const page of pages) {
    const info = page.imageinfo?.[0]
    if (!info || !/^image\/(jpeg|png|webp)$/i.test(info.mime ?? '')) continue
    const image = info.thumburl ?? info.url
    if (!image?.startsWith('https://')) continue
    return {
      image,
      summary: null,
      sourceUrl: info.descriptionurl ?? 'https://commons.wikimedia.org/',
      sourceLabel: `Wikimedia Commons · ${(page.title ?? query).replace(/^File:/, '')}`,
    }
  }
  return null
}

/** Grounded creative for a named venue. No app key is shipped: both MediaWiki
 * endpoints are public, CORS-enabled APIs and return source links with each
 * image so the ad can identify where its real-world material came from. */
export async function placeCreative(query: string): Promise<PlaceCreative | null> {
  const key = query.trim().toLowerCase()
  if (!key || typeof window === 'undefined') return null
  const cacheKey = `place-creative:${key}`
  const cached = poplurAssetCache.get<PlaceCreative | null>(cacheKey)
  if (cached !== undefined) return cached
  const stored = readStored(key)
  if (stored !== undefined) {
    poplurAssetCache.set(cacheKey, stored, {
      kind: 'temporary',
      estimatedBytes: stored ? JSON.stringify(stored).length * 2 : 1,
    })
    return stored
  }
  let result: PlaceCreative | null = null
  try { result = await wikipediaCreative(query) } catch { /* try Commons */ }
  if (!result) {
    try { result = await commonsCreative(query) } catch { /* keep channel fallback */ }
  }
  poplurAssetCache.set(cacheKey, result, {
    kind: 'temporary',
    estimatedBytes: result ? JSON.stringify(result).length * 2 : 1,
  })
  store(key, result)
  return result
}
