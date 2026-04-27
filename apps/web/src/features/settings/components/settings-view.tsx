import { useLingui } from '@lingui/react/macro'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { NativeLanguageSelector } from './native-language-selector'
import { CefrPerLanguageList } from './cefr-per-language-list'
import { TapToTranslateToggle } from './tap-to-translate-toggle'

export const SettingsView = () => {
  const { t } = useLingui()
  const { data: prefs, isLoading } = useGetUserPrefs()

  return (
    <div className='mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6'>
      <h1 className='text-2xl font-bold'>{t`Settings`}</h1>
      {isLoading || !prefs ? (
        <p className='text-muted-foreground text-sm'>{t`Loading…`}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t`Profile`}</CardTitle>
            </CardHeader>
            <CardContent>
              <NativeLanguageSelector currentValue={prefs.nativeLanguage} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t`Languages`}</CardTitle>
            </CardHeader>
            <CardContent>
              <CefrPerLanguageList prefs={prefs.targetLanguagePrefs} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t`Mid-watch behavior`}</CardTitle>
            </CardHeader>
            <CardContent>
              <TapToTranslateToggle enabled={prefs.tapToTranslateEnabled} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
