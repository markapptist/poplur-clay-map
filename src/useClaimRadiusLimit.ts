import { useCallback, useEffect, useState } from 'react'
import { claimRadiusLimitKm } from './claimRadius'
import {
  ACCOUNT_RADIUS_CHANGE_EVENT,
  AVAILABLE_CLAIM_STORAGE_KEY,
  readAvailableClaimKm,
} from './accountRadius'

/**
 * Keeps posting controls aligned with the Firestore-backed account cache,
 * including the map iframe. Same-document writes arrive as a custom event and
 * parent/child document writes arrive through postMessage or storage events.
 *
 * The ceiling is the claim ALLOWANCE (earned − committed), never the profile's
 * total: offering the total is what let thirteen unengaged posts climb to the
 * world radius, and offering more than the rule accepts is what once refused
 * legitimate claims on upload with nothing to explain it.
 */
export function useClaimRadiusLimitKm(authoritativeAvailableClaimKm?: number): number {
  const read = useCallback(() => claimRadiusLimitKm(
    authoritativeAvailableClaimKm === undefined
      ? readAvailableClaimKm()
      : authoritativeAvailableClaimKm,
  ), [authoritativeAvailableClaimKm])
  const [limit, setLimit] = useState(read)

  useEffect(() => {
    const sync = (event?: Event) => {
      if (typeof StorageEvent !== 'undefined'
        && event instanceof StorageEvent
        && event.key !== null
        && event.key !== AVAILABLE_CLAIM_STORAGE_KEY) return
      setLimit(read())
    }
    window.addEventListener(ACCOUNT_RADIUS_CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      window.removeEventListener(ACCOUNT_RADIUS_CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [read])

  return limit
}
