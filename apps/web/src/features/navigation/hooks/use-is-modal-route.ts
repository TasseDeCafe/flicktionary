import { useMatches } from '@tanstack/react-router'

// True when any matched route in the current hierarchy opted into the modal-screen
// presentation by setting `staticData.hideAppChrome = true`. AppShellLayout uses this
// to suppress the sidebar/tab bar so modal screens own the full viewport.
export const useIsModalRoute = (): boolean => {
  const matches = useMatches()
  return matches.some((match) => match.staticData?.hideAppChrome === true)
}
