import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { isSupportedLanguageCode, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { LanguageOptionList } from '@/components/language-option-list'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
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
  const detected = detectBrowserLanguage()
  const [language, setLanguage] = useState<SupportedLanguageCode>(detected)
  const { mutate, isPending } = useCompleteOnboarding()

  const handleContinue = () => {
    mutate({ nativeLanguage: language }, { onSuccess: () => setStep('welcome') })
  }

  const handleGetStarted = () => {
    void navigate({ to: '/sessions' })
  }

  if (step === 'pick') {
    return (
      <WizardShell
        currentStep={1}
        totalSteps={2}
        onClose={handleGetStarted}
        primary={{
          label: t`Continue`,
          onClick: handleContinue,
          disabled: isPending,
          loading: isPending,
        }}
      >
        <WizardStepHeading
          title={t`Welcome to Flicktionary`}
          subtitle={t`What language do you speak natively? This is the language Flicktionary will translate words and phrases into.`}
        />
        <LanguageOptionList value={language} pinnedCode={detected} onChange={(code) => setLanguage(code)} />
      </WizardShell>
    )
  }

  return (
    <WizardShell
      currentStep={2}
      totalSteps={2}
      onClose={handleGetStarted}
      onBack={() => setStep('pick')}
      primary={{
        label: t`Get started`,
        onClick: handleGetStarted,
      }}
    >
      <WizardStepHeading
        title={t`You're all set`}
        subtitle={t`Try adding a movie or pasting a piece of text in any language to get started. You can pick the target language each time you add new content.`}
      />
    </WizardShell>
  )
}
