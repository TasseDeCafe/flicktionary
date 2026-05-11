import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LanguagePicker } from '@/components/language-picker'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { useDetectLanguage } from '@/features/sessions/api/languages-hooks'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import { CefrPromptDialog } from '@/features/sessions/components/cefr-prompt-dialog'
import { useCreateAdhocCard } from '../api/adhoc-hooks'

const HEADWORD_MAX = 200
const CONTEXT_MAX = 2000

export const NewAdhocCardWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: createAdhoc, isPending: isCreating } = useCreateAdhocCard()

  // Prefill the picker from `lastTargetLanguage` (sticky MRU on `users`),
  // falling back to the first CEFR-set language alphabetically. The picker
  // itself spans every supported language so the user can add a word in a
  // brand-new language too — the backend returns `cefr_not_set` and we
  // surface the CEFR dialog inline.
  const cefrSetLanguages = useMemo(
    () => (prefs?.targetLanguagePrefs ?? []).map((p) => p.targetLanguage).sort(),
    [prefs]
  )
  const [targetLanguage, setTargetLanguage] = useState<string | null>(null)
  const [languageTouched, setLanguageTouched] = useState(false)
  const effectiveTarget = targetLanguage ?? prefs?.lastTargetLanguage ?? cefrSetLanguages[0] ?? null

  const [headword, setHeadword] = useState('')
  const [context, setContext] = useState('')
  const [showCefrDialog, setShowCefrDialog] = useState<string | null>(null)

  // Advisory language hint: detection runs on what the user types, but the
  // picker default (sticky MRU) stays authoritative. We only nudge when the
  // detector disagrees, and a single manual pick dismisses the nudge for the
  // rest of the session — homograph-style false positives stay non-disruptive.
  const [suggestedCode, setSuggestedCode] = useState<string | null>(null)
  const { mutate: detectLanguageMutation } = useDetectLanguage()
  const detectionInput = useMemo(
    () => [headword.trim(), context.trim()].filter(Boolean).join('\n'),
    [headword, context]
  )
  const debouncedDetectionInput = useDebouncedValue(detectionInput, 300)
  useEffect(() => {
    if (languageTouched) return
    if (debouncedDetectionInput.length === 0) {
      setSuggestedCode(null)
      return
    }
    detectLanguageMutation(
      { text: debouncedDetectionInput },
      {
        onSuccess: (response) => {
          if (languageTouched) return
          setSuggestedCode(response.data.code)
        },
      }
    )
  }, [debouncedDetectionInput, languageTouched, detectLanguageMutation])

  const showLanguageHint = !languageTouched && !!suggestedCode && suggestedCode !== effectiveTarget
  const suggestedLanguageName = suggestedCode ? getLanguageName(suggestedCode) : ''
  const acceptLanguageSuggestion = () => {
    if (!suggestedCode) return
    setTargetLanguage(suggestedCode)
    setLanguageTouched(true)
    setSuggestedCode(null)
  }

  const trimmedHeadword = headword.trim()
  const trimmedContext = context.trim()
  const canSubmit =
    !!effectiveTarget && !!prefs?.nativeLanguage && trimmedHeadword.length > 0 && !isCreating && !isSettingCefr

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
            search: { from: 'vocabulary' as const },
          })
        },
        onError: (err) => {
          // Discriminated codes: cefr_not_set, native_language_not_set, llm_failure.
          // We've suppressed the global toast for this mutation, so we own
          // the messaging here. cefr_not_set opens the inline CEFR dialog
          // (no toast — the dialog is the action). Other codes get a toast.
          const code =
            (err as { data?: { errors?: Array<{ code?: string; message?: string }> } })?.data?.errors?.[0]?.code ?? ''
          if (code === 'cefr_not_set') {
            setShowCefrDialog(lang)
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

  const handleCefrSubmit = (level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2') => {
    if (!showCefrDialog) return
    const lang = showCefrDialog
    setCefr(
      { targetLanguage: lang, cefrLevel: level },
      {
        onSuccess: () => {
          setShowCefrDialog(null)
          submit(lang)
        },
      }
    )
  }

  return (
    <ModalScreen onClose={() => navigate({ to: '/vocabulary' })} title={t`Add a word`}>
      <div className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6'>
        <Card>
          <CardHeader>
            <CardTitle>{t`Save a chunk`}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='target-language' className='text-sm'>{t`Target language`}</Label>
              <div className='max-w-xs'>
                <LanguagePicker
                  id='target-language'
                  value={effectiveTarget}
                  onChange={(code) => {
                    setLanguageTouched(true)
                    setTargetLanguage(code)
                  }}
                  placeholder={t`Pick a language`}
                />
              </div>
              {showLanguageHint && (
                <button
                  type='button'
                  onClick={acceptLanguageSuggestion}
                  className='self-start text-xs text-amber-700 underline-offset-2 hover:underline'
                >
                  {t`Looks like ${suggestedLanguageName} — switch?`}
                </button>
              )}
            </div>

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

            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {isCreating || isSettingCefr ? t`Generating…` : t`Generate card`}
            </Button>
          </CardContent>
        </Card>

        {showCefrDialog && (
          <CefrPromptDialog
            open={!!showCefrDialog}
            targetLanguage={showCefrDialog}
            onSubmit={handleCefrSubmit}
            onCancel={() => setShowCefrDialog(null)}
          />
        )}
      </div>
    </ModalScreen>
  )
}
