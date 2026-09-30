// @vitest-environment happy-dom
// Credits live on the account (Poplur2025-iOS functions/src/credits.ts). The
// page mirrors the server's wallet and can neither mint nor spend: these pin
// the round trip, the refusals, whose wallet may be shown, and that the pay
// tables the screens print are the ones the server pays.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RADIUS_REWARD_OUTCOMES } from '../radiusRewardRoll'

const auth = vi.hoisted(() => ({ token: 'id-token' as string | null, uid: 'uid-1' as string | null }))
vi.mock('../nativeBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../nativeBridge')>(),
  isNativeShell: () => true,
}))
vi.mock('../nativeAuth', () => ({
  authToken: () => auth.token,
  authUid: () => auth.uid,
  // The shell answers on this event; a signed-out shell answers with nothing.
  requestAuthToken: () => window.dispatchEvent(new CustomEvent('poplur-native-auth-token', { detail: {} })),
}))

const ENDPOINT = 'https://us-central1-poplur2025.cloudfunctions.net/poplurCredits'

const serverWallet = (overrides: Record<string, unknown> = {}) => ({
  balance: 55,
  reserved: 0,
  history: [
    { id: 'maproll_uid-1_2026-10-01', type: 'map_daily_roll', amount: 25, note: 'Community chest — daily Map roll', cardId: null, at: 2_000 },
    { id: 'store_abc', type: 'store_card_purchase', amount: 1_200, note: null, cardId: 'swoosh', at: 1_500 },
    { id: 'welcome_uid-1', type: 'welcome_grant', amount: 30, note: 'Welcome to Poplur', cardId: null, at: 1_000 },
  ],
  historyComplete: true,
  cards: ['swoosh'],
  referral: { code: 'ABC234', redeemedCode: null, canRedeem: true, rewardsLeft: 20, credits: 10 },
  worldRadiusUntil: 0,
  today: { mapRoll: '2026-10-01', casino: '2026-10-01' },
  mapRoll: { day: '2026-10-01', face: 6, credits: 25, title: 'Community chest' },
  casino: null,
  serverTime: 5_000,
  ...overrides,
})

const answer = (result: unknown) =>
  new Response(JSON.stringify({ result }), { status: 200, headers: { 'content-type': 'application/json' } })
const refusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { status: code, message } }), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
const sent = (call = 0) => JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body))

// This environment has no working localStorage; the saved copy needs one.
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
  auth.token = 'id-token'
  auth.uid = 'uid-1'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the page mirrors the account\'s credits', () => {
  it('shows nothing until the server answers, then exactly its wallet', async () => {
    const credits = await import('../poplurCredits')
    expect(credits.creditsWallet()).toBeNull()
    expect(credits.creditBalance()).toBe(0)
    fetchMock.mockResolvedValueOnce(answer({ wallet: serverWallet() }))
    const changed = vi.fn()
    window.addEventListener(credits.CREDITS_CHANGE_EVENT, changed)

    await credits.refreshCredits()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer id-token')
    expect(sent()).toEqual({ data: { action: 'wallet' } })
    expect(changed).toHaveBeenCalledOnce()
    expect(credits.creditBalance()).toBe(55)
    expect(credits.creditHistory().map(entry => [entry.kind, entry.delta])).toEqual([
      ['map_daily_roll', 25], ['store_card_purchase', 1_200], ['welcome_grant', 30],
    ])
    expect(credits.creditHistory()[1].cardId).toBe('swoosh')
    expect(credits.creditsWallet()?.cards).toEqual(['swoosh'])
    expect(credits.creditsWallet()?.referral.code).toBe('ABC234')
    expect(credits.canAfford(credits.AVATAR_CUBE_COST)).toBe(true)
    expect(credits.canAfford(56)).toBe(false)
  })

  it('takes the daily roll, the spin and a friend\'s code from the server\'s answers', async () => {
    const credits = await import('../poplurCredits')
    fetchMock
      .mockResolvedValueOnce(answer({
        roll: { day: '2026-10-01', face: 6, credits: 25, title: 'Community chest', alreadyClaimed: false },
        wallet: serverWallet({ balance: 80 }),
      }))
      .mockResolvedValueOnce(answer({
        spin: { day: '2026-10-02', count: 3, symbolId: 'p', amount: 6, doubled: true, line: 'Slots 3× POPLUR · Friday 2× credits', alreadySpun: false },
        wallet: serverWallet({
          balance: 86,
          today: { mapRoll: '2026-10-02', casino: '2026-10-02' },
          casino: { day: '2026-10-02', count: 3, symbolId: 'p', amount: 6, doubled: true, line: 'Slots 3× POPLUR · Friday 2× credits' },
        }),
      }))
      .mockResolvedValueOnce(answer({
        referral: { creditsAdded: 10, referrerPaid: true },
        wallet: serverWallet({ balance: 96, worldRadiusUntil: 5_000 + 86_400_000 }),
      }))

    const roll = await credits.claimDailyMapRoll()
    expect(sent(0)).toEqual({ data: { action: 'mapRoll' } })
    expect(roll).toMatchObject({ face: 6, credits: 25, alreadyClaimed: false })
    expect(credits.creditBalance()).toBe(80)

    const spin = await credits.spinDailyCasino()
    expect(sent(1)).toEqual({ data: { action: 'casinoSpin' } })
    expect(spin).toMatchObject({ count: 3, symbolId: 'p', amount: 6, alreadySpun: false })
    expect(credits.casinoSpunToday()).toBe(true)

    const before = Date.now()
    const redeemed = await credits.redeemReferralCode(' abc234 ')
    expect(sent(2)).toEqual({ data: { action: 'redeemReferral', code: 'ABC234' } })
    expect(redeemed).toEqual({ creditsAdded: 10 })
    expect(credits.creditBalance()).toBe(96)
    // The day of worldwide radius is carried over to this device's clock.
    const until = credits.creditsWallet()!.worldRadiusUntil
    expect(until).toBeGreaterThanOrEqual(before + 86_400_000 - 1_000)
    expect(until).toBeLessThanOrEqual(Date.now() + 86_400_000 + 1_000)
  })

  it('passes a refusal on in the server\'s words and changes nothing', async () => {
    const credits = await import('../poplurCredits')
    fetchMock
      .mockResolvedValueOnce(answer({ wallet: serverWallet() }))
      .mockResolvedValueOnce(refusal(404, 'NOT_FOUND', "That code isn't on Poplur. Check it with your friend."))
    await credits.refreshCredits()
    const attempt = credits.redeemReferralCode('ZZZZZZ')
    await expect(attempt).rejects.toBeInstanceOf(credits.CreditsRefused)
    await expect(attempt).rejects.toThrow("That code isn't on Poplur. Check it with your friend.")
    expect(credits.creditBalance()).toBe(55)
  })

  it('invents nothing offline, when the platform is busy, or signed out', async () => {
    const credits = await import('../poplurCredits')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(credits.refreshCredits()).rejects.toBeInstanceOf(credits.CreditsUnavailable)
    fetchMock.mockResolvedValueOnce(new Response('Rate exceeded.', { status: 429 }))
    await expect(credits.spinDailyCasino()).rejects.toBeInstanceOf(credits.CreditsUnavailable)
    expect(credits.creditsWallet()).toBeNull()

    auth.token = null
    await expect(credits.claimDailyMapRoll()).rejects.toBeInstanceOf(credits.CreditsUnavailable)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never shows one account\'s wallet to another', async () => {
    let credits = await import('../poplurCredits')
    fetchMock.mockResolvedValueOnce(answer({ wallet: serverWallet() }))
    await credits.refreshCredits()
    auth.uid = 'uid-2'
    expect(credits.creditsWallet()).toBeNull()
    expect(credits.creditBalance()).toBe(0)

    // The saved copy paints the next launch for the same account only.
    vi.resetModules()
    credits = await import('../poplurCredits')
    expect(credits.creditsWallet()).toBeNull()
    auth.uid = 'uid-1'
    expect(credits.creditBalance()).toBe(55)
    expect(credits.creditHistory()).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('has no way to grant, spend or move credits on the device', async () => {
    const credits = await import('../poplurCredits')
    for (const name of [
      'grantCredits', 'grantCasinoWin', 'grantDailyMapReward', 'grantReferralCredits',
      'spendCredits', 'refundCredits', 'transferCreditsOut', 'receiveCredits', 'cashOutCredits',
    ]) expect(credits).not.toHaveProperty(name)
    const source = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')
    expect(source('CasinoScreen.tsx')).toContain('await spinDailyCasino()')
    expect(source('CasinoScreen.tsx')).not.toMatch(/rollOutcome|grantCasinoWin|isDoubleCreditDay/)
    expect(source('SettingsScreen.tsx')).not.toMatch(/grantReferralCredits|grantWorldRadius/)
    expect(source('WalletScreen.tsx')).not.toMatch(/transferCreditsOut|cashOutCredits|walletSendCredits|walletCashOut/)
    expect(source('AvatarScreen.tsx')).not.toMatch(/spendCredits|refundCredits/)
  })
})

describe('the invite', () => {
  it('links to poplur.ca, where the beta starts, with the code', async () => {
    const { referralLink } = await import('../referral')
    // poplur.com does not resolve; every invite sent before 30 Sep was a dead link.
    expect(referralLink('ABC234')).toBe('https://www.poplur.ca/?ref=ABC234')
  })
})

describe('the screens print what the server pays', () => {
  // Vitest runs from the clay-map root; the functions live in the iOS repo beside it.
  const server = readFileSync(resolve(process.cwd(), '../Poplur2025-iOS/functions/src/credits.ts'), 'utf8')
  const casino = readFileSync(resolve(process.cwd(), 'src/CasinoScreen.tsx'), 'utf8')
  const meshy = readFileSync(resolve(process.cwd(), '../Poplur2025-iOS/functions/src/meshyModels.ts'), 'utf8')

  it('the reels\' pay table is the server\'s', () => {
    const table = casino.slice(casino.indexOf('const SYMBOLS: SlotSymbol[] = ['), casino.indexOf('const WILD'))
    const drawn = [...table.matchAll(/\{ id: '([^']+)', name: '([^']+)',[^}]*?pays: \[(\d+), (\d+), (\d+)\] \}/g)]
      .map(match => match.slice(1).join(' '))
    const paid = [...server.matchAll(/\{ id: "([^"]+)", name: "([^"]+)", pays: \[(\d+), (\d+), (\d+)\] \}/g)]
      .map(match => match.slice(1).join(' '))
    expect(drawn).toHaveLength(10)
    expect(paid).toEqual(drawn)
  })

  it('the die\'s faces are the server\'s', () => {
    const paid = [...server.matchAll(/\{ face: (\d), title: "([^"]+)", credits: (\d+) \}/g)]
      .map(([, face, title, credits]) => ({ face: Number(face), title, credits: Number(credits) }))
    expect(paid).toEqual(RADIUS_REWARD_OUTCOMES.map(({ face, title, credits }) => ({ face, title, credits })))
  })

  it('the referral reward and the cube price are the server\'s', async () => {
    const credits = await import('../poplurCredits')
    expect(server).toContain(`export const REFERRAL_CREDITS = ${credits.REFERRAL_CREDIT_REWARD};`)
    expect(meshy).toContain(`const GENERATION_COST = ${credits.AVATAR_CUBE_COST};`)
  })
})
