import React, { useEffect, useRef, useState } from 'react'
import styles from './WalletScreen.module.css'
import { playPop } from './pop'
import { playCubeNavigationPop } from './cubeNavigationSound'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import {
  CreditsRefused,
  creditsToCad,
  creditsWallet,
  onCreditsChange,
  redeemReferralCode,
  refreshCredits,
  type CreditsWallet,
} from './poplurCredits'

// The Poplur Wallet — the account's money face. One card up top with the
// credit balance and its CAD redemption value, the four verbs under it, and
// the ledger's recent history below. It is a WINDOW onto the account's
// credits on the server (poplurCredits.ts mirrors the `poplurCredits`
// callable): the same balance a card purchase adds to and a Meshy cube
// spends from, never a second one.
//
// SEND and CASH OUT are inner pages of this screen, not separate subscreens —
// but each announces itself over `poplur-wallet-page` so the navigator cube
// can turn into the coin stack (send) or the cash stack (cash out) while the
// page is open, the way MAIL's envelope swap works.

/** The Store's four card designs, keyed the way the IAP products are. Owning
    one is recorded by the Store checkout result event; the wallet just shows
    what the account holds. */
const CARD_NAMES: Record<string, string> = {
  inverted: 'Inverted Card',
  lens: 'Lens Card',
  splitDiamond: 'Split Diamond Card',
  swoosh: 'Swoosh Card',
}

const OWNED_CARDS_KEY = 'poplur.wallet.cards.v1'

function readOwnedCards(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OWNED_CARDS_KEY) ?? 'null')
    return Array.isArray(parsed) ? parsed.filter((id: unknown): id is string => typeof id === 'string') : []
  } catch { return [] }
}

function rememberOwnedCard(cardId: string) {
  const owned = readOwnedCards()
  if (owned.includes(cardId)) return
  try { window.localStorage.setItem(OWNED_CARDS_KEY, JSON.stringify([...owned, cardId])) }
  catch { /* private mode */ }
}

/** The server ledger's row types (functions/src/credits.ts, cardPurchases.ts,
    meshyModels.ts and the AI routes in index.ts). */
const ENTRY_LABEL: Record<string, string> = {
  welcome_grant: 'Welcome credits',
  store_card_purchase: 'Bought credits',
  map_daily_roll: 'Map reward',
  casino_daily_spin: 'Casino win',
  referral_reward: 'Referral reward',
  meshy_generation: 'Avatar cube',
  meshy_refund: 'Refund',
  ai_generation_reserve: 'AI generation',
  ai_generation_refund: 'Refund',
  ai_generation_cancel_refund: 'Refund',
  radius_boost_spend: 'Radius boost',
}

const failureText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Credits are unavailable right now.'

type WalletPage = 'home' | 'send' | 'cashout'

export default function WalletScreen({ bindBack }: {
  /** The cube's back button, lent down from the hold menu — inner pages step
      back to the wallet home before the cube closes the screen. */
  bindBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const [wallet, setWallet] = useState<CreditsWallet | null>(creditsWallet)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ownedCards, setOwnedCards] = useState(readOwnedCards)
  const [page, setPage] = useState<WalletPage>('home')
  const [note, setNote] = useState<string | null>(null)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [friendCode, setFriendCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const pageRef = useRef(page)
  pageRef.current = page
  const balance = wallet?.balance ?? 0
  const history = wallet?.history.slice(0, 12) ?? []
  // Cards bought on the account, plus any this phone saw complete before the
  // server listed them.
  const cards = [...new Set([...(wallet?.cards ?? []), ...ownedCards])]

  useEffect(() => onCreditsChange(() => setWallet(creditsWallet())), [])

  // The account's balance, fetched every time the Wallet opens. A saved copy
  // may paint first; it is replaced by the server's answer.
  useEffect(() => {
    let live = true
    refreshCredits().then(
      () => { if (live) setLoadError(null) },
      error => { if (live) setLoadError(failureText(error)) },
    )
    return () => { live = false }
  }, [])

  // A Store purchase completing while the wallet is open lands the card here
  // immediately; when the wallet is closed the same handler in the next open
  // reads the persisted list.
  useEffect(() => {
    // Read the shape the shell ACTUALLY sends. This listened for `ok` and a
    // top-level `cardId`, and the checkout result carries neither: native builds
    // it as { status, message, creditsAdded, completedItems: [{ productId,
    // quantity, cardId }] } (PoplurCardPurchaseService.webPayload), and the
    // web's own failure branches send { status: 'failure', message }. `ok` was
    // therefore always undefined, the guard never passed, and YOUR CARDS stayed
    // empty after a real, paid purchase — the card you had just bought did not
    // appear anywhere in the app.
    const onCheckout = (event: Event) => {
      const detail = (event as CustomEvent<{
        status?: string
        completedItems?: Array<{ cardId?: string }>
      }>).detail
      if (detail?.status !== 'success') return
      // One purchase can complete several cards; take every one that names a
      // card and ignore the credit-only rows.
      const bought = (detail.completedItems ?? [])
        .map(item => item?.cardId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      // The purchase's credits were granted on the server before native
      // reported success (verifyCardPurchase); show them.
      void refreshCredits().catch(() => { /* the next open shows them */ })
      if (!bought.length) return
      bought.forEach(rememberOwnedCard)
      setOwnedCards(readOwnedCards())
    }
    window.addEventListener('poplur-store-checkout-result', onCheckout)
    return () => window.removeEventListener('poplur-store-checkout-result', onCheckout)
  }, [])

  // Tell the shell which face of the wallet is up, so the cube can wear the
  // coin stack on SEND and the cash stack on CASH OUT.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-wallet-page', { detail: page }))
    return () => {
      if (pageRef.current !== 'home') {
        window.dispatchEvent(new CustomEvent('poplur-wallet-page', { detail: 'home' }))
      }
    }
  }, [page])

  // Inner pages answer the cube before the hold menu closes the screen.
  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      if (pageRef.current !== 'home') {
        setPage('home')
        return true
      }
      return false
    })
    return () => bindBack(null)
  }, [bindBack])

  const say = (text: string) => {
    setNote(text)
    window.setTimeout(() => setNote(null), 2600)
  }

  // Sending and cashing out have no server operation yet, and the balance is
  // the server's, so neither may pretend: nothing moves and the page says so.
  const submitSend = () => {
    playPop()
    say('Sending credits is not available yet. Nothing was sent.')
  }

  const submitCashOut = () => {
    playPop()
    say('Cash out is not available yet. Nothing was redeemed.')
  }

  /** A new account enters a friend's code; the server pays both sides once. */
  const submitFriendCode = async () => {
    const code = friendCode.trim()
    if (redeeming) return
    if (code.length !== 6) { say('Enter the 6-character code your friend shared.'); return }
    playPop()
    setRedeeming(true)
    try {
      const { creditsAdded } = await redeemReferralCode(code)
      playCubeNavigationPop()
      setFriendCode('')
      say(`+${creditsAdded} credits. Your friend gets ${creditsAdded} too.`)
    } catch (error) {
      say(error instanceof CreditsRefused ? error.message : failureText(error))
    } finally {
      setRedeeming(false)
    }
  }

  const buyCredits = () => {
    playPop()
    // Same door the Avatar screen uses: the Store owns purchasing.
    if (isNativeShell()) postNativeEvent({ type: 'purchaseCredits', product: 'poplur-credits' })
    say('Opening credits in the Store.')
  }

  if (page === 'send') {
    return (
      <section className={styles.screen} aria-label="Send credits" data-clay-scroll>
        <div className={styles.body}>
          <div className={styles.pageTitle}>SEND CREDITS</div>
          <div className={styles.card}>
            <label className={styles.field}>
              <span>To</span>
              <input
                value={sendTo}
                onChange={e => setSendTo(e.target.value)}
                placeholder="@username"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
            <label className={styles.field}>
              <span>Credits</span>
              <input
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="500"
                inputMode="numeric"
              />
            </label>
            {Number(sendAmount) > 0 && (
              <div className={styles.equivalent}>{creditsToCad(Number(sendAmount))}</div>
            )}
            <button type="button" className={styles.primary} onClick={submitSend}>
              Send {Number(sendAmount) > 0 ? Number(sendAmount).toLocaleString() : ''} Credits
            </button>
          </div>
          {note && <div className={styles.note}>{note}</div>}
        </div>
      </section>
    )
  }

  if (page === 'cashout') {
    const amount = Math.floor(Number(cashAmount)) || 0
    return (
      <section className={styles.screen} aria-label="Cash out" data-clay-scroll>
        <div className={styles.body}>
          <div className={styles.pageTitle}>CASH OUT</div>
          <div className={styles.card}>
            <div className={styles.cashBalance}>
              <i>Available</i>
              <b>{wallet ? `${balance.toLocaleString()} Credits` : '— Credits'}</b>
            </div>
            <label className={styles.field}>
              <span>Redeem</span>
              <input
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1000"
                inputMode="numeric"
              />
            </label>
            {amount > 0 && (
              <div className={styles.equivalent}>Payout {creditsToCad(amount)}</div>
            )}
            <button type="button" className={styles.primary} onClick={submitCashOut}>
              Cash Out {amount > 0 ? creditsToCad(amount) : ''}
            </button>
          </div>
          {note && <div className={styles.note}>{note}</div>}
        </div>
      </section>
    )
  }

  return (
    <section className={styles.screen} aria-label="Poplur Wallet" data-clay-scroll>
      <div className={styles.body}>
        {/* The wallet card: the balance is the object. */}
        <div className={styles.walletCard}>
          <span className={styles.walletKicker}>POPLUR WALLET</span>
          <b className={styles.walletBalance}>{wallet ? balance.toLocaleString() : '—'} Credits</b>
          <i className={styles.walletCad}>
            {wallet ? `≈ ${creditsToCad(balance)}` : (loadError ?? 'Checking your balance…')}
          </i>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={buyCredits}>Buy</button>
          <button type="button" onClick={() => { playCubeNavigationPop(); setPage('send') }}>Send</button>
          <button
            type="button"
            onClick={() => {
              playPop()
              // Receiving is an identity handoff, not a form: share your handle.
              if (isNativeShell()) postNativeEvent({ type: 'walletShareReceive' })
              say('Share your @handle to receive credits.')
            }}
          >Receive</button>
          <button type="button" onClick={() => { playCubeNavigationPop(); setPage('cashout') }}>Cash Out</button>
        </div>

        {/* A new account's first 14 days: a friend's code pays you both. */}
        {wallet?.referral.canRedeem && (
          <>
            <div className={styles.sectionTitle}>HAVE A FRIEND&apos;S CODE?</div>
            <div className={styles.card}>
              <label className={styles.field}>
                <span>Code</span>
                <input
                  value={friendCode}
                  onChange={e => setFriendCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  placeholder="ABC234"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <div className={styles.equivalent}>
                You both get {wallet.referral.credits} credits and a day of worldwide radius.
              </div>
              <button type="button" className={styles.primary} disabled={redeeming} onClick={() => { void submitFriendCode() }}>
                {redeeming ? 'Checking…' : 'Use Code'}
              </button>
            </div>
          </>
        )}

        {/* The cards the account holds, bought in the Store. */}
        <div className={styles.sectionTitle}>YOUR CARDS</div>
        <div className={styles.card}>
          {cards.length === 0 ? (
            <div className={styles.emptyCards}>
              No cards yet — card designs live in the <b>STORE</b>.
            </div>
          ) : cards.map(id => (
            <div key={id} className={styles.cardRow}>
              <b>{CARD_NAMES[id] ?? id}</b>
              <i>Owned</i>
            </div>
          ))}
        </div>

        <div className={styles.sectionTitle}>RECENT ACTIVITY</div>
        <div className={styles.card}>
          {history.length === 0 && (
            <div className={styles.emptyCards}>
              {!wallet
                ? (loadError ?? 'Loading your activity…')
                : wallet.historyComplete ? 'No activity yet.' : 'Your activity could not be loaded right now.'}
            </div>
          )}
          {history.map(entry => {
            const detail = entry.note ?? (entry.cardId ? CARD_NAMES[entry.cardId] : undefined)
            return (
            <div key={entry.id} className={styles.entryRow}>
              <div className={styles.entryText}>
                <b>{ENTRY_LABEL[entry.kind] ?? 'Credits'}</b>
                {detail && <i>{detail}</i>}
              </div>
              <span className={entry.delta > 0 ? styles.gain : styles.loss}>
                {entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString()}
              </span>
            </div>
            )
          })}
        </div>

        {note && <div className={styles.note}>{note}</div>}
      </div>
    </section>
  )
}
