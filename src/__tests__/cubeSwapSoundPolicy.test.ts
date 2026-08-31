import { describe, expect, it } from 'vitest'
import {
  createCubeNavigationSoundClaimTracker,
  cubeSwapShouldPlaySound,
  pendingCubeSwapSound,
} from '../cubeSwapSoundPolicy'

describe('cube swap sound policy', () => {
  it('keeps each navigation claim one-shot and re-arms with a new version', () => {
    const tracker = createCubeNavigationSoundClaimTracker()
    expect(tracker.claimed()).toBe(false)
    expect(tracker.claim()).toBe(1)
    expect(tracker.claimed()).toBe(true)
    expect(tracker.consume()).toBe(true)
    expect(tracker.consume()).toBe(false)
    expect(tracker.claim()).toBe(2)
    expect(tracker.consume()).toBe(true)
  })

  it('leaves an unowned horizontal screen lifecycle change with exactly one model-swap pop', () => {
    const tracker = createCubeNavigationSoundClaimTracker()
    let pops = 0

    // A horizontal cube swipe changes the visible subscreen without playing an
    // immediate navigation sound. Its lifecycle report must not claim sound.
    expect(tracker.screenChanged()).toBeNull()
    if (cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'profile',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
      navigationSoundClaimed: tracker.consume(),
    })) pops += 1

    expect(pops).toBe(1)
  })

  it('keeps immediate screen navigation at one pop when its lifecycle report causes the swap', () => {
    const tracker = createCubeNavigationSoundClaimTracker()
    let pops = 1 // The channel arrow, tile, close, or back gesture owns this.

    tracker.beginScreenNavigation()
    expect(tracker.screenNavigationPending()).toBe(true)
    expect(tracker.screenChanged()).toBe(2)
    expect(tracker.screenNavigationPending()).toBe(false)
    if (cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'profile',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
      navigationSoundClaimed: tracker.consume(),
    })) pops += 1

    expect(pops).toBe(1)
  })

  it('renews a pending screen-navigation claim after an intermediate render consumes it', () => {
    const tracker = createCubeNavigationSoundClaimTracker()
    let pops = 1 // Home's persistent cube back already sounded immediately.

    expect(tracker.beginScreenNavigation()).toBe(1)
    expect(tracker.consume()).toBe(true)
    expect(tracker.claimed()).toBe(false)
    expect(tracker.screenChanged()).toBe(2)
    const delayedModelClaim = tracker.consume()
    expect(delayedModelClaim).toBe(true)
    if (cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'profile',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
      navigationSoundClaimed: delayedModelClaim,
    })) pops += 1
    expect(pops).toBe(1)
  })

  it('keeps a claimed target silent across the exit-phase rerender', () => {
    const target = '/models/profile-mail.glb'
    const firstRender = {
      model: target,
      withSound: pendingCubeSwapSound(null, target, false),
    }

    // setCubeSwapPhase('exit') necessarily renders again after the one-shot
    // claim was consumed. The ordinary policy is audible on that render, but
    // it must not overwrite the in-flight target's captured ownership.
    expect(pendingCubeSwapSound(firstRender, target, true)).toBe(false)
    expect(pendingCubeSwapSound(firstRender, '/models/profile-store.glb', true)).toBe(true)
    expect(pendingCubeSwapSound({ model: target, withSound: true }, target, false)).toBe(false)
  })

  it('can cancel an armed navigation when a route declines the screen change', () => {
    const tracker = createCubeNavigationSoundClaimTracker()

    tracker.beginScreenNavigation()
    tracker.cancelScreenNavigation()
    expect(tracker.screenNavigationPending()).toBe(false)
    expect(tracker.consume()).toBe(false)
    expect(tracker.screenChanged()).toBeNull()
  })

  it('does not let a stale same-model claim steal a later horizontal tab pop', () => {
    const tracker = createCubeNavigationSoundClaimTracker()
    tracker.beginScreenNavigation()
    // The initiating render kept the same model and consumed its transient
    // claim. A later horizontal gesture explicitly cancels the unmatched
    // lifecycle ownership before its own unowned model swap.
    expect(tracker.consume()).toBe(true)
    tracker.cancelScreenNavigation()
    expect(tracker.screenChanged()).toBeNull()
    expect(cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'feed',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
      navigationSoundClaimed: tracker.consume(),
    })).toBe(true)
  })

  it('keeps the normal pop for every ordinary non-wheel model swap', () => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'feed',
      previousEventSignal: 'none',
      nextEventSignal: 'music',
    })).toBe(true)
  })

  it('does not add a model-swap pop when navigation already owns the sound', () => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'profile',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
      navigationSoundClaimed: true,
    })).toBe(false)
  })

  it.each([
    ['airport:pearson', 'none'],
    ['airport:pearson', 'map-hover:land:globe'],
    ['country:1720000000000', 'map-hover:water:globe'],
    ['map-news:active:parade', 'none'],
    ['map-reward:dice:1720000000000', 'map-hover:land:globe'],
    ['map-reward:dice:1720000000000', 'none'],
    ['snow', 'none'],
    ['map-hover:water:boat', 'map-hover:water:globe'],
  ])('pops a Map return from %s to %s even while the wheel is focused', (previous, next) => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: true,
      activeTab: 'map',
      previousEventSignal: previous,
      nextEventSignal: next,
    })).toBe(true)
  })

  it('does not add a second sound to an ordinary focused-wheel preview', () => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: true,
      activeTab: 'profile',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
    })).toBe(false)
  })
})
