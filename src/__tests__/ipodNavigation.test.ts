import { describe, expect, it } from 'vitest'
import {
  IPOD_PODCASTS_CUBE_MODEL,
  ipodNavigatorOverride,
  ipodSectionForFrame,
} from '../ipodNavigation'

describe('iPod Podcasts navigation', () => {
  it('maps only the Podcasts frame to the Podcasts section', () => {
    expect(ipodSectionForFrame('podcasts')).toBe('podcasts')
    expect(ipodSectionForFrame('root')).toBe('root')
    expect(ipodSectionForFrame('some-other-frame')).toBe('root')
    expect(ipodSectionForFrame('nowplaying')).toBe('root')
  })

  it('lends only the Podcasts section the folder navigator', () => {
    expect(IPOD_PODCASTS_CUBE_MODEL).toBe('poplur_cube_folder.glb')
    expect(ipodNavigatorOverride('podcasts')).toBe(IPOD_PODCASTS_CUBE_MODEL)
    expect(ipodNavigatorOverride('root')).toBeUndefined()
    expect(ipodNavigatorOverride(null)).toBeUndefined()
  })
})
