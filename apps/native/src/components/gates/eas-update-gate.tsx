import { ReactNode, useEffect, useRef } from 'react'
import { getConfig } from '@/config/environment-config'
import * as Updates from 'expo-updates'
import { AppState } from 'react-native'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

type EasUpdateGateProps = {
  children: ReactNode
}

export const EasUpdateGate = ({ children }: EasUpdateGateProps) => {
  const initialCheckDoneRef = useRef(false)
  useEffect(() => {
    // https://docs.expo.dev/eas-update/download-updates/#updates-are-loaded-asynchronously-on-startup-by-default
    const checkForUpdates = async () => {
      if (getConfig().shouldCheckForEasUpdates) {
        try {
          const update = await Updates.checkForUpdateAsync()

          if (update.isAvailable) {
            POSTHOG_EVENTS.startSilentOverTheAirUpdate()
            try {
              // Here we don't force a reload, otherwise a new user would first see a weird reload or a prompt to reload
              // right after installing the app, which is bad UX.
              await Updates.fetchUpdateAsync()
              // todo updates: surface non-blocking banner/toast so users can restart when convenient
              POSTHOG_EVENTS.silentOverTheAirUpdateFetched()
            } catch (fetchError) {
              POSTHOG_EVENTS.silentOverTheAirUpdateFailed()
              logWithSentry('Error fetching EAS update', fetchError)
            }
          }
        } catch (checkError) {
          logWithSentry('Error checking for EAS updates', checkError)
        }
      }
    }

    if (!initialCheckDoneRef.current) {
      checkForUpdates().then()
      initialCheckDoneRef.current = true
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkForUpdates().then()
      }
    })

    return () => {
      subscription.remove()
    }
  }, [])

  // we should not block the rendering of the app even if there's an update available
  return <>{children}</>
}
