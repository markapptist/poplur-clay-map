import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHONE_THEME,
  PHONE_THEMES,
  PHONE_THEME_STORAGE_KEY,
  cyclePhoneTheme,
  phoneThemeForId,
  readSelectedPhoneTheme,
  saveSelectedPhoneTheme,
  type PhoneThemeStorage,
} from '../phoneThemes'

function memoryStorage(initial?: Record<string, string>): PhoneThemeStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('persistent Poplur Phone themes', () => {
  it('falls back safely when a saved theme id is absent or obsolete', () => {
    const storage = memoryStorage({ [PHONE_THEME_STORAGE_KEY]: 'retired-finish' })
    expect(readSelectedPhoneTheme(storage)).toBe(DEFAULT_PHONE_THEME)
    expect(phoneThemeForId(null)).toBe(DEFAULT_PHONE_THEME)
  })

  it('cycles in both directions and wraps the complete finish collection', () => {
    const finalTheme = PHONE_THEMES[PHONE_THEMES.length - 1]
    expect(cyclePhoneTheme('silver', -1).id).toBe(finalTheme.id)
    expect(cyclePhoneTheme(finalTheme.id, 1).id).toBe('silver')
    expect(cyclePhoneTheme('ruby', 1).id).toBe('blue')
    expect(cyclePhoneTheme('ruby', -1).id).toBe('rose')
  })

  it('persists a stable id that a newly mounted Phone can restore', () => {
    const storage = memoryStorage()
    const chosen = saveSelectedPhoneTheme('blue', storage)

    expect(chosen.name).toBe('Blue')
    expect(storage.values.get(PHONE_THEME_STORAGE_KEY)).toBe('blue')
    expect(readSelectedPhoneTheme(storage)).toEqual(chosen)
  })

  it('never persists an unknown id', () => {
    const storage = memoryStorage()
    saveSelectedPhoneTheme('not-a-real-theme', storage)
    expect(storage.values.get(PHONE_THEME_STORAGE_KEY)).toBe(DEFAULT_PHONE_THEME.id)
  })
})
