import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { isSupportedLanguageCode, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { LanguagePicker } from '@/components/language-picker'
import { useCompleteOnboarding } from '@/features/sessions/api/sessions-hooks'

const detectBrowserLanguage = (): SupportedLanguageCode => {
  if (typeof navigator === 'undefined') return 'en'
  const raw = navigator.language?.split('-')[0]?.toLowerCase()
  return raw && isSupportedLanguageCode(raw) ? raw : 'en'
}

type Step = 'pick' | 'welcome'

export const OnboardingView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('pick')
  const [language, setLanguage] = useState<SupportedLanguageCode>(detectBrowserLanguage())
  const { mutate, isPending } = useCompleteOnboarding()

  const handleContinue = () => {
    mutate({ nativeLanguage: language }, { onSuccess: () => setStep('welcome') })
  }

  const handleGetStarted = () => {
    navigate({ to: '/sessions' })
  }

  return (
    <div className='flex h-dvh w-full flex-col items-center justify-center bg-white px-6'>
      <div className='w-full max-w-md'>
        {step === 'pick' && (
          <div className='flex flex-col gap-6'>
            <div className='flex flex-col gap-2'>
              <h1 className='text-2xl font-semibold'>{t`Welcome to Flicktionary`}</h1>
              <p className='text-muted-foreground text-sm'>
                {t`What language do you speak natively? This is the language Flicktionary will translate words and phrases into.`}
              </p>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='onboarding-native-language' className='text-sm font-medium'>
                {t`Your native language`}
              </Label>
              <LanguagePicker
                id='onboarding-native-language'
                value={language}
                disabled={isPending}
                onChange={(code) => setLanguage(code)}
              />
            </div>
            <Button onClick={handleContinue} disabled={isPending} className='w-full'>
              {t`Continue`}
            </Button>
          </div>
        )}
        {step === 'welcome' && (
          <div className='flex flex-col gap-6'>
            <div className='flex flex-col gap-2'>
              <h1 className='text-2xl font-semibold'>{t`You're all set`}</h1>
              <p className='text-muted-foreground text-sm'>
                {t`Try adding a movie or pasting a piece of text in any language to get started. You can pick the target language each time you add new content.`}
              </p>
            </div>
            <Button onClick={handleGetStarted} className='w-full'>
              {t`Get started`}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
