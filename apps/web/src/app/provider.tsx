import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@/lib/i18n/i18n'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from '@/config/react-query-config'
import { validateConfig } from '@/config/environment-config-validator'
import { getConfig } from '@/config/environment-config'
import { FEATURES } from '@template-app/core/features'
import { PostHogProvider } from 'posthog-js/react'
import posthog from 'posthog-js'
import { router } from './router'
import { SessionInitializer } from '@/features/auth/components/session-initializer'
import { UserSetupGate } from '@/features/auth/components/user-setup-gate'

validateConfig(getConfig())

if (FEATURES.POSTHOG) {
  posthog.init(getConfig().posthogToken, {
    api_host: 'https://eu.i.posthog.com',
    persistence: 'localStorage+cookie',
  })
}

const PostHogProviderWrapper = ({ children }: { children: React.ReactNode }) =>
  FEATURES.POSTHOG ? <PostHogProvider client={posthog}>{children}</PostHogProvider> : <>{children}</>

export const App = () => {
  return (
    <PostHogProviderWrapper>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
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
