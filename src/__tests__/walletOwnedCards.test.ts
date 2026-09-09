// The wallet listened for `{ ok, cardId }` on poplur-store-checkout-result, but
// nothing has ever sent that shape. Native sends
// `{ status, message, creditsAdded, completedItems: [{ productId, quantity, cardId }] }`
// (PoplurCardPurchaseService.webPayload) and the web's own failure branches send
// `{ status: 'failure', message }`. So a real, paid purchase left YOUR CARDS
// empty — the card you just bought appeared nowhere in the app. These read the
// source so the two ends cannot drift apart again.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wallet = readFileSync(new URL('../WalletScreen.tsx', import.meta.url), 'utf8')
const nativeService = readFileSync(
  new URL('../../../Poplur2025-iOS/Poplur2025/PoplurCardPurchaseService.swift', import.meta.url),
  'utf8',
)

describe('the wallet records the cards a purchase actually completed', () => {
  it('keys off `status`, never the `ok` field nothing sends', () => {
    expect(wallet).toContain("detail?.status !== 'success'")
    expect(wallet).not.toContain('detail?.ok')
  })

  it('reads card ids out of completedItems, where the shell puts them', () => {
    expect(wallet).toContain('detail.completedItems')
    expect(wallet).toMatch(/completedItems[\s\S]{0,220}cardId/)
  })

  // The wire format is the contract. If native renames either key the web goes
  // silently back to an empty wallet, so pin both ends.
  it('matches the payload native actually builds', () => {
    expect(nativeService).toContain('"status": status.rawValue')
    expect(nativeService).toContain('"completedItems": completedItems')
    expect(nativeService).toContain('item["cardId"] = cardID')
    expect(nativeService).toMatch(/enum Status: String \{[\s\S]{0,120}case success/)
  })
})
