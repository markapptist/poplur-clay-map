/** Native photo-library surfaces must stay empty until the shell returns real
 * device media. Bundled preview tiles are useful in the browser twin only and
 * must never be presented as if they came from a user's phone. */
export function cameraRollDisplayItems<T>(
  nativeItems: readonly T[] | null,
  browserPreviewItems: readonly T[],
  nativeShell: boolean,
): readonly T[] {
  if (nativeItems) return nativeItems
  return nativeShell ? [] : browserPreviewItems
}
