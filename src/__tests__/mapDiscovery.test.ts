import { describe, it, expect } from 'vitest'
import { MapRequestGeneration, normalizeDiscoveryPage } from '../mapDiscovery'
const row = {userID:'owner',username:'owner',caption:'Hi',radiusMeters:5000,latitude:43.65,longitude:-79.38,locationVisibility:'approximate'}
describe('bounded map discovery',()=>{
 it('caps and deduplicates data before handing it to the renderer',()=>{
  const p=normalizeDiscoveryPage({schema:1,enabled:true,mode:'posts',posts:Array.from({length:1000},(_,i)=>({id:String(i%190),row,competition:{cellId:'c1.2',status:'local',cohort:'real',score:8}}))},'owner')
  expect(p.pins).toHaveLength(190);expect(p.pins.every(p=>p.mine)).toBe(true)
  expect(p.pins[0].competition?.status).toBe('local')
 })
 it('rejects hidden coordinates and malformed geometry',()=>{
  const p=normalizeDiscoveryPage({schema:1,enabled:true,posts:[{id:'x',row:{...row,ghostMode:true}}],cells:[{id:'bad',bounds:{west:-181,east:1,south:0,north:10}}]},null)
  expect(p.pins).toEqual([]);expect(p.cells).toEqual([])
 })
 it('requires a versioned response and explicit fallback',()=>{
  expect(()=>normalizeDiscoveryPage({enabled:true},null)).toThrow()
  expect(normalizeDiscoveryPage({schema:1,enabled:false,posts:[{id:'x',row}]},null).pins).toEqual([])
 })
 it('discards the previous viewport immediately when motion begins',()=>{
  const requests=new MapRequestGeneration(), first=requests.begin()
  expect(requests.accepts(first.version)).toBe(true)
  requests.cancel()
  expect(first.signal.aborted).toBe(true);expect(requests.accepts(first.version)).toBe(false)
  const second=requests.begin();expect(requests.accepts(second.version)).toBe(true)
  expect(requests.accepts(first.version)).toBe(false)
 })
 it('does not share a previous account request with the next account',()=>{
  const requests=new MapRequestGeneration(), previous=requests.begin(), next=requests.begin()
  expect(previous.signal.aborted).toBe(true)
  expect(requests.accepts(previous.version)).toBe(false)
  expect(requests.accepts(next.version)).toBe(true)
 })
})
