import { useNavigate, useRouter } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { AlertOctagon, Globe, Languages, LifeBuoy, LogOut, Palette, Sparkles, UserCircle, Wrench } from 'lucide-react'
import { Switch } from '@flicktionary/ui/components/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@flicktionary/ui/components/select'
import { i18nConfig } from '@flicktionary/i18n/i18n-config'
import { findSupportedLanguage } from '@flicktionary/core/constants/supported-languages'
import { getUserEmail, useAuthStore } from '@/stores/auth-store'
import { useThemeStore, type ThemePref } from '@/stores/theme-store'
import { activateLocale, resolveUiLocale } from '@/lib/i18n/i18n'
import { checkIsTestUser } from '@/utils/test-users-utils'
import {
  useGetUserPrefs,
  useSetLlmHighlightsEnabled,
  useSetUiLanguage,
  useSetUiTheme,
} from '@/features/sessions/api/sessions-hooks'
import { PracticeSessionLimitsSetting } from '@/features/settings/components/practice-session-limits-setting'
import { Route as AdminSettingsRoute } from '@/app/routes/_authenticated/admin-settings'
import { Route as DangerZoneRoute } from '@/app/routes/_authenticated/profile/danger-zone'
import { MoreListSection } from './more-list-section'
import { MoreListRow } from './more-list-row'

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

  const handleSignOut = async () => {
    await signOut(() => navigate({ to: '/login' }))
    toast.success(t`Sign out success`)
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
    <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6'>
      <h1 className='text-2xl font-bold'>{t`More`}</h1>

      <MoreListSection title={t`General`}>
        <MoreListRow
          icon={UserCircle}
          label={t`Account`}
          description={t`Profile, subscription, sign-in`}
          onPress={() => navigate({ to: '/more/account' })}
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
        {prefs && (
          <PracticeSessionLimitsSetting
            maxNewTerms={prefs.practiceMaxNewTerms}
            maxReviewTerms={prefs.practiceMaxReviewTerms}
          />
        )}
      </MoreListSection>

      <MoreListSection title={t`About`}>
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
    </div>
  )
}
