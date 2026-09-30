// Poplur credits — the app's spend unit for work that costs Poplur real money
// on someone else's meter (a Meshy cube today; Studio songs and AI compose
// next), plus a few bounded rewards: the Map's daily die, the casino's daily
// spin and referrals.
//
// Radius is EARNED and decays (radiusLedger.ts). Credits are a durable spend
// unit. Radius and Credits must never be confused, so they stay separate
// ledgers with separate words on screen.
//
// The ACCOUNT holds credits, on the server (Poplur2025-iOS
// functions/src/credits.ts, the `poplurCredits` callable). This module is the
// page's window onto that account and nothing more: it never decides an
// amount, never rolls an outcome and never writes a balance. Every server
// answer carries the whole wallet, which replaces what this module shows.
//
// It used to BE the ledger, in localStorage. Clearing storage or moving the
// clock minted credits, none of it reached the account, and the number on
// screen was not the one the server charged a card purchase or a Meshy job
// against.

import { authToken, authUid, requestAuthToken } from './nativeAuth'
import { isNativeShell } from './nativeBridge'

export interface CreditEntry {
  id: string
  /** The server row's type: welcome_grant, store_card_purchase, map_daily_roll,
      casino_daily_spin, referral_reward, meshy_generation, ... */
  kind: string
  /** positive tops up, negative spends */
  delta: number
  note?: string
  /** Set on a card purchase: which Store card it was. */
  cardId?: string
  at: number
}

export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6

export interface MapRollClaim {
  day: string
  face: DiceFace
  credits: number
  title: string
}

export interface CasinoClaim {
  day: string
  /** 0 is a miss; otherwise 3, 4 or 5 of `symbolId` from the left. */
  count: 0 | 3 | 4 | 5
  symbolId: string | null
  amount: number
  doubled: boolean
  line: string
}

export interface ReferralState {
  /** This account's code, assigned by the server. */
  code: string | null
  redeemedCode: string | null
  /** A new account may still enter a friend's code. */
  canRedeem: boolean
  rewardsLeft: number
  credits: number
}

export interface CreditsWallet {
  balance: number
  history: CreditEntry[]
  /** False when the server could not read the ledger; the balance is exact. */
  historyComplete: boolean
  /** Store cards bought on this account. */
  cards: string[]
  referral: ReferralState
  /** Epoch ms on THIS device's clock; 0 when no worldwide radius is banked. */
  worldRadiusUntil: number
  /** The server's day keys when it answered: the die's (UTC) and the casino's (Toronto). */
  today: { mapRoll: string; casino: string }
  mapRoll: MapRollClaim | null
  casino: CasinoClaim | null
  receivedAt: number
}

/** The server said no, with a sentence written for the person. */
export class CreditsRefused extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'CreditsRefused'
  }
}

/** No account to ask for, or the server could not be reached. */
export class CreditsUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CreditsUnavailable'
  }
}

const ENDPOINT = 'https://us-central1-poplur2025.cloudfunctions.net/poplurCredits'
const CACHE_KEY = 'poplur.credits.wallet.v2'
export const CREDITS_CHANGE_EVENT = 'poplur-credits-change'

/** What one Meshy cube costs (meshyModels.ts GENERATION_COST). Meshy bills
    Poplur per generated task, so this is a real cost being passed on. */
export const AVATAR_CUBE_COST = 25

/** What an accepted referral pays each side (credits.ts REFERRAL_CREDITS). */
export const REFERRAL_CREDIT_REWARD = 10

/** What one credit redeems for, in CAD. Display only. */
export const CREDITS_PER_DOLLAR = 100

export function creditsToCad(credits: number): string {
  return (credits / CREDITS_PER_DOLLAR).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

const REFUSALS = new Set(['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED'])

let current: { uid: string | null; wallet: CreditsWallet } | null = null
let restored = false
let inflight: Promise<CreditsWallet> | null = null

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function readEntry(value: unknown): CreditEntry | null {
  const entry = value as Record<string, unknown> | null
  if (!entry || typeof entry.id !== 'string' || typeof entry.amount !== 'number' || !Number.isFinite(entry.amount)) return null
  return {
    id: entry.id,
    kind: text(entry.type) || 'credits',
    delta: Math.trunc(entry.amount),
    note: typeof entry.note === 'string' && entry.note ? entry.note : undefined,
    cardId: typeof entry.cardId === 'string' && entry.cardId ? entry.cardId : undefined,
    at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0,
  }
}

function readMapRoll(value: unknown): MapRollClaim | null {
  const claim = value as Record<string, unknown> | null
  const face = Number(claim?.face)
  if (!claim || !Number.isInteger(face) || face < 1 || face > 6 || !isCount(claim.credits)) return null
  return { day: text(claim.day), face: face as DiceFace, credits: claim.credits, title: text(claim.title) }
}

function readCasino(value: unknown): CasinoClaim | null {
  const claim = value as Record<string, unknown> | null
  const count = Number(claim?.count)
  if (!claim || ![0, 3, 4, 5].includes(count) || !isCount(claim.amount)) return null
  return {
    day: text(claim.day),
    count: count as CasinoClaim['count'],
    symbolId: typeof claim.symbolId === 'string' ? claim.symbolId : null,
    amount: claim.amount,
    doubled: claim.doubled === true,
    line: text(claim.line),
  }
}

/** A server wallet, read defensively. Null when it is not one. */
export function readServerWallet(value: unknown, receivedAt = Date.now()): CreditsWallet | null {
  const wallet = value as Record<string, unknown> | null
  if (!wallet || typeof wallet !== 'object' || !isCount(wallet.balance)) return null
  const referral = (wallet.referral ?? {}) as Record<string, unknown>
  const today = (wallet.today ?? {}) as Record<string, unknown>
  // The server's clock decides when worldwide radius ends; carry the remaining
  // time over to this device's clock rather than trusting the two to agree.
  const serverTime = Number(wallet.serverTime)
  const until = Number(wallet.worldRadiusUntil)
  const remaining = Number.isFinite(until) && Number.isFinite(serverTime) ? until - serverTime : 0
  return {
    balance: wallet.balance,
    history: (Array.isArray(wallet.history) ? wallet.history : [])
      .map(readEntry)
      .filter((entry): entry is CreditEntry => entry !== null),
    historyComplete: wallet.historyComplete !== false,
    cards: (Array.isArray(wallet.cards) ? wallet.cards : [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    referral: {
      code: typeof referral.code === 'string' && referral.code ? referral.code : null,
      redeemedCode: typeof referral.redeemedCode === 'string' && referral.redeemedCode ? referral.redeemedCode : null,
      canRedeem: referral.canRedeem === true,
      rewardsLeft: isCount(referral.rewardsLeft) ? referral.rewardsLeft : 0,
      credits: isCount(referral.credits) ? referral.credits : REFERRAL_CREDIT_REWARD,
    },
    worldRadiusUntil: remaining > 0 ? receivedAt + remaining : 0,
    today: { mapRoll: text(today.mapRoll), casino: text(today.casino) },
    mapRoll: readMapRoll(wallet.mapRoll),
    casino: readCasino(wallet.casino),
    receivedAt,
  }
}

/** Whose wallet this page may show: the account the shell signed in. */
function viewer(): string | null {
  return isNativeShell() ? authUid() : null
}

/** The last wallet this device saw for the signed-in account, so a screen can
    paint a number before the server answers. Never another account's. */
function restore(): void {
  if (restored) return
  restored = true
  try {
    const saved = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null') as {
      uid?: unknown
      raw?: unknown
      receivedAt?: unknown
    } | null
    const wallet = readServerWallet(saved?.raw, Number(saved?.receivedAt) || 0)
    if (wallet && typeof saved?.uid === 'string') current = { uid: saved.uid, wallet }
  } catch { /* nothing saved, or storage is closed to this page */ }
}

function publish(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CREDITS_CHANGE_EVENT, { detail: { balance: creditBalance() } }))
}

/** Show a server answer, and keep it for the next paint of this account. */
function apply(raw: unknown): CreditsWallet | null {
  const receivedAt = Date.now()
  const wallet = readServerWallet(raw, receivedAt)
  if (!wallet) return null
  const uid = viewer()
  current = { uid, wallet }
  restored = true
  if (uid) {
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, raw, receivedAt })) }
    catch { /* private mode: this session still holds it */ }
  }
  publish()
  return wallet
}

/** The last wallet the server returned for the signed-in account, or null. */
export function creditsWallet(): CreditsWallet | null {
  restore()
  if (!current) return null
  const uid = viewer()
  if (current.uid !== uid) return null
  return current.wallet
}

/** The account's balance as the server last reported it; 0 before it has. */
export function creditBalance(): number {
  return creditsWallet()?.balance ?? 0
}

export function creditHistory(): CreditEntry[] {
  return creditsWallet()?.history ?? []
}

export function canAfford(cost: number): boolean {
  const wallet = creditsWallet()
  return Boolean(wallet) && Number.isFinite(cost) && cost > 0 && wallet!.balance >= cost
}

/** The shell owns auth on a phone; the browser preview signs in through the
 *  web SDK. The same two paths every other server call here uses. */
async function bearer(): Promise<string | null> {
  if (!isNativeShell()) {
    const { webAuth } = await import('./webFirebase')
    return webAuth().currentUser?.getIdToken() ?? null
  }
  if (authToken()) return authToken()
  return new Promise(resolve => {
    const finish = () => {
      window.clearTimeout(timer)
      window.removeEventListener('poplur-native-auth-token', finish)
      resolve(authToken())
    }
    const timer = window.setTimeout(finish, 4_000)
    window.addEventListener('poplur-native-auth-token', finish, { once: true })
    requestAuthToken()
  })
}

async function call(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await bearer().catch(() => null)
  if (!token) throw new CreditsUnavailable('Sign in to use your credits.')
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new CreditsUnavailable('Poplur could not be reached. Check your connection.')
  }
  const body = await response.json().catch(() => null) as {
    result?: Record<string, unknown>
    error?: { status?: string; message?: string }
  } | null
  const error = body?.error
  if (error && typeof error.message === 'string' && REFUSALS.has(String(error.status))) {
    throw new CreditsRefused(error.message, String(error.status))
  }
  if (!response.ok || !body?.result || typeof body.result !== 'object') {
    throw new CreditsUnavailable(response.status === 401
      ? 'Sign in again to use your credits.'
      : 'Credits are unavailable right now. Try again in a moment.')
  }
  return body.result
}

async function act(data: Record<string, unknown>): Promise<{ result: Record<string, unknown>; wallet: CreditsWallet }> {
  const result = await call(data)
  const wallet = apply(result.wallet)
  if (!wallet) throw new CreditsUnavailable('Credits are unavailable right now. Try again in a moment.')
  return { result, wallet }
}

/** Fetch the account's wallet. Concurrent callers share one request. */
export function refreshCredits(): Promise<CreditsWallet> {
  if (!inflight) {
    inflight = act({ action: 'wallet' })
      .then(({ wallet }) => wallet)
      .finally(() => { inflight = null })
  }
  return inflight
}

/** The Map's free daily die. The server rolls it once per UTC day and answers
    with the same face for the rest of that day. */
export async function claimDailyMapRoll(): Promise<MapRollClaim & { alreadyClaimed: boolean }> {
  const { result } = await act({ action: 'mapRoll' })
  const roll = readMapRoll(result.roll)
  if (!roll) throw new CreditsUnavailable('The daily roll could not be read. Try again in a moment.')
  return { ...roll, alreadyClaimed: (result.roll as { alreadyClaimed?: unknown }).alreadyClaimed === true }
}

/** The casino's free daily spin. The server decides the line and pays it
    before answering; the reels only show what it decided. */
export async function spinDailyCasino(): Promise<CasinoClaim & { alreadySpun: boolean }> {
  const { result } = await act({ action: 'casinoSpin' })
  const spin = readCasino(result.spin)
  if (!spin) throw new CreditsUnavailable('The spin could not be read. Try again in a moment.')
  return { ...spin, alreadySpun: (result.spin as { alreadySpun?: unknown }).alreadySpun === true }
}

/** A new account enters a friend's code; the server pays both sides. */
export async function redeemReferralCode(code: string): Promise<{ creditsAdded: number }> {
  const { result } = await act({ action: 'redeemReferral', code: code.trim().toUpperCase() })
  const added = (result.referral as { creditsAdded?: unknown } | undefined)?.creditsAdded
  return { creditsAdded: isCount(added) ? added : 0 }
}

/** The casino's free spin was already used on the server's current day. */
export function casinoSpunToday(wallet = creditsWallet()): boolean {
  return Boolean(wallet?.casino && wallet.casino.day === wallet.today.casino)
}

export function onCreditsChange(listener: () => void): () => void {
  const handle = () => listener()
  // Another web view of the same account (the native shell runs more than
  // one) refreshing the wallet moves this one's balance too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CACHE_KEY) return
    restored = false
    current = null
    listener()
  }
  window.addEventListener(CREDITS_CHANGE_EVENT, handle)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CREDITS_CHANGE_EVENT, handle)
    window.removeEventListener('storage', onStorage)
  }
}
