import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import {
  AlertOctagon,
  ChartColumn,
  CircleHelp,
  Globe,
  Languages,
  LifeBuoy,
  LogOut,
  Palette,
  Sparkles,
  UserCircle,
  Wrench,
} from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Switch } from '@flicktionary/ui/components/switch'
import { PageContainer } from '@/components/page-container'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@flicktionary/ui/components/select'
import { i18nConfig } from '@flicktionary/i18n/i18n-config'
import { findSupportedLanguage } from '@flicktionary/core/constants/supported-languages'
import { getIsAnonymous, getUserEmail, useAuthStore } from '@/stores/auth-store'
import { useThemeStore, type ThemePref } from '@/stores/theme-store'
import { activateLocale, resolveUiLocale } from '@/lib/i18n/i18n'
import { checkIsTestUser } from '@/utils/test-users-utils'
import {
  useGetUserPrefs,
  useSetLlmHighlightsEnabled,
  useSetUiLanguage,
  useSetUiTheme,
} from '@/features/sessions/api/sessions-hooks'
import { Route as AdminSettingsRoute } from '@/app/routes/_authenticated/admin-settings'
import { Route as DangerZoneRoute } from '@/app/routes/_authenticated/profile/danger-zone'
import { MoreListSection } from './more-list-section'
import { MoreListRow } from './more-list-row'
import { GuestSaveProgressBanner } from '@/features/auth/components/guest-save-progress-banner'
import { GuestSignOutConfirmOverlay } from '@/features/auth/components/guest-sign-out-confirm-overlay'

export const MoreTabView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const router = useRouter()
  const signOut = useAuthStore((state) => state.signOut)
  const isTestUser = checkIsTestUser(useAuthStore(getUserEmail))

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setLlmHighlights, isPending: isSavingLlm } = useSetLlmHighlightsEnabled()

  const themePref = useThemeStore((state) => state.pref)
  const setThemePref = useThemeStore((state) => state.setPref)
  const { mutate: saveUiTheme } = useSetUiTheme()
  const { mutate: saveUiLanguage } = useSetUiLanguage()

  // 'system' when never set or explicitly System; otherwise the stored locale.
  const uiLanguageValue =
    prefs?.uiLanguage && (i18nConfig.locales as readonly string[]).includes(prefs.uiLanguage)
      ? prefs.uiLanguage
      : 'system'

  const handleThemeChange = (value: string) => {
    const pref = value as ThemePref
    // Optimistic: apply instantly, the mutation's onError invalidation reverts.
    setThemePref(pref)
    saveUiTheme({ uiTheme: pref })
  }

  const handleUiLanguageChange = (value: string) => {
    activateLocale(resolveUiLocale(value === 'system' ? 'system' : value))
    saveUiLanguage({ uiLanguage: value })
  }

  const isAnonymous = useAuthStore(getIsAnonymous)
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const performSignOut = async () => {
    setIsSigningOut(true)
    await signOut(() => navigate({ to: '/login' }))
    toast.success(t`Signed out successfully`)
  }

  // A guest has no way to sign back in, so their sign-out goes through a
  // confirmation that pushes the save-progress conversion flow first.
  const handleSignOut = () => {
    if (isAnonymous) {
      setIsSignOutConfirmOpen(true)
      return
    }
    void performSignOut()
  }

  // Contact-us is opened by toggling an `overlay=contact-us` search param;
  // OverlayController watches the URL and mounts the right overlay component.
  const handleContactUs = () => {
    const currentSearch = router.state.location.search
    void router.navigate({
      to: router.state.location.pathname,
      search: { ...currentSearch, overlay: 'contact-us' },
    })
  }

  return (
    <PageContainer width='narrow' className='flex flex-col gap-6'>
      <h1 className='text-2xl font-bold'>{t`More`}</h1>

      {/* Re-entry into onboarding for a user who left it via the X. The gate keeps
          the rest of the app walled until the mandatory values are provided. */}
      {prefs && !prefs.isOnboarded && (
        <div className='border-border bg-accent/40 flex flex-col gap-3 rounded-xl border p-4'>
          <div className='flex items-start gap-3'>
            <Sparkles className='text-foreground mt-0.5 size-5 shrink-0' />
            <div className='flex flex-col gap-1'>
              <p className='font-semibold'>{t`Finish setting up Flicktionary`}</p>
              <p className='text-muted-foreground text-sm'>
                {t`You haven't finished onboarding yet. Complete it to start adding movies and texts.`}
              </p>
            </div>
          </div>
          <Button size='lg' className='w-full sm:w-auto sm:self-start' onClick={() => navigate({ to: '/onboarding' })}>
            {t`Finish setup`}
          </Button>
        </div>
      )}

      <GuestSaveProgressBanner />

      <MoreListSection title={t`General`}>
        <MoreListRow
          icon={UserCircle}
          label={t`Account`}
          description={t`Profile, subscription, sign-in`}
          onPress={() => navigate({ to: '/more/account' })}
        />
        <MoreListRow
          icon={ChartColumn}
          label={t`Stats`}
          description={t`Activity, streak, and coverage`}
          onPress={() => navigate({ to: '/stats' })}
        />
      </MoreListSection>

      <MoreListSection title={t`Appearance`}>
        <MoreListRow
          icon={Palette}
          label={t`Theme`}
          trailing={
            <Select value={themePref} onValueChange={handleThemeChange}>
              <SelectTrigger size='sm' aria-label={t`Theme`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align='end'>
                <SelectItem value='system'>{t`System`}</SelectItem>
                <SelectItem value='light'>{t`Light`}</SelectItem>
                <SelectItem value='dark'>{t`Dark`}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <MoreListRow
          icon={Globe}
          label={t`Interface language`}
          trailing={
            <Select value={uiLanguageValue} onValueChange={handleUiLanguageChange} disabled={!prefs}>
              <SelectTrigger size='sm' aria-label={t`Interface language`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align='end'>
                <SelectItem value='system'>{t`System`}</SelectItem>
                {i18nConfig.locales.map((code) => (
                  <SelectItem key={code} value={code}>
                    {findSupportedLanguage(code)?.nativeName ?? code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </MoreListSection>

      <MoreListSection title={t`Settings`}>
        <MoreListRow
          icon={Languages}
          label={t`Languages`}
          description={t`Native language and CEFR levels`}
          onPress={() => navigate({ to: '/more/languages' })}
        />
        <MoreListRow
          icon={Sparkles}
          label={t`LLM-suggested terms`}
          description={t`Show suggested terms while reading`}
          trailing={
            <Switch
              checked={prefs?.llmHighlightsEnabled ?? true}
              disabled={isSavingLlm || !prefs}
              onCheckedChange={(checked) => setLlmHighlights({ enabled: checked })}
              aria-label={t`LLM-suggested terms`}
            />
          }
        />
      </MoreListSection>

      <MoreListSection title={t`About`}>
        <MoreListRow
          icon={CircleHelp}
          label={t`User guide`}
          description={t`How sessions, saving words, and practice work`}
          onPress={() => navigate({ to: '/user-guide' })}
        />
        <MoreListRow icon={LifeBuoy} label={t`Contact us`} onPress={handleContactUs} />
        {isTestUser && (
          <MoreListRow
            icon={Wrench}
            label={t`Admin settings`}
            onPress={() => navigate({ to: AdminSettingsRoute.to })}
          />
        )}
        <MoreListRow
          icon={AlertOctagon}
          label={t`Danger zone`}
          destructive
          showChevron
          onPress={() => navigate({ to: DangerZoneRoute.to })}
        />
        <MoreListRow icon={LogOut} label={t`Sign out`} onPress={handleSignOut} />
      </MoreListSection>

      <GuestSignOutConfirmOverlay
        open={isSignOutConfirmOpen}
        onOpenChange={setIsSignOutConfirmOpen}
        isSigningOut={isSigningOut}
        onSignOutAnyway={() => void performSignOut()}
      />

      {/* Required verbatim by TMDB's API terms of use: movie/TV search results
          and poster/still images come from their API. */}
      <p className='text-muted-foreground text-center text-xs'>
        <Trans>
          This product uses the{' '}
          <a
            href='https://www.themoviedb.org'
            target='_blank'
            rel='noreferrer'
            className='hover:text-foreground underline'
          >
            TMDB
          </a>{' '}
          API but is not endorsed or certified by TMDB.
        </Trans>
      </p>
    </PageContainer>
  )
}
