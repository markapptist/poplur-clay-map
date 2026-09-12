// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFS, prefsFromResponse, readNotificationPrefs, writeNotificationPref,
} from '../notificationPrefs'

vi.mock('../nativeBridge', () => ({ isNativeShell: () => true }))
vi.mock('../nativeAuth', () => ({ authToken: () => 'test-token', requestAuthToken: vi.fn() }))

let fetchMock: ReturnType<typeof vi.fn>
const reply = (prefs: unknown) => Promise.resolve({ ok: true, json: async () => ({ result: { prefs } }) })
const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body).data

beforeEach(() => { fetchMock = vi.fn(() => reply(DEFAULT_NOTIFICATION_PREFS)); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('notification preferences', () => {
  it('reads with an empty payload — a read must never write', async () => {
    await readNotificationPrefs()
    expect(sent()).toEqual({})
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer test-token')
  })
  it('sends only the switch that changed, so the others are not resent', async () => {
    await writeNotificationPref({ engagement: 'off' })
    expect(sent()).toEqual({ set: { engagement: 'off' } })
  })
  it('takes the server answer as the truth, not the value it asked for', async () => {
    // The server refused the change and answered with what it actually holds.
    fetchMock.mockImplementationOnce(() => reply({ ...DEFAULT_NOTIFICATION_PREFS, engagement: 'every' }))
    await expect(writeNotificationPref({ engagement: 'off' })).resolves.toEqual(DEFAULT_NOTIFICATION_PREFS)
  })
  it('reads a malformed answer one switch at a time', () => {
    expect(prefsFromResponse({ prefs: { messages: 'nonsense', engagement: 'off' } }))
      .toEqual({ messages: true, engagement: 'off', radius: 'daily' })
    // Absent means permissive, matching the server.
    expect(prefsFromResponse({ prefs: {} })).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })
  it('reports unknown rather than guessing when there is no answer at all', () => {
    expect(prefsFromResponse(null)).toBeNull()
    expect(prefsFromResponse({})).toBeNull()
  })
  it('surfaces a refusal instead of silently reporting success', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }))
    await expect(readNotificationPrefs()).rejects.toThrow(/unavailable/i)
  })
})
