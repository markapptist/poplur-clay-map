import { describe, expect, it } from 'vitest'
import { shouldHidePersistentCube } from '../persistentCubeVisibility'

describe('persistent cube visibility', () => {
  it('keeps the cube reachable over full-screen Hold-menu screens', () => {
    expect(shouldHidePersistentCube({
      feedFullscreen: false,
      nativeFeedAdOpen: false,
      subscreenFullscreen: true,
    })).toBe(false)
  })

  it('only yields to platform-owned interactive takeovers', () => {
    expect(shouldHidePersistentCube({
      feedFullscreen: true,
      nativeFeedAdOpen: false,
      subscreenFullscreen: false,
    })).toBe(true)
    expect(shouldHidePersistentCube({
      feedFullscreen: false,
      nativeFeedAdOpen: true,
      subscreenFullscreen: false,
    })).toBe(true)
  })
})
