/** Ground-plane homography from the native renderer's own projected samples.
 * This keeps the existing DOM pins aligned without starting a WebGL context or
 * approximating the native camera's field of view and padding. */
export type XY = [number, number]
export type ProjectionSample = { world: XY; screen: XY }
export const mercator = ([lng, lat]: XY): XY => [
  (lng + 180) / 360,
  (1 - Math.log(Math.tan(Math.PI / 4 + Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 360)) / Math.PI) / 2,
]
export const geographic = ([x, y]: XY): XY => [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI]

export function solveProjection(samples: ProjectionSample[]): number[] | null {
  if (samples.length !== 4) return null
  // Work relative to the first world sample to avoid precision loss at high
  // zoom where adjacent points differ by only a few millionths of a world.
  const [ox, oy] = samples[0].world
  const scale = Math.max(...samples.map(s => Math.hypot(s.world[0] - ox, s.world[1] - oy)))
  if (!Number.isFinite(scale) || scale < 1e-12) return null
  const rows = samples.flatMap(({ world, screen: [u, v] }) => {
    const x = (world[0] - ox) / scale, y = (world[1] - oy) / scale
    return [[x,y,1,0,0,0,-u*x,-u*y,u], [0,0,0,x,y,1,-v*x,-v*y,v]]
  })
  for (let c = 0; c < 8; c++) {
    let pivot = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r
    if (Math.abs(rows[pivot][c]) < 1e-10) return null
    ;[rows[c], rows[pivot]] = [rows[pivot], rows[c]]
    const div = rows[c][c]
    for (let k = c; k < 9; k++) rows[c][k] /= div
    for (let r = 0; r < 8; r++) if (r !== c) {
      const factor = rows[r][c]
      for (let k = c; k < 9; k++) rows[r][k] -= factor * rows[c][k]
    }
  }
  return [...rows.map(row => row[8]), 1, ox, oy, scale]
}

export function projectWorld(matrix: number[], world: XY): XY {
  const x = (world[0] - matrix[9]) / matrix[11], y = (world[1] - matrix[10]) / matrix[11]
  const w = matrix[6] * x + matrix[7] * y + 1
  return [(matrix[0]*x + matrix[1]*y + matrix[2])/w, (matrix[3]*x + matrix[4]*y + matrix[5])/w]
}

export function unprojectWorld(m: number[], [u, v]: XY): XY {
  const a = m[0] - u*m[6], b = m[1] - u*m[7], c = u - m[2]
  const d = m[3] - v*m[6], e = m[4] - v*m[7], f = v - m[5]
  const det = a*e - b*d
  return [((c*e-b*f)/det)*m[11]+m[9], ((a*f-c*d)/det)*m[11]+m[10]]
}
