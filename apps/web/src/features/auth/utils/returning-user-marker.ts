// Set whenever a non-anonymous session is observed in this browser; signOut
// re-writes it after wiping localStorage. Its absence is what allows the
// _authenticated guard to silently create a guest account: a returning real
// user with no session (signed out, expired) must land on /login instead of
// being switched to a fresh anonymous account.
const RETURNING_USER_MARKER_KEY = 'flick.returning-user'

export const hasReturningUserMarker = (): boolean => window.localStorage.getItem(RETURNING_USER_MARKER_KEY) === 'true'

export const setReturningUserMarker = (): void => {
  window.localStorage.setItem(RETURNING_USER_MARKER_KEY, 'true')
}
