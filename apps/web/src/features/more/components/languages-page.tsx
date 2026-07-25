import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ipaDialectsFromPrefs } from '@flicktionary/core/utils/pick-ipa'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { NativeLanguageSelector } from '@/features/settings/components/native-language-selector'
import { CefrPerLanguageList } from '@/features/settings/components/cefr-per-language-list'

export const LanguagesPage = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: prefs, isLoading } = useGetUserPrefs()

  return (
    <ModalScreen onClose={() => navigate({ to: '/more' })} closeIcon='chevron' title={t`Languages`}>
      <div className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6'>
        {isLoading || !prefs ? (
          <p className='text-muted-foreground text-sm'>{t`Loading…`}</p>
        ) : (
          <>
            <NativeLanguageSelector currentValue={prefs.nativeLanguage} />
            <CefrPerLanguageList prefs={prefs.targetLanguagePrefs} ipaDialects={ipaDialectsFromPrefs(prefs)} />
          </>
        )}
      </div>
    </ModalScreen>
  )
}
