import React, { useEffect, useRef, useState } from 'react'
import styles from './WalletScreen.module.css'
import { playPop } from './pop'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import {
  CREDITS_PER_DOLLAR,
  cashOutCredits,
  creditBalance,
  creditHistory,
  creditsToCad,
  onCreditsChange,
  transferCreditsOut,
  type CreditEntry,
} from './poplurCredits'

// The Poplur Wallet — the account's money face. One card up top with the
// credit balance and its CAD redemption value, the four verbs under it, and
// the ledger's recent history below. It is a WINDOW onto poplurCredits.ts
// (the same ledger the Avatar generator and the Store already move), never a
// second balance.
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

const ENTRY_LABEL: Record<CreditEntry['kind'], string> = {
  'welcome': 'Welcome credits',
  'purchase': 'Bought credits',
  'refund': 'Refund',
  'avatar-cube': 'Avatar cube',
  'transfer-out': 'Sent',
  'transfer-in': 'Received',
  'cash-out': 'Cash out',
  'casino-win': 'Casino win',
  'map-reward': 'Map reward',
  'referral': 'Referral reward',
}

type WalletPage = 'home' | 'send' | 'cashout'

export default function WalletScreen({ bindBack }: {
  /** The cube's back button, lent down from the hold menu — inner pages step
      back to the wallet home before the cube closes the screen. */
  bindBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const [balance, setBalance] = useState(() => creditBalance())
  const [history, setHistory] = useState(() => creditHistory().slice(0, 12))
  const [ownedCards, setOwnedCards] = useState(readOwnedCards)
  const [page, setPage] = useState<WalletPage>('home')
  const [note, setNote] = useState<string | null>(null)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const pageRef = useRef(page)
  pageRef.current = page

  useEffect(() => onCreditsChange(() => {
    setBalance(creditBalance())
    setHistory(creditHistory().slice(0, 12))
  }), [])

  // A Store purchase completing while the wallet is open lands the card here
  // immediately; when the wallet is closed the same handler in the next open
  // reads the persisted list.
  useEffect(() => {
    const onCheckout = (event: Event) => {
      const detail = (event as CustomEvent<{ ok?: boolean; cardId?: string }>).detail
      if (detail?.ok && detail.cardId) {
        rememberOwnedCard(detail.cardId)
        setOwnedCards(readOwnedCards())
      }
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

  const submitSend = () => {
    const to = sendTo.trim().replace(/^@/, '')
    const amount = Math.floor(Number(sendAmount))
    if (!to) { say('Who to?'); return }
    if (!Number.isFinite(amount) || amount <= 0) { say('Enter an amount.'); return }
    if (!transferCreditsOut(amount, `@${to}`)) { say('Not enough credits.'); return }
    playPop()
    // The server executes transfers when the wallet backend lands; the shell
    // is told so a native ledger can mirror the movement today.
    if (isNativeShell()) postNativeEvent({ type: 'walletSendCredits', to, credits: amount })
    say(`Sent ${amount.toLocaleString()} credits to @${to}`)
    setSendTo('')
    setSendAmount('')
    setPage('home')
  }

  const submitCashOut = () => {
    const amount = Math.floor(Number(cashAmount))
    if (!Number.isFinite(amount) || amount <= 0) { say('Enter an amount.'); return }
    if (!cashOutCredits(amount)) { say('Not enough credits.'); return }
    playPop()
    if (isNativeShell()) postNativeEvent({ type: 'walletCashOut', credits: amount })
    say(`Cashing out ${creditsToCad(amount)}`)
    setCashAmount('')
    setPage('home')
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
              <b>{balance.toLocaleString()} Credits</b>
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
          <b className={styles.walletBalance}>{balance.toLocaleString()} Credits</b>
          <i className={styles.walletCad}>≈ {creditsToCad(balance)}</i>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={buyCredits}>Buy</button>
          <button type="button" onClick={() => { playPop(); setPage('send') }}>Send</button>
          <button
            type="button"
            onClick={() => {
              playPop()
              // Receiving is an identity handoff, not a form: share your handle.
              if (isNativeShell()) postNativeEvent({ type: 'walletShareReceive' })
              say('Share your @handle to receive credits.')
            }}
          >Receive</button>
          <button type="button" onClick={() => { playPop(); setPage('cashout') }}>Cash Out</button>
        </div>

        {/* The cards the account holds, bought in the Store. */}
        <div className={styles.sectionTitle}>YOUR CARDS</div>
        <div className={styles.card}>
          {ownedCards.length === 0 ? (
            <div className={styles.emptyCards}>
              No cards yet — card designs live in the <b>STORE</b>.
            </div>
          ) : ownedCards.map(id => (
            <div key={id} className={styles.cardRow}>
              <b>{CARD_NAMES[id] ?? id}</b>
              <i>Owned</i>
            </div>
          ))}
        </div>

        <div className={styles.sectionTitle}>RECENT ACTIVITY</div>
        <div className={styles.card}>
          {history.map(entry => (
            <div key={entry.id} className={styles.entryRow}>
              <div className={styles.entryText}>
                <b>{ENTRY_LABEL[entry.kind] ?? entry.kind}</b>
                {entry.note && <i>{entry.note}</i>}
              </div>
              <span className={entry.delta > 0 ? styles.gain : styles.loss}>
                {entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {note && <div className={styles.note}>{note}</div>}
      </div>
    </section>
  )
}
