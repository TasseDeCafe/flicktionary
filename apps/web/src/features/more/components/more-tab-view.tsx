import { useNavigate, useRouter } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { AlertOctagon, Languages, LifeBuoy, LogOut, Sparkles, UserCircle, Wrench } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'
import { useGetUserPrefs, useSetLlmHighlightsEnabled } from '@/features/sessions/api/sessions-hooks'
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

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setLlmHighlights, isPending: isSavingLlm } = useSetLlmHighlightsEnabled()

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
          description={t`Let the model surface terms at your level on Process`}
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
        <MoreListRow icon={Wrench} label={t`Admin settings`} onPress={() => navigate({ to: AdminSettingsRoute.to })} />
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
