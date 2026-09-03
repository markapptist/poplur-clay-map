import { describe, expect, it } from 'vitest'
import { easePose, poseEase, type DrawnPose } from '../faceARLandmarks'

const HALF_LIFE = 90

const pose = (x: number, y = 0): DrawnPose => ({ x, y, w: 100, h: 100, roll: 0, yaw: 0 })

/**
 * The AR accessory is positioned from a tracker that publishes about three
 * times a second. Drawing that pose raw made the accessory teleport in ~350ms
 * hops no matter how many frames were rendered — the thing the user described
 * as the filters being "slow". These are the properties the easing has to hold
 * for that to stay fixed.
 */
describe('AR accessory pose easing', () => {
  it('snaps onto a newly acquired face instead of gliding in from the last one', () => {
    // Null means "no face was drawn last frame". Easing from a stale pose
    // would sail the accessory across the frame from wherever the previous
    // face stood.
    expect(easePose(null, pose(500), 0.3)).toEqual(pose(500))
  })

  it('settles in the same real time whatever the frame rate', () => {
    // THE property. The governor steps this lane between 5 and 20fps, so a
    // fixed per-frame fraction would damp differently at every rate and drift
    // with thermal pressure. Two 8ms frames must land exactly where one 16ms
    // frame lands.
    const twoShort = easePose(easePose(pose(0), pose(100), poseEase(8, HALF_LIFE)), pose(100), poseEase(8, HALF_LIFE))
    const oneLong = easePose(pose(0), pose(100), poseEase(16, HALF_LIFE))
    expect(twoShort.x).toBeCloseTo(oneLong.x, 10)
  })

  it('closes most of a tracker gap within one published pose', () => {
    // At the ambient lane's 15fps a pose lasts ~5 frames before the next
    // arrives. If easing were so slow the accessory never caught up inside
    // that window, it would trade stepping for lag — no better.
    let p = pose(0)
    for (let i = 0; i < 5; i++) p = easePose(p, pose(100), poseEase(1000 / 15, HALF_LIFE))
    expect(p.x).toBeGreaterThan(90)
  })

  it('approaches without overshooting', () => {
    let p = pose(0)
    let last = -1
    for (let i = 0; i < 40; i++) {
      p = easePose(p, pose(100), poseEase(16, HALF_LIFE))
      expect(p.x).toBeGreaterThan(last)
      expect(p.x).toBeLessThanOrEqual(100)
      last = p.x
    }
  })

  it('eases every tracked channel, not just position', () => {
    const was: DrawnPose = { x: 0, y: 0, w: 10, h: 10, roll: 0, yaw: 0 }
    const target: DrawnPose = { x: 10, y: 20, w: 30, h: 40, roll: 0.5, yaw: -0.5 }
    const next = easePose(was, target, 0.5)
    expect(next).toEqual({ x: 5, y: 10, w: 20, h: 25, roll: 0.25, yaw: -0.25 })
  })

  it('snaps rather than dividing by a nonsense interval', () => {
    // A first frame, or a return from a long pause, must not ease by a
    // garbage elapsed time.
    expect(poseEase(0, HALF_LIFE)).toBe(1)
    expect(poseEase(-5, HALF_LIFE)).toBe(1)
    expect(poseEase(Number.NaN, HALF_LIFE)).toBe(1)
    expect(poseEase(16, 0)).toBe(1)
  })
})
