import { useEffect, useRef, useState } from 'react'

/** Native Feed cards may cover Feed, never a screen reached after leaving it.
 * Hosts can deliver a late ad callback during navigation; discard that callback
 * and forget the previous card so it cannot disable the next screen's cube. */
export function useNativeFeedAdVisibility(feedVisible: boolean): boolean {
  const visible = useRef(feedVisible)
  visible.current = feedVisible
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!feedVisible) setOpen(false)
  }, [feedVisible])

  useEffect(() => {
    const onFeedAd = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: unknown }>).detail
      setOpen(visible.current && detail?.open === true)
    }
    window.addEventListener('poplur-native-feed-ad', onFeedAd)
    return () => window.removeEventListener('poplur-native-feed-ad', onFeedAd)
  }, [])

  return feedVisible && open
}
