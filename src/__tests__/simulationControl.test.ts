import { afterEach, describe, expect, it } from 'vitest'
import {
  canManageLiveSimulation,
  isLiveSimulationEnabled,
  setLiveSimulationEnabled,
} from '../simulationControl'

afterEach(() => setLiveSimulationEnabled(false))

describe('workbench live simulation control', () => {
  it('starts paused and only enables after an explicit local choice', () => {
    expect(isLiveSimulationEnabled()).toBe(false)
    expect(setLiveSimulationEnabled(true)).toBe(true)
    expect(isLiveSimulationEnabled()).toBe(true)
    expect(setLiveSimulationEnabled(false)).toBe(false)
    expect(isLiveSimulationEnabled()).toBe(false)
  })

  it('shows the workbench control only to the two retained test accounts', () => {
    expect(canManageLiveSimulation('eoP2Z0ElxIa0Eua7xpFxNlr6tur1')).toBe(true)
    expect(canManageLiveSimulation('LiEG6SNtKEZN6eEGeybf0afZnHm1')).toBe(true)
    expect(canManageLiveSimulation('someone-else')).toBe(false)
  })
})
