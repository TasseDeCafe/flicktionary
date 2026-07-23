import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ArrowRight, FileSpreadsheet, Languages, LoaderCircle, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Checkbox } from '@flicktionary/ui/components/checkbox'
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
import { shouldUseDetectedLanguage } from '@/features/sessions/utils/detected-language'
import { useCreateLessonBatch, useListTeacherProfiles } from '../api/lesson-import-hooks'
import {
  normalizeLessonFile,
  sheetsToMarkdown,
  suggestTitleFromFileName,
  type LessonSheet,
} from '../utils/normalize-lesson-file'

const TITLE_MAX = 200
const TEXT_MAX = 500_000

type Step = 'form' | 'cefr'

export const LessonImportWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: prefs } = useGetUserPrefs()
  const { data: profiles } = useListTeacherProfiles()
  const { mutate: createBatch, isPending: isCreating } = useCreateLessonBatch()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()

  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  // A multi-sheet workbook goes through a sheet picker instead of the textarea:
  // day-to-day only one sheet is new, and every selected sheet costs an
  // extraction call — so nothing is pre-selected.
  const [sheets, setSheets] = useState<LessonSheet[] | null>(null)
  const [selectedSheetIdxs, setSelectedSheetIdxs] = useState<ReadonlySet<number>>(new Set())
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [targetLanguage, setTargetLanguage] = useState<string | null>(null)
  const [languageTouched, setLanguageTouched] = useState(false)
  const [teacherProfileId, setTeacherProfileId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('form')
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)

  const effectiveTarget = targetLanguage ?? prefs?.lastTargetLanguage ?? null

  // The confirm stamps the user's CEFR level for this language onto the lesson
  // session (it calibrates card explanations), so a first import in a new
  // language asks for the level up front — same step the session wizard shows.
  const requiresCefrStep =
    !!effectiveTarget && !prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === effectiveTarget)?.cefrLevel
  const totalSteps = requiresCefrStep ? 2 : 1

  // What actually gets imported: the composed selected sheets in picker mode,
  // the textarea content otherwise. Language detection reads the same source.
  const sourceText = useMemo(
    () => (sheets ? sheetsToMarkdown(sheets.filter((_, i) => selectedSheetIdxs.has(i))) : text),
    [sheets, selectedSheetIdxs, text]
  )

  // Auto-detect the lesson language once typing/pasting settles; a manual pick
  // always wins (same pattern as the text-paste wizard).
  const { mutate: detectLanguageMutation, data: detectionResult, reset: resetDetection } = useDetectLanguage()
  const debouncedText = useDebouncedValue(sourceText, 300)
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- the trigger is the debounced text SETTLING (time-based), not a keystroke; firing detection from onChange would spam the backend per keypress
    if (languageTouched) return
    if (debouncedText.trim().length === 0) {
      resetDetection()
      return
    }
    detectLanguageMutation({ text: debouncedText.slice(0, 1000) })
  }, [debouncedText, languageTouched, detectLanguageMutation, resetDetection])

  const suggestedCode = detectionResult?.data.code ?? null
  const showLanguageHint = shouldUseDetectedLanguage({
    detectedCode: suggestedCode,
    currentLanguage: effectiveTarget,
    languageTouched,
  })
  const suggestedLanguageName = suggestedCode ? getLanguageName(suggestedCode) : ''

  // Only offer profiles for the language being imported — a Russian teacher's
  // conventions say nothing about a German file.
  const matchingProfiles = useMemo(
    () => (profiles ?? []).filter((p) => p.language === effectiveTarget),
    [profiles, effectiveTarget]
  )

  const [isReadingFile, setIsReadingFile] = useState(false)
  const handleFile = async (file: File) => {
    setIsReadingFile(true)
    try {
      // SheetJS parses synchronously and a big workbook blocks the main thread
      // for seconds — yield until after the next paint so the button's reading
      // state is actually visible before the block starts.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const normalized = await normalizeLessonFile(file)
      if (!normalized.ok) {
        toast.error(
          normalized.reason === 'unsupported' ? t`Use a .md, .txt, or .xlsx file.` : t`The file appears to be empty.`
        )
        return
      }
      if (normalized.kind === 'sheets') {
        setSheets(normalized.sheets)
        setSelectedSheetIdxs(new Set())
        setText('')
      } else {
        setText(normalized.markdown)
        setSheets(null)
      }
      setFileName(file.name)
      if (!titleTouched) setTitle(suggestTitleFromFileName(file.name))
    } finally {
      setIsReadingFile(false)
    }
  }

  const clearSheets = () => {
    setSheets(null)
    setSelectedSheetIdxs(new Set())
    setFileName(null)
  }

  const toggleSheet = (index: number) => {
    setSelectedSheetIdxs((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const selectedSheetCount = selectedSheetIdxs.size
  const sheetCount = sheets?.length ?? 0

  const trimmedText = sourceText.trim()
  // The contract caps rawText at 500k chars; a big multi-sheet selection can
  // exceed it, so refuse client-side with a hint instead of a 400 from the API.
  const selectionTooLarge = trimmedText.length > TEXT_MAX
  const canSubmit =
    !!effectiveTarget &&
    trimmedText.length > 0 &&
    !selectionTooLarge &&
    title.trim().length > 0 &&
    !isCreating &&
    !isSettingCefr

  const submitImport = (lang: string) => {
    createBatch(
      {
        targetLanguage: lang,
        sourceTitle: title.trim(),
        rawText: trimmedText,
        teacherProfileId,
      },
      {
        onSuccess: (response) => {
          const { batch } = response.data
          // A re-upload of an already-confirmed batch goes straight to its
          // session — there is no draft left to confirm.
          if (batch.status === 'confirmed' && batch.studySessionId) {
            void navigate({
              to: '/sessions/$sessionId/review',
              params: { sessionId: batch.studySessionId },
              replace: true,
            })
            return
          }
          void navigate({ to: '/lessons/import/$batchId', params: { batchId: batch.id }, replace: true })
        },
      }
    )
  }

  const handleSubmit = () => {
    if (!effectiveTarget || !canSubmit) return
    if (requiresCefrStep) {
      setStep('cefr')
      return
    }
    submitImport(effectiveTarget)
  }

  const handleCefrSubmit = () => {
    if (!cefrChoice || !effectiveTarget) return
    const lang = effectiveTarget
    setCefr({ targetLanguage: lang, cefrLevel: cefrChoice }, { onSuccess: () => submitImport(lang) })
  }

  const closeWizard = useModalScreenClose({ to: '/sessions' })

  if (step === 'cefr' && effectiveTarget) {
    return (
      <WizardShell
        title={t`Import lesson notes`}
        currentStep={2}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('form')}
        primary={{
          label: isSettingCefr || isCreating ? t`Starting…` : t`Continue`,
          onClick: handleCefrSubmit,
          disabled: !cefrChoice || isSettingCefr || isCreating,
          loading: isSettingCefr || isCreating,
        }}
      >
        <CefrStep targetLanguage={effectiveTarget} value={cefrChoice} onChange={setCefrChoice} />
      </WizardShell>
    )
  }

  return (
    <WizardShell
      title={t`Import lesson notes`}
      currentStep={1}
      totalSteps={totalSteps}
      onClose={closeWizard}
      primary={{
        label: isCreating ? t`Starting…` : t`Extract cards`,
        onClick: handleSubmit,
        disabled: !canSubmit,
        loading: isCreating,
      }}
    >
      <WizardStepHeading
        title={t`Import lesson notes`}
        subtitle={t`Paste your teacher's notes or upload the exported file. We'll turn corrections and vocabulary into proposed cards you can review before anything is saved.`}
      />

      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='lesson-text' className='text-sm'>{t`Lesson notes`}</Label>
          {sheets ? (
            /* Multi-sheet workbook: pick which sheets (lessons) to import. Each
               selected sheet is one extraction call, so day-to-day the user
               ticks only the new lesson. */
            <>
              <div className='rounded-xl border'>
                <div className='flex items-center gap-2 border-b px-3 py-2.5'>
                  <FileSpreadsheet className='text-muted-foreground size-4 shrink-0' />
                  <span className='min-w-0 flex-1 truncate text-sm font-medium'>{fileName}</span>
                  <button
                    type='button'
                    onClick={clearSheets}
                    aria-label={t`Remove file`}
                    className='text-muted-foreground hover:text-foreground -m-1 shrink-0 rounded-md p-1 transition-colors'
                  >
                    <X className='size-4' />
                  </button>
                </div>
                <div className='max-h-72 overflow-y-auto p-1.5'>
                  {sheets.map((sheet, index) => (
                    <button
                      key={index}
                      type='button'
                      onClick={() => toggleSheet(index)}
                      className='flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-50 active:bg-gray-100'
                    >
                      <Checkbox
                        checked={selectedSheetIdxs.has(index)}
                        aria-label={t`Import this sheet`}
                        tabIndex={-1}
                        className='pointer-events-none'
                      />
                      <span className='min-w-0 flex-1 truncate text-sm'>{sheet.title}</span>
                      {sheet.name !== sheet.title && (
                        <span className='text-muted-foreground shrink-0 truncate text-xs'>{sheet.name}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className='flex items-center justify-between gap-3'>
                <span className={selectionTooLarge ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
                  {selectionTooLarge
                    ? t`Too much text selected — import fewer sheets at a time`
                    : t`${selectedSheetCount} of ${sheetCount} sheets selected`}
                </span>
                <button
                  type='button'
                  className='text-foreground/70 hover:text-foreground shrink-0 text-xs font-medium underline-offset-2 transition-colors hover:underline'
                  onClick={() =>
                    setSelectedSheetIdxs(
                      selectedSheetIdxs.size === sheets.length ? new Set() : new Set(sheets.map((_, i) => i))
                    )
                  }
                >
                  {selectedSheetIdxs.size === sheets.length ? t`Deselect all` : t`Select all`}
                </button>
              </div>
            </>
          ) : (
            <Textarea
              id='lesson-text'
              value={text}
              maxLength={TEXT_MAX}
              onChange={(e) => {
                setText(e.target.value)
                setFileName(null)
              }}
              placeholder={t`Paste the lesson notes here…`}
              rows={8}
              className='text-base'
            />
          )}
          <input
            ref={fileInputRef}
            type='file'
            accept='.md,.txt,.xlsx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            className='hidden'
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
          <Button
            type='button'
            variant='secondary'
            size='xl'
            disabled={isCreating || isReadingFile}
            onClick={() => fileInputRef.current?.click()}
            className='w-full'
          >
            {isReadingFile ? <LoaderCircle className='animate-spin' /> : <Upload />}
            {isReadingFile
              ? t`Reading file…`
              : fileName
                ? t`Replace file (${fileName})`
                : t`Upload a file (.md or .xlsx)`}
          </Button>
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='lesson-title' className='text-sm'>{t`Title`}</Label>
          <Input
            id='lesson-title'
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleTouched(true)
            }}
            placeholder={t`e.g. Lessons with Yulia — June`}
            className='text-base'
          />
        </div>

        <LanguageSelectField
          label={t`Lesson language`}
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
                onClick={() => {
                  if (!suggestedCode) return
                  setTargetLanguage(suggestedCode)
                  setLanguageTouched(true)
                  resetDetection()
                }}
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

        {/* Teacher profile: optional descriptive context for the extractor.
            Rendered as a compact chip row — a select would be overkill for the
            expected 1-2 profiles per user. */}
        {matchingProfiles.length > 0 && (
          <div className='flex flex-col gap-2'>
            <Label className='text-sm'>{t`Teacher profile (optional)`}</Label>
            <div className='flex flex-wrap gap-2'>
              {matchingProfiles.map((profile) => {
                const selected = teacherProfileId === profile.id
                return (
                  <button
                    key={profile.id}
                    type='button'
                    aria-pressed={selected}
                    onClick={() => setTeacherProfileId(selected ? null : profile.id)}
                    className={
                      selected
                        ? 'border-foreground bg-muted text-foreground rounded-full border px-3 py-1.5 text-sm font-medium transition-colors'
                        : 'border-border text-foreground hover:bg-accent/40 active:bg-accent/60 rounded-full border px-3 py-1.5 text-sm transition-colors'
                    }
                  >
                    {profile.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </WizardShell>
  )
}
