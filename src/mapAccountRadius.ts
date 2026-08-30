/** Sum only the claims that belong to the signed-in account. Map fixtures and
 * other people's territory deliberately never enter this helper. */
export function accountRadiusTotalKm(
  claims: readonly { radiusKm: number | null | undefined }[],
): number {
  return claims.reduce((total, claim) => {
    const radius = Number(claim.radiusKm)
    return total + (Number.isFinite(radius) ? Math.max(0, radius) : 0)
  }, 0)
}
