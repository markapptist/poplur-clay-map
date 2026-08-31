import { describe, expect, it } from 'vitest'
import { cameraRollDisplayItems } from '../cameraRollPolicy'

describe('cameraRollDisplayItems', () => {
  const previews = ['bundled-preview']

  it('shows no bundled fixtures while a native shell is awaiting device media', () => {
    expect(cameraRollDisplayItems(null, previews, true)).toEqual([])
  })

  it('shows only the real items returned by the native shell', () => {
    expect(cameraRollDisplayItems(['device-photo'], previews, true)).toEqual(['device-photo'])
  })

  it('retains bundled fixtures for the browser twin', () => {
    expect(cameraRollDisplayItems(null, previews, false)).toEqual(previews)
  })
})
