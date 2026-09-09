/**
 * What counts as a carousel, kept out of PostComposer so it can be tested in
 * node — importing the composer drags the whole component tree (and pop.ts's
 * audio context) into the test runner.
 */
export interface CarouselMedia {
  kind: 'photo' | 'video'
  src: string
  length?: string
}

export const MAX_CAROUSEL_ITEMS = 10

/**
 * Photos only, and at least two, or it is not a carousel. A video is always one
 * post: two clips in a row have no timeline meaning here.
 *
 * `items[0]` IS the cover, and stays the cover even if the caller hands it out
 * of order. Everything downstream depends on that identity — the legacy `data`
 * field on the bridge message, the unchanged Storage path, and the document's
 * mediaURL that an old client reads to render a perfectly ordinary post.
 */
export function carouselSlides<T extends CarouselMedia>(
  media: T,
  items?: readonly T[],
): readonly T[] {
  if (!items || items.length < 2) return [media]
  if (!items.every(item => item.kind === 'photo')) return [media]
  const ordered = items[0] === media ? items : [media, ...items.filter(item => item !== media)]
  return ordered.slice(0, MAX_CAROUSEL_ITEMS)
}
