import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { BookOpen, LoaderCircle, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import { getBackendErrorCodeFromError } from '@flicktionary/api-client/utils/backend-error-utils'
import { getLanguageName, isSupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Checkbox } from '@flicktionary/ui/components/checkbox'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { LanguageSelectField } from '@/components/language-select-field'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { useDetectLanguage } from '@/features/sessions/api/languages-hooks'
import { CefrStep } from '@/features/sessions/components/cefr-step'
import type { CefrLevel } from '@/features/sessions/constants/cefr'
import { shouldUseDetectedLanguage } from '@/features/sessions/utils/detected-language'
import { useUploadBook } from '../api/books-hooks'
import { BOOK_FILE_ACCEPT, parseBookFile, type ParsedBookFile } from '../utils/parse-book-file'
import { buildBookParts, prepareChapters, type BookChapter } from '../utils/build-book-parts'

const TITLE_MAX = 300

type Step = 'file' | 'details' | 'cefr'

const suggestTitleFromFileName = (fileName: string): string =>
  fileName
    .replace(/\.(fb2\.zip|epub|fb2|fbz|mobi|azw3?|prc)$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX)

export const BookImportWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: uploadBook, isPending: isUploading } = useUploadBook()

  const [step, setStep] = useState<Step>('file')
  const [isReadingFile, setIsReadingFile] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedBookFile | null>(null)
  const [chapters, setChapters] = useState<BookChapter[]>([])
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<string | null>(null)
  const [languageTouched, setLanguageTouched] = useState(false)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)
  const [progress, setProgress] = useState(0)

  const handleFile = async (file: File) => {
    setIsReadingFile(true)
    try {
      // Yield past the next paint so the reading state shows before parsing.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const result = await parseBookFile(file)
      if (!result.ok) {
        const messageByReason = {
          unsupported: t`Use an EPUB, FB2 or MOBI file.`,
          drm: t`This book is DRM-protected. Only DRM-free files can be imported.`,
          empty: t`We couldn't find any text in this book.`,
          unreadable: t`We couldn't read this file.`,
        }
        toast.error(messageByReason[result.reason])
        return
      }
      const prepared = prepareChapters(result.book.chapters, (position) => t`Section ${position}`)
      setParsed(result.book)
      setChapters(prepared)
      setSelectedIds(new Set(prepared.filter((c) => c.includedByDefault).map((c) => c.id)))
      setFileName(file.name)
      setTitle((result.book.title ?? suggestTitleFromFileName(file.name)).slice(0, TITLE_MAX))
      const metadataLanguage = result.book.language
      setLanguage(metadataLanguage && isSupportedLanguageCode(metadataLanguage) ? metadataLanguage : null)
      setLanguageTouched(false)
      setStep('details')
    } finally {
      setIsReadingFile(false)
    }
  }

  const selectedChapters = useMemo(() => chapters.filter((c) => selectedIds.has(c.id)), [chapters, selectedIds])

  // Book metadata usually names the language; when it doesn't (or names an
  // unsupported one), detect it from the opening of the selected text. A
  // manual pick always wins.
  const detectionSample = useMemo(
    () =>
      selectedChapters
        .flatMap((c) => c.paragraphs)
        .join('\n')
        .slice(0, 1000),
    [selectedChapters]
  )
  const { mutate: detectLanguage, data: detectionResult } = useDetectLanguage()
  const needsDetection = step === 'details' && !languageTouched && language === null && detectionSample.length > 0
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- detection runs once the parsed book lands (async file parse), not on a user event
    if (needsDetection) detectLanguage({ text: detectionSample })
  }, [needsDetection, detectionSample, detectLanguage])
  const detectedCode = detectionResult?.data.code ?? null
  const effectiveLanguage = language ?? (detectedCode && isSupportedLanguageCode(detectedCode) ? detectedCode : null)
  const detectedLanguageName = detectedCode ? getLanguageName(detectedCode) : ''
  const showLanguageHint = shouldUseDetectedLanguage({
    detectedCode,
    currentLanguage: effectiveLanguage,
    languageTouched,
  })

  const requiresCefrStep =
    !!effectiveLanguage && !prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === effectiveLanguage)?.cefrLevel
  const totalSteps = requiresCefrStep ? 3 : 2

  const toggleChapter = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const trimmedTitle = title.trim()
  const canContinue =
    selectedChapters.length > 0 && trimmedTitle.length > 0 && !!effectiveLanguage && !isUploading && !isSettingCefr

  const startUpload = (bookLanguage: string) => {
    if (!parsed) return
    const parts = buildBookParts({
      chapters: selectedChapters,
      language: bookLanguage,
      fallbackTitle: (position) => t`Part ${position}`,
    })
    setProgress(0)
    uploadBook(
      {
        title: trimmedTitle,
        author: parsed.author?.slice(0, 300) ?? null,
        language: bookLanguage,
        fileName: fileName.slice(0, 500),
        parts,
        onProgress: setProgress,
      },
      {
        onSuccess: ({ sessionId }) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId }, replace: true })
        },
        onError: (error) => {
          const code = getBackendErrorCodeFromError(error)
          // The central handler already opens the create-account prompt.
          if (code === ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED) return
          if (code === 'CONTENT_BLOCKED') {
            toast.error(t`This book contains content that can't be imported.`)
            return
          }
          if (code === 'BOOK_UPLOAD_SUPERSEDED') {
            toast.error(t`This upload was restarted from another tab or device.`)
            return
          }
          toast.error(t`The book upload failed. Please try again.`)
        },
      }
    )
  }

  const handleDetailsSubmit = () => {
    if (!canContinue || !effectiveLanguage) return
    if (requiresCefrStep) {
      setStep('cefr')
      return
    }
    startUpload(effectiveLanguage)
  }

  const handleCefrSubmit = () => {
    if (!cefrChoice || !effectiveLanguage) return
    const bookLanguage = effectiveLanguage
    setCefr({ targetLanguage: bookLanguage, cefrLevel: cefrChoice }, { onSuccess: () => startUpload(bookLanguage) })
  }

  const closeWizard = useModalScreenClose({ to: '/sessions' })
  const progressPercent = Math.round(progress * 100)
  const uploadingLabel = t`Uploading… ${progressPercent}%`

  if (step === 'cefr' && effectiveLanguage) {
    return (
      <WizardShell
        title={t`Upload a book`}
        currentStep={3}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('details')}
        primary={{
          label: isUploading ? uploadingLabel : t`Start reading`,
          onClick: handleCefrSubmit,
          disabled: !cefrChoice || isSettingCefr || isUploading,
          loading: isSettingCefr || isUploading,
        }}
      >
        <CefrStep targetLanguage={effectiveLanguage} value={cefrChoice} onChange={setCefrChoice} />
      </WizardShell>
    )
  }

  if (step === 'details') {
    const selectedCount = selectedChapters.length
    const chapterCount = chapters.length
    const allSelected = selectedCount === chapterCount
    return (
      <WizardShell
        title={t`Upload a book`}
        currentStep={2}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('file')}
        primary={{
          label: isUploading ? uploadingLabel : requiresCefrStep ? t`Continue` : t`Start reading`,
          onClick: handleDetailsSubmit,
          disabled: !canContinue,
          loading: isUploading,
        }}
      >
        <WizardStepHeading
          title={t`Choose what to read`}
          subtitle={t`Notes, copyright pages and other back matter start unchecked. Long chapters are split into shorter parts.`}
        />
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='book-title' className='text-sm'>{t`Title`}</Label>
            <Input
              id='book-title'
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading}
              className='text-base'
            />
            {parsed?.author && <p className='text-muted-foreground text-sm'>{parsed.author}</p>}
          </div>

          <LanguageSelectField
            label={t`Language`}
            value={effectiveLanguage}
            onChange={(code) => {
              setLanguage(code)
              setLanguageTouched(true)
            }}
            pinnedCode={prefs?.lastTargetLanguage}
            disabled={isUploading}
            helper={
              showLanguageHint && detectedCode ? (
                <button
                  type='button'
                  className='text-muted-foreground text-left text-xs underline-offset-2 hover:underline'
                  onClick={() => {
                    setLanguage(detectedCode)
                    setLanguageTouched(true)
                  }}
                >
                  {t`Looks like ${detectedLanguageName} — use it`}
                </button>
              ) : null
            }
          />

          {/* Chapter picker: one row per chapter, back matter pre-unchecked. */}
          <div className='flex flex-col gap-2'>
            <Label className='text-sm'>{t`Chapters`}</Label>
            <div className='rounded-xl border'>
              <div className='max-h-80 overflow-y-auto p-1.5'>
                {chapters.map((chapter) => {
                  const chapterChars = chapter.charCount.toLocaleString()
                  return (
                    <button
                      key={chapter.id}
                      type='button'
                      disabled={isUploading}
                      onClick={() => toggleChapter(chapter.id)}
                      className='hover:bg-accent active:bg-accent flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors'
                    >
                      <Checkbox
                        checked={selectedIds.has(chapter.id)}
                        aria-label={t`Import this chapter`}
                        tabIndex={-1}
                        className='pointer-events-none'
                      />
                      <span className='min-w-0 flex-1 truncate text-sm'>{chapter.title}</span>
                      <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>{t`${chapterChars} chars`}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className='flex items-center justify-between gap-3'>
              <span className='text-muted-foreground text-xs'>{t`${selectedCount} of ${chapterCount} chapters selected`}</span>
              <button
                type='button'
                disabled={isUploading}
                className='text-foreground/70 hover:text-foreground shrink-0 text-xs font-medium underline-offset-2 transition-colors hover:underline'
                onClick={() => setSelectedIds(allSelected ? new Set() : new Set(chapters.map((c) => c.id)))}
              >
                {allSelected ? t`Deselect all` : t`Select all`}
              </button>
            </div>
          </div>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell title={t`Upload a book`} currentStep={1} totalSteps={totalSteps} onClose={closeWizard}>
      <WizardStepHeading
        title={t`Upload a book`}
        subtitle={t`Read a whole book chapter by chapter, with instant glosses. Works with DRM-free EPUB, FB2 and MOBI files.`}
      />
      <div className='flex flex-col items-center gap-6 py-6'>
        <div className='bg-muted flex size-16 items-center justify-center rounded-2xl'>
          <BookOpen className='text-muted-foreground size-8' />
        </div>
        <input
          ref={fileInputRef}
          type='file'
          accept={BOOK_FILE_ACCEPT}
          className='hidden'
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
        <Button
          type='button'
          size='xl'
          disabled={isReadingFile}
          onClick={() => fileInputRef.current?.click()}
          className='w-full'
        >
          {isReadingFile ? <LoaderCircle className='animate-spin' /> : <Upload />}
          {isReadingFile ? t`Reading book…` : t`Choose a book file`}
        </Button>
      </div>
    </WizardShell>
  )
}
