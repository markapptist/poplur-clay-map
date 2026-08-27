/**
 * Hold-menu marks whose filenames deliberately differ from their historical
 * generic tile names.  Keeping these three assignments together prevents a
 * future inventory edit from quietly putting Search, the profile portrait,
 * or the credit stack back on these destinations.
 */
export const HOLD_MENU_ICON_ASSETS = {
  browser: 'Browser',
  house: 'House',
  store: 'ShoppingBag',
} as const
