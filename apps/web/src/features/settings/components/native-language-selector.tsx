import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { LanguagePicker } from '@/components/language-picker'
import { useSetNativeLanguage } from '@/features/sessions/api/sessions-hooks'

type Props = {
  currentValue: string | null
}

export const NativeLanguageSelector = ({ currentValue }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useSetNativeLanguage()

  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor='settings-native-language' className='text-sm font-medium'>{t`Native language`}</Label>
      <p className='text-muted-foreground text-xs'>{t`Used as your L1 in the LLM prompts.`}</p>
      <div className='max-w-xs'>
        <LanguagePicker
          id='settings-native-language'
          value={currentValue}
          disabled={isPending}
          onChange={(code) => {
            if (code === currentValue) return
            mutate({ nativeLanguage: code })
          }}
        />
      </div>
    </div>
  )
}
