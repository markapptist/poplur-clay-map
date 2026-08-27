export type AvatarOutfitPart = 'top' | 'bottom'

export type AvatarOutfitSelection = {
  gender: 'male' | 'female'
  top: string
  bottom: string
}

export function avatarOutfitSelectionKey(selection: AvatarOutfitSelection): string {
  return `${selection.gender}:${selection.top}:${selection.bottom}`
}

/** Keep readiness for a garment whose body/selection did not change. The
 * runtime intentionally skips an already-loaded request, so clearing both
 * flags for a top-only or bottom-only edit would leave the preview hidden. */
export function retainedOutfitParts(
  previous: AvatarOutfitSelection,
  next: AvatarOutfitSelection,
  loaded: ReadonlySet<AvatarOutfitPart>,
): Set<AvatarOutfitPart> {
  if (previous.gender !== next.gender) return new Set()
  const retained = new Set<AvatarOutfitPart>()
  if (previous.top === next.top && loaded.has('top')) retained.add('top')
  if (previous.bottom === next.bottom && loaded.has('bottom')) retained.add('bottom')
  return retained
}
