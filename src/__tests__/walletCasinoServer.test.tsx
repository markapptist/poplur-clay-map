// @vitest-environment happy-dom
// The Wallet and the casino, mounted for real against a stand-in for the
// `poplurCredits` callable: what the screens show is the server's wallet, a
// friend's code and a spin are the server's answers, and nothing moves when
// the server cannot be reached.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../nativeBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../nativeBridge')>(),
  isNativeShell: () => true,
  postNativeEvent: () => true,
}))
vi.mock('../nativeAuth', () => ({
  authToken: () => 'id-token',
  authUid: () => 'uid-1',
  requestAuthToken: () => {},
}))
vi.mock('../pop', () => ({ playPop: () => {} }))
vi.mock('../cubeNavigationSound', () => ({ playCubeNavigationPop: () => {}, markCubeNavigationPop: () => {} }))
vi.mock('../nearbyLocation', () => ({ useNearbyLocation: () => null }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const wallet = (overrides: Record<string, unknown> = {}) => ({
  balance: 55,
  reserved: 0,
  history: [
    { id: 'maproll_uid-1_2026-10-01', type: 'map_daily_roll', amount: 25, note: 'Community chest — daily Map roll', cardId: null, at: 3_000 },
    { id: 'store_abc', type: 'store_card_purchase', amount: 1_200, note: null, cardId: 'swoosh', at: 2_000 },
    { id: 'welcome_uid-1', type: 'welcome_grant', amount: 30, note: 'Welcome to Poplur', cardId: null, at: 1_000 },
  ],
  historyComplete: true,
  cards: ['swoosh'],
  referral: { code: 'ABC234', redeemedCode: null, canRedeem: true, rewardsLeft: 20, credits: 10 },
  worldRadiusUntil: 0,
  today: { mapRoll: '2026-10-01', casino: '2026-10-01' },
  mapRoll: null,
  casino: null,
  serverTime: 5_000,
  ...overrides,
})
const answer = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 })

let fetchMock: ReturnType<typeof vi.fn>
const actions = () => fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).data.action)

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: key => { values.delete(key) },
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })

async function mounted(element: React.ReactElement, check: (container: HTMLDivElement) => Promise<void>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(element))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label)!
const typeInto = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('the Wallet shows the account', () => {
  it('draws the server balance, history and cards, and pays a friend\'s code through the server', async () => {
    const { default: WalletScreen } = await import('../WalletScreen')
    fetchMock
      .mockResolvedValueOnce(answer({ wallet: wallet() }))
      .mockResolvedValueOnce(answer({
        referral: { creditsAdded: 10, referrerPaid: true },
        wallet: wallet({ balance: 65, referral: { code: 'ABC234', redeemedCode: 'XYZ789', canRedeem: false, rewardsLeft: 20, credits: 10 } }),
      }))
    await mounted(<WalletScreen />, async container => {
      expect(actions()).toEqual(['wallet'])
      expect(container.textContent).toContain('55 Credits')
      expect(container.textContent).toContain('$0.55')
      const rows = [...container.querySelectorAll('[class*="entryRow"]')].map(row => row.textContent)
      expect(rows).toEqual([
        'Map rewardCommunity chest — daily Map roll+25',
        'Bought creditsSwoosh Card+1,200',
        'Welcome creditsWelcome to Poplur+30',
      ])
      expect(container.textContent).toContain('Swoosh Card')

      expect(container.textContent).toContain("HAVE A FRIEND'S CODE?")
      const input = container.querySelector('input[placeholder="ABC234"]') as HTMLInputElement
      await act(async () => typeInto(input, 'xyz-789'))
      expect(input.value).toBe('XYZ789')
      await act(async () => button(container, 'Use Code').click())
      await settle()
      expect(actions()).toEqual(['wallet', 'redeemReferral'])
      expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).data.code).toBe('XYZ789')
      expect(container.textContent).toContain('+10 credits. Your friend gets 10 too.')
      expect(container.textContent).toContain('65 Credits')
      expect(container.textContent).not.toContain("HAVE A FRIEND'S CODE?")
    })
  })

  it('says so, rather than inventing a balance, when the server cannot be reached', async () => {
    const { default: WalletScreen } = await import('../WalletScreen')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await mounted(<WalletScreen />, async container => {
      expect(container.textContent).toContain('— Credits')
      expect(container.textContent).toContain('Poplur could not be reached. Check your connection.')
      expect(container.textContent).not.toContain('HAVE A FRIEND')
    })
  })

  it('hides unfinished Buy, Send and Cash Out during the beta without a server mutation', async () => {
    const { default: WalletScreen } = await import('../WalletScreen')
    fetchMock.mockResolvedValueOnce(answer({ wallet: wallet() }))
    await mounted(<WalletScreen />, async container => {
      expect(button(container, 'Buy')).toBeUndefined()
      expect(button(container, 'Send')).toBeUndefined()
      expect(button(container, 'Cash Out')).toBeUndefined()
      expect(container.querySelector('[aria-label="Send credits"]')).toBeNull()
      expect(container.querySelector('[aria-label="Cash out"]')).toBeNull()
      expect(container.textContent).toContain('55 Credits')
      expect(container.textContent).toContain('Swoosh Card')
      expect(actions()).toEqual(['wallet'])
    })
  })
})

describe('the Map die rolls the server\'s face', () => {
  it('asks the server, tumbles to its face, then shows its reward', async () => {
    const { default: MapDailyRewardController } = await import('../MapDailyRewardController')
    const navigator = await import('../radiusRewardNavigator')
    fetchMock.mockResolvedValueOnce(answer({
      roll: { day: '2026-10-01', face: 5, credits: 15, title: 'Territory dividend', alreadyClaimed: false },
      wallet: wallet({ balance: 70, mapRoll: { day: '2026-10-01', face: 5, credits: 15, title: 'Territory dividend' } }),
    }))
    const rolled: number[] = []
    const onRoll = (event: Event) => rolled.push((event as CustomEvent<{ face: number }>).detail.face)
    window.addEventListener(navigator.RADIUS_REWARD_DICE_ROLL_EVENT, onRoll)
    try {
      await mounted(<MapDailyRewardController enabled />, async container => {
        let session = 0
        await act(async () => { session = navigator.announceRadiusRewardNavigator(true).changedAt })
        await act(async () => { navigator.announceRadiusRewardDiceReady(session) })
        await settle()
        expect(actions()).toEqual(['mapRoll'])
        expect(rolled).toEqual([5])
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_200)) })
        expect(container.textContent).toContain('+15 Credits')
        expect(container.textContent).toContain('Territory dividend. Free daily Map roll claimed.')
      })
    } finally {
      window.removeEventListener(navigator.RADIUS_REWARD_DICE_ROLL_EVENT, onRoll)
    }
  })

  it('leaves the die unrolled when the server cannot be reached', async () => {
    const { default: MapDailyRewardController } = await import('../MapDailyRewardController')
    const navigator = await import('../radiusRewardNavigator')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const rolled: number[] = []
    const onRoll = (event: Event) => rolled.push((event as CustomEvent<{ face: number }>).detail.face)
    window.addEventListener(navigator.RADIUS_REWARD_DICE_ROLL_EVENT, onRoll)
    try {
      await mounted(<MapDailyRewardController enabled />, async container => {
        let session = 0
        await act(async () => { session = navigator.announceRadiusRewardNavigator(true).changedAt })
        await act(async () => { navigator.announceRadiusRewardDiceReady(session) })
        await settle()
        expect(rolled).toEqual([])
        expect(container.textContent).toContain('Daily roll unavailable')
      })
    } finally {
      window.removeEventListener(navigator.RADIUS_REWARD_DICE_ROLL_EVENT, onRoll)
    }
  })
})
