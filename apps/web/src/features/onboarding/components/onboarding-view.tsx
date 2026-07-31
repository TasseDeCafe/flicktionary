import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { LanguageOptionList } from '@/components/language-option-list'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
import { useCompleteOnboarding } from '@/features/sessions/api/sessions-hooks'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { detectBrowserLanguage } from '@/utils/browser-language-utils'

type Step = 'pick' | 'welcome'

interface OnboardingViewProps {
  // 'web' (default) is the standalone route: finishing navigates to /sessions.
  // 'extensionPair' / 'telegramPair' embed the same wizard in their pairing
  // pages: the two-step sequence is identical, but finishing calls `onFinish`
  // (which posts the pairing-done signal / resumes the stashed Telegram
  // import) instead of navigating.
  variant?: 'web' | 'extensionPair' | 'telegramPair'
  onFinish?: () => void
}

export const OnboardingView = ({ variant = 'web', onFinish }: OnboardingViewProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('pick')
  const detected = detectBrowserLanguage()
  const [language, setLanguage] = useState<SupportedLanguageCode>(detected)
  const { mutate, isPending } = useCompleteOnboarding()

  const handleContinue = () => {
    mutate(
      { nativeLanguage: language },
      {
        onSuccess: () => {
          POSTHOG_EVENTS.onboardingCompleted({ variant })
          setStep('welcome')
        },
      }
    )
  }

  // The X leaves onboarding without completing it. It lands on More — the only
  // place a not-yet-onboarded user can reach — so they can sign out, delete the
  // account, or re-enter onboarding. The app itself stays gated behind the
  // mandatory values.
  const handleExit = () => {
    void navigate({ to: '/more' })
  }

  // Only reachable on the welcome step, after completeOnboarding flipped
  // is_onboarded. In the web variant the gate now lets /sessions through; in
  // the pairing variants we hand control back to the pairing page (which posts
  // the pairing-done signal / resumes the Telegram import). Calling it from
  // here — the "Get started" button — and NOT from the native-language save
  // keeps the two-step sequence intact and guarantees is_onboarded is already
  // true.
  const handleFinish = () => {
    if (variant !== 'web') {
      onFinish?.()
      return
    }
    void navigate({ to: '/dashboard' })
  }

  if (step === 'pick') {
    return (
      <WizardShell
        currentStep={1}
        totalSteps={2}
        onClose={handleExit}
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
      onClose={handleFinish}
      onBack={() => setStep('pick')}
      primary={{
        label: t`Get started`,
        onClick: handleFinish,
      }}
    >
      <WizardStepHeading
        title={t`You're all set`}
        subtitle={t`Try adding a movie or pasting a piece of text in any language to get started. You can pick the target language each time you add new content.`}
      />
    </WizardShell>
  )
}
