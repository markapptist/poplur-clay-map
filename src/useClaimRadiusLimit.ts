import { useCallback, useEffect, useState } from 'react'
import { claimRadiusLimitKm } from './claimRadius'
import {
  ACCOUNT_RADIUS_CHANGE_EVENT,
  ACCOUNT_RADIUS_STORAGE_KEY,
  readAccountRadiusKm,
} from './accountRadius'

/**
 * Keeps posting controls aligned with the Firestore-backed account cache,
 * including the map iframe. Same-document writes arrive as a custom event and
 * parent/child document writes arrive through postMessage or storage events.
 */
export function useClaimRadiusLimitKm(authoritativeRadiusKm?: number): number {
  const read = useCallback(() => claimRadiusLimitKm(
    authoritativeRadiusKm === undefined
      ? readAccountRadiusKm()
      : authoritativeRadiusKm,
  ), [authoritativeRadiusKm])
  const [limit, setLimit] = useState(read)

  useEffect(() => {
    const sync = (event?: Event) => {
      if (typeof StorageEvent !== 'undefined'
        && event instanceof StorageEvent
        && event.key !== null
        && event.key !== ACCOUNT_RADIUS_STORAGE_KEY) return
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
