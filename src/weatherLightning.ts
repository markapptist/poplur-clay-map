import type { WeatherMode } from './WeatherFX'

export interface WeatherLightningScheduler {
  sync(active: boolean): void
  dispose(): void
}

interface WeatherLightningSchedulerOptions {
  mode: WeatherMode
  onStrike: () => void
  random?: () => number
  setTimer?: (callback: () => void, delayMs: number) => number
  clearTimer?: (timer: number) => void
}

/** Sparse lightning timer with an explicit ambient lifecycle. */
export function createWeatherLightningScheduler({
  mode,
  onStrike,
  random = Math.random,
  setTimer = (callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimer = timer => globalThis.clearTimeout(timer),
}: WeatherLightningSchedulerOptions): WeatherLightningScheduler {
  const storm = mode === 'thunder' || mode === 'storm'
  let active = false
  let timer = 0

  const schedule = (first: boolean) => {
    if (!storm || !active || timer) return
    const delay = first
      ? 1800 + random() * 1500
      : 4500 + random() * 5500
    timer = setTimer(strike, delay)
  }
  const strike = () => {
    timer = 0
    if (!active) return
    onStrike()
    schedule(false)
  }

  return {
    sync(nextActive) {
      active = nextActive
      if (!active) {
        clearTimer(timer)
        timer = 0
        return
      }
      schedule(true)
    },
    dispose() {
      active = false
      clearTimer(timer)
      timer = 0
    },
  }
}
