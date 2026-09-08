import { describe, expect, it } from 'vitest'
import { geographic, mercator, projectWorld, solveProjection, unprojectWorld } from '../nativeMapProjection'

describe('native camera projection', () => {
  it('places and unprojects pins using a pitched native camera at close zoom', () => {
    const origin = mercator([-79.3871, 43.6426])
    const known = [180,35,196,25,260,430,.14,.3,1,...origin,1e-6]
    const worlds: [number,number][] = [[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>[origin[0]+x*1e-6,origin[1]+y*1e-6])
    const solved = solveProjection(worlds.map(world=>({world,screen:projectWorld(known,world)})))!
    const pin: [number,number] = [origin[0]+.7e-6,origin[1]+.3e-6]
    const point = projectWorld(solved,pin)
    const expected = projectWorld(known,pin)
    expect(point[0]).toBeCloseTo(expected[0],7)
    expect(point[1]).toBeCloseTo(expected[1],7)
    const restored = unprojectWorld(solved,point)
    expect(restored[0]).toBeCloseTo(pin[0],12)
    expect(restored[1]).toBeCloseTo(pin[1],12)
  })
  it('rejects degenerate native samples instead of applying a broken transform', () => {
    expect(solveProjection(Array.from({length:4},()=>({world:[0,0] as [number,number],screen:[0,0] as [number,number]})))).toBeNull()
  })
  it('round trips both sides of the date line and the SkyDome location', () => {
    for (const point of [[179.9,60],[-179.9,-60],[-79.38918212,43.64161058]] as [number,number][]) {
      const result = geographic(mercator(point))
      expect(result[0]).toBeCloseTo(point[0],10)
      expect(result[1]).toBeCloseTo(point[1],10)
    }
  })
})
