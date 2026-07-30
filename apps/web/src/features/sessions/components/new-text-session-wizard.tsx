import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import {
  useCreateContentSourceFromText,
  useCreateStudySession,
  useGetUserPrefs,
  useImportFromPaste,
  useSetCefrForLanguage,
} from '../api/sessions-hooks'
import { CefrStep } from './cefr-step'
import type { CefrLevel } from '../constants/cefr'
import { TextPasteFields } from './text-paste-input'
import { TEXT_PASTE_MAX_LENGTH, TEXT_PASTE_MIN_LENGTH, suggestTitleFromText } from './text-paste-helpers'
import { getShowTranslationsEnabledForLanguage } from '../utils/show-translations-pref'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

type Step = 'paste' | 'cefr'

type ImportedTrack = {
  trackId: string
  language: string
  segmentCount: number
}

export const NewTextSessionWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: prefs } = useGetUserPrefs()

  // Step 1 form state.
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [language, setLanguage] = useState<string>(prefs?.lastTargetLanguage ?? 'en')
  const [languageTouched, setLanguageTouched] = useState(false)

  // Imported track (output of step 1) and CEFR (only collected in step 2).
  const [importedTrack, setImportedTrack] = useState<ImportedTrack | null>(null)
  const [contentSourceId, setContentSourceId] = useState<string | null>(null)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)

  const [step, setStep] = useState<Step>('paste')

  // Auto-suggest a title from the paste until the user edits the title field —
  // from then on their edit wins.
  const handleTextChange = (next: string) => {
    setText(next)
    if (!titleTouched) setTitle(suggestTitleFromText(next))
  }

  const { mutate: createContentSource, isPending: isCreatingSource } = useCreateContentSourceFromText()
  const { mutate: importFromPaste, isPending: isImporting } = useImportFromPaste()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: createSession, isPending: isCreatingSession } = useCreateStudySession()

  const trimmedTitle = title.trim()
  const charCount = text.length
  const isPaseSubmitting = isCreatingSource || isImporting
  const hasNativeLanguageOrTargetOnlyMode =
    !!prefs?.nativeLanguage || !getShowTranslationsEnabledForLanguage(prefs, language)
  const canSubmitPaste =
    !isPaseSubmitting &&
    hasNativeLanguageOrTargetOnlyMode &&
    charCount >= TEXT_PASTE_MIN_LENGTH &&
    charCount <= TEXT_PASTE_MAX_LENGTH &&
    trimmedTitle.length > 0

  const requiresCefrStep = !prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === language)?.cefrLevel
  const totalSteps = requiresCefrStep ? 2 : 1

  const startSession = (cefrLevel: string, nativeLanguage: string, sourceId: string, track: ImportedTrack) => {
    createSession(
      {
        contentSourceId: sourceId,
        textTrackId: track.trackId,
        nativeLanguage,
        targetLanguage: track.language,
        cefrLevel,
      },
      {
        onSuccess: (response) => {
          // Find-or-create: same track + target language resolves to the
          // existing session, with all its highlights intact.
          if (response.alreadyExisted) {
            toast.info(t`You already had a session for this — picking up where you left off.`)
          } else {
            POSTHOG_EVENTS.sessionCreated({
              study_session_id: response.data.id,
              content_type: 'text',
              target_language: track.language,
            })
          }
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id }, replace: true })
        },
      }
    )
  }

  const handlePasteSubmit = () => {
    if (!canSubmitPaste || !prefs) return
    createContentSource(
      { title: trimmedTitle, language },
      {
        onSuccess: (sourceResponse) => {
          const sourceId = sourceResponse.data.id
          setContentSourceId(sourceId)
          importFromPaste(
            { contentSourceId: sourceId, language, text },
            {
              onSuccess: (importResponse) => {
                const track: ImportedTrack = {
                  trackId: importResponse.data.track.id,
                  language: importResponse.data.track.language,
                  segmentCount: importResponse.data.segmentCount,
                }
                setImportedTrack(track)
                const existingCefr = prefs.targetLanguagePrefs.find(
                  (p) => p.targetLanguage === track.language
                )?.cefrLevel
                const showTranslations = getShowTranslationsEnabledForLanguage(prefs, track.language)
                const nativeLanguage = prefs.nativeLanguage ?? (!showTranslations ? track.language : null)
                if (!nativeLanguage) return
                if (existingCefr) {
                  startSession(existingCefr, nativeLanguage, sourceId, track)
                } else {
                  setStep('cefr')
                }
              },
              onError: () => {
                toast.error(t`Could not import the pasted text.`)
              },
            }
          )
        },
      }
    )
  }

  const handleCefrSubmit = () => {
    if (!cefrChoice || !importedTrack || !contentSourceId || !prefs) return
    const showTranslations = getShowTranslationsEnabledForLanguage(prefs, importedTrack.language)
    const nativeLanguage = prefs.nativeLanguage ?? (!showTranslations ? importedTrack.language : null)
    if (!nativeLanguage) return
    const track = importedTrack
    const sourceId = contentSourceId
    setCefr(
      { targetLanguage: track.language, cefrLevel: cefrChoice },
      {
        onSuccess: () => {
          startSession(cefrChoice, nativeLanguage, sourceId, track)
        },
      }
    )
  }

  const closeWizard = useModalScreenClose({ to: '/sessions' })

  if (step === 'cefr' && importedTrack) {
    return (
      <WizardShell
        title={t`Practice with a text`}
        currentStep={2}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('paste')}
        primary={{
          label: isSettingCefr || isCreatingSession ? t`Starting…` : t`Start session`,
          onClick: handleCefrSubmit,
          disabled: !cefrChoice || isSettingCefr || isCreatingSession,
          loading: isSettingCefr || isCreatingSession,
        }}
      >
        <CefrStep targetLanguage={importedTrack.language} value={cefrChoice} onChange={setCefrChoice} />
      </WizardShell>
    )
  }

  return (
    <WizardShell
      title={t`Practice with a text`}
      currentStep={1}
      totalSteps={totalSteps}
      onClose={closeWizard}
      primary={{
        label: isPaseSubmitting ? t`Importing…` : t`Continue`,
        onClick: handlePasteSubmit,
        disabled: !canSubmitPaste,
        loading: isPaseSubmitting,
      }}
    >
      <WizardStepHeading title={t`Paste a text`} />
      <TextPasteFields
        text={text}
        setText={handleTextChange}
        title={title}
        setTitle={setTitle}
        setTitleTouched={setTitleTouched}
        language={language}
        setLanguage={setLanguage}
        languageTouched={languageTouched}
        setLanguageTouched={setLanguageTouched}
        disabled={isPaseSubmitting}
      />
    </WizardShell>
  )
}
