import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@/lib/i18n/i18n'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from '@/config/react-query-config'
import { validateConfig } from '@/config/environment-config-validator'
import { getConfig } from '@/config/environment-config'
import { PostHogProvider } from '@posthog/react'
import posthog from 'posthog-js'
import { initPostHog, isPostHogEnabled } from '@/lib/analytics/posthog-init'
import { router } from './router'
import { SessionInitializer } from '@/features/auth/components/session-initializer'
import { UserSetupGate } from '@/features/auth/components/user-setup-gate'
import { UserUiPrefsSync } from '@/features/settings/components/user-ui-prefs-sync'
import { ExtensionInstallFactSync } from '@/features/settings/components/extension-install-fact-sync'

validateConfig(getConfig())

initPostHog()

const PostHogProviderWrapper = ({ children }: { children: React.ReactNode }) =>
  isPostHogEnabled() ? <PostHogProvider client={posthog}>{children}</PostHogProvider> : <>{children}</>

export const App = () => {
  return (
    <PostHogProviderWrapper>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <UserUiPrefsSync />
          <ExtensionInstallFactSync />
          <SessionInitializer>
            <UserSetupGate>
              <RouterProvider router={router} />
            </UserSetupGate>
          </SessionInitializer>
          {getConfig().showDevTools && <ReactQueryDevtools initialIsOpen={false} />}
        </QueryClientProvider>
      </I18nProvider>
    </PostHogProviderWrapper>
  )
}
