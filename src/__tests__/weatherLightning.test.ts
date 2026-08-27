import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWeatherLightningScheduler } from '../weatherLightning'

describe('weather lightning ambient lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  it('clears the recurring strike timer while ambient rendering sleeps', () => {
    vi.useFakeTimers()
    const onStrike = vi.fn()
    const scheduler = createWeatherLightningScheduler({
      mode: 'storm',
      onStrike,
      random: () => 0,
    })

    scheduler.sync(true)
    expect(vi.getTimerCount()).toBe(1)
    scheduler.sync(false)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(20_000)
    expect(onStrike).not.toHaveBeenCalled()

    scheduler.sync(true)
    vi.advanceTimersByTime(1_800)
    expect(onStrike).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never schedules lightning for a non-storm mode', () => {
    vi.useFakeTimers()
    const scheduler = createWeatherLightningScheduler({
      mode: 'rain',
      onStrike: vi.fn(),
    })
    scheduler.sync(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
