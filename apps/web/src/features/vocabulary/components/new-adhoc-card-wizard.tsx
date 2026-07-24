import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Languages } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { LanguageSelectField } from '@/components/language-select-field'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { useDetectLanguage } from '@/features/sessions/api/languages-hooks'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import { CefrStep } from '@/features/sessions/components/cefr-step'
import type { CefrLevel } from '@/features/sessions/constants/cefr'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'
import { shouldUseDetectedLanguage } from '@/features/sessions/utils/detected-language'
import { useCreateAdhocCard } from '../api/adhoc-hooks'

const HEADWORD_MAX = 200
const CONTEXT_MAX = 2000

type Step = 'form' | 'cefr'

export const NewAdhocCardWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: createAdhoc, isPending: isCreating } = useCreateAdhocCard()

  const cefrSetLanguages = useMemo(
    () => (prefs?.targetLanguagePrefs ?? []).map((p) => p.targetLanguage).sort(),
    [prefs]
  )
  const [targetLanguage, setTargetLanguage] = useState<string | null>(null)
  const [languageTouched, setLanguageTouched] = useState(false)
  const effectiveTarget = targetLanguage ?? prefs?.lastTargetLanguage ?? cefrSetLanguages[0] ?? null

  const [headword, setHeadword] = useState('')
  const [context, setContext] = useState('')
  const [step, setStep] = useState<Step>('form')
  // The language we need a CEFR level for (snapshotted when the backend
  // rejects with `cefr_not_set` so the picker can't shift the target
  // mid-flow).
  const [pendingCefrLanguage, setPendingCefrLanguage] = useState<string | null>(null)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)

  // The latest detection result lives on the mutation itself — no mirror state.
  const { mutate: detectLanguageMutation, data: detectionResult, reset: resetDetection } = useDetectLanguage()
  const detectionInput = useMemo(
    () => [headword.trim(), context.trim()].filter(Boolean).join('\n'),
    [headword, context]
  )
  const debouncedDetectionInput = useDebouncedValue(detectionInput, 300)
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- the trigger is the debounced input SETTLING (time-based), not a keystroke; firing detection from onChange would spam the backend per keypress
    if (languageTouched) return
    if (debouncedDetectionInput.length === 0) {
      resetDetection()
      return
    }
    detectLanguageMutation({ text: debouncedDetectionInput })
  }, [debouncedDetectionInput, languageTouched, detectLanguageMutation, resetDetection])

  const suggestedCode = detectionResult?.data.code ?? null
  const showLanguageHint = shouldUseDetectedLanguage({
    detectedCode: suggestedCode,
    currentLanguage: effectiveTarget,
    languageTouched,
  })
  const suggestedLanguageName = suggestedCode ? getLanguageName(suggestedCode) : ''
  const acceptLanguageSuggestion = () => {
    if (!suggestedCode) return
    setTargetLanguage(suggestedCode)
    setLanguageTouched(true)
    resetDetection()
  }

  const trimmedHeadword = headword.trim()
  const trimmedContext = context.trim()
  const canUseTargetOnlyMode = !getShowTranslationsEnabledForLanguage(prefs, effectiveTarget)
  const canSubmit =
    !!effectiveTarget &&
    (!!prefs?.nativeLanguage || canUseTargetOnlyMode) &&
    trimmedHeadword.length > 0 &&
    !isCreating &&
    !isSettingCefr

  const submit = (lang: string) => {
    createAdhoc(
      {
        targetLanguage: lang,
        headword: trimmedHeadword,
        context: trimmedContext.length > 0 ? trimmedContext : null,
      },
      {
        onSuccess: (response) => {
          void navigate({
            to: '/sessions/$sessionId/review/$cardId',
            params: { sessionId: response.data.sessionId, cardId: response.data.cardId },
            search: { scope: 'language' as const },
          })
        },
        onError: (err) => {
          const code =
            (err as { data?: { errors?: Array<{ code?: string; message?: string }> } })?.data?.errors?.[0]?.code ?? ''
          if (code === 'cefr_not_set') {
            setPendingCefrLanguage(lang)
            setStep('cefr')
            return
          }
          if (code === 'native_language_not_set') {
            toast.error(t`Set your native language first.`)
            return
          }
          toast.error(t`Failed to create card`)
        },
      }
    )
  }

  const handleSubmit = () => {
    if (!effectiveTarget || trimmedHeadword.length === 0) return
    submit(effectiveTarget)
  }

  const handleCefrSubmit = () => {
    if (!cefrChoice || !pendingCefrLanguage) return
    const lang = pendingCefrLanguage
    setCefr(
      { targetLanguage: lang, cefrLevel: cefrChoice },
      {
        onSuccess: () => {
          setPendingCefrLanguage(null)
          submit(lang)
        },
      }
    )
  }

  const closeWizard = useModalScreenClose({ to: '/vocabulary' })
  const requiresCefrStep =
    !!effectiveTarget && !prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === effectiveTarget)?.cefrLevel
  const totalSteps = requiresCefrStep ? 2 : 1

  if (step === 'cefr' && pendingCefrLanguage) {
    return (
      <WizardShell
        title={t`Add a word`}
        currentStep={2}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('form')}
        primary={{
          label: isSettingCefr || isCreating ? t`Saving…` : t`Continue`,
          onClick: handleCefrSubmit,
          disabled: !cefrChoice || isSettingCefr || isCreating,
          loading: isSettingCefr || isCreating,
        }}
      >
        <CefrStep targetLanguage={pendingCefrLanguage} value={cefrChoice} onChange={setCefrChoice} />
      </WizardShell>
    )
  }

  return (
    <WizardShell
      title={t`Add a word`}
      currentStep={1}
      totalSteps={totalSteps}
      onClose={closeWizard}
      primary={{
        label: isCreating || isSettingCefr ? t`Generating…` : t`Generate card`,
        onClick: handleSubmit,
        disabled: !canSubmit,
        loading: isCreating || isSettingCefr,
      }}
    >
      <WizardStepHeading title={t`Save a term`} />
      <div className='flex flex-col gap-4'>
        <LanguageSelectField
          label={t`Target language`}
          value={effectiveTarget}
          placeholder={t`Pick a language`}
          pinnedCode={prefs?.lastTargetLanguage ?? undefined}
          onChange={(code) => {
            setLanguageTouched(true)
            setTargetLanguage(code)
          }}
          helper={
            showLanguageHint && (
              <button
                type='button'
                onClick={acceptLanguageSuggestion}
                className='flex w-full items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 transition-colors hover:bg-amber-100 active:bg-amber-100'
              >
                <span className='flex min-w-0 items-center gap-2'>
                  <Languages className='size-4 shrink-0' />
                  <span className='truncate'>{t`Looks like ${suggestedLanguageName}`}</span>
                </span>
                <span className='flex shrink-0 items-center gap-1 rounded-md bg-amber-200/80 px-2.5 py-1 font-medium text-amber-900'>
                  {t`Switch`}
                  <ArrowRight className='size-3.5' />
                </span>
              </button>
            )
          }
        />

        <div className='flex flex-col gap-2'>
          <Label htmlFor='headword' className='text-sm'>{t`Word or expression`}</Label>
          <Input
            id='headword'
            value={headword}
            maxLength={HEADWORD_MAX}
            onChange={(e) => setHeadword(e.target.value)}
            placeholder={t`e.g. подоконник, ran out of, à propos`}
            autoFocus
          />
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='context' className='text-sm'>
            {t`Context (optional)`}
          </Label>
          <Textarea
            id='context'
            value={context}
            maxLength={CONTEXT_MAX}
            onChange={(e) => setContext(e.target.value)}
            placeholder={t`Where did you hear this? Paste a sentence or leave blank.`}
            rows={4}
          />
        </div>
      </div>
    </WizardShell>
  )
}
