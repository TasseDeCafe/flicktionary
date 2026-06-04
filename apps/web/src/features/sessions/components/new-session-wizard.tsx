import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Search, Upload } from 'lucide-react'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
import { LanguageOptionList } from '@/components/language-option-list'
import {
  useCreateContentSourceFromTmdb,
  useCreateStudySession,
  useGetUserPrefs,
  useSetCefrForLanguage,
} from '../api/sessions-hooks'
import { CefrStep } from './cefr-step'
import type { CefrLevel } from '../constants/cefr'
import { TmdbSearch, type TmdbMoviePick } from './tmdb-search'
import { OpenSubtitlesStep, SrtUploadStep, type ImportedTrack } from './subtitle-source-picker'
import { getShowTranslationsEnabledForLanguage } from '../utils/show-translations-pref'

type Step = 'language' | 'cefr' | 'movie' | 'subtitle-source' | 'subtitle-pick'
type SubtitleMode = 'opensubtitles' | 'upload'

export const NewSessionWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: prefs } = useGetUserPrefs()

  const [targetLanguage, setTargetLanguage] = useState<string | null>(null)
  const [languageTouched, setLanguageTouched] = useState(false)
  // Wait for prefs to land so we can prefill the picker; the user override
  // (`languageTouched`) always wins after that.
  useEffect(() => {
    if (languageTouched) return
    if (prefs?.lastTargetLanguage && prefs.lastTargetLanguage !== targetLanguage) {
      setTargetLanguage(prefs.lastTargetLanguage)
    }
  }, [prefs?.lastTargetLanguage, languageTouched, targetLanguage])

  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)
  const [movie, setMovie] = useState<TmdbMoviePick | null>(null)
  const [contentSourceId, setContentSourceId] = useState<string | null>(null)
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode | null>(null)
  const [importedTrack, setImportedTrack] = useState<ImportedTrack | null>(null)

  const [step, setStep] = useState<Step>('language')

  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: createContentSource, isPending: isCreatingSource } = useCreateContentSourceFromTmdb()
  const { mutate: createSession, isPending: isCreatingSession } = useCreateStudySession()

  const cefrForLanguage = (lang: string): CefrLevel | undefined =>
    prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === lang)?.cefrLevel as CefrLevel | undefined

  const requiresCefrStep = !!targetLanguage && !cefrForLanguage(targetLanguage)
  const totalSteps = 4 + (requiresCefrStep ? 1 : 0)

  const stepIndex: Record<Step, number> = (() => {
    if (requiresCefrStep) {
      return { language: 1, cefr: 2, movie: 3, 'subtitle-source': 4, 'subtitle-pick': 5 }
    }
    return { language: 1, cefr: 2, movie: 2, 'subtitle-source': 3, 'subtitle-pick': 4 }
  })()

  const closeWizard = () => navigate({ to: '/sessions' })

  const startSession = (track: ImportedTrack) => {
    if (!contentSourceId || !prefs || !targetLanguage) return
    const level = cefrForLanguage(targetLanguage) ?? cefrChoice
    const showTranslations = getShowTranslationsEnabledForLanguage(prefs, track.language)
    const nativeLanguage = prefs.nativeLanguage ?? (!showTranslations ? track.language : null)
    if (!level) return
    if (!nativeLanguage) return
    createSession(
      {
        contentSourceId,
        textTrackId: track.trackId,
        nativeLanguage,
        targetLanguage: track.language,
        cefrLevel: level,
      },
      {
        onSuccess: (response) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id } })
        },
      }
    )
  }

  // === Step 1: language ===
  if (step === 'language') {
    return (
      <WizardShell
        title={t`New session`}
        currentStep={stepIndex.language}
        totalSteps={totalSteps}
        onClose={closeWizard}
        primary={{
          label: t`Continue`,
          onClick: () => {
            if (!targetLanguage) return
            setStep(requiresCefrStep ? 'cefr' : 'movie')
          },
          disabled: !targetLanguage,
        }}
      >
        <WizardStepHeading
          title={t`What language are you studying?`}
          subtitle={t`Pick the language of the movie you'll watch. Subtitles and explanations will be in this language.`}
        />
        <LanguageOptionList
          value={targetLanguage}
          pinnedCode={prefs?.lastTargetLanguage}
          onChange={(code) => {
            setLanguageTouched(true)
            setTargetLanguage(code)
          }}
        />
      </WizardShell>
    )
  }

  // === Step 2 (conditional): CEFR ===
  if (step === 'cefr' && targetLanguage) {
    return (
      <WizardShell
        title={t`New session`}
        currentStep={stepIndex.cefr}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('language')}
        primary={{
          label: isSettingCefr ? t`Saving…` : t`Continue`,
          onClick: () => {
            if (!cefrChoice) return
            setCefr(
              { targetLanguage, cefrLevel: cefrChoice },
              {
                onSuccess: () => setStep('movie'),
              }
            )
          },
          disabled: !cefrChoice || isSettingCefr,
          loading: isSettingCefr,
        }}
      >
        <CefrStep targetLanguage={targetLanguage} value={cefrChoice} onChange={setCefrChoice} />
      </WizardShell>
    )
  }

  // === Step 3: movie ===
  if (step === 'movie' && targetLanguage) {
    const handlePick = (picked: TmdbMoviePick) => {
      setMovie(picked)
      createContentSource(
        {
          tmdbId: picked.tmdbId,
          title: picked.title,
          originalTitle: picked.originalTitle,
          year: picked.year,
          posterUrl: picked.posterUrl,
          language: targetLanguage,
        },
        {
          onSuccess: (response) => {
            setContentSourceId(response.data.id)
            setStep('subtitle-source')
          },
        }
      )
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={stepIndex.movie}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep(requiresCefrStep ? 'cefr' : 'language')}
      >
        <WizardStepHeading title={t`Pick a movie`} />
        <TmdbSearch onPick={handlePick} disabled={isCreatingSource} />
        {isCreatingSource &&
          movie &&
          (() => {
            const movieTitle = movie.title
            return <p className='text-muted-foreground text-sm'>{t`Registering ${movieTitle}…`}</p>
          })()}
      </WizardShell>
    )
  }

  // === Step 4: subtitle source ===
  if (step === 'subtitle-source' && contentSourceId && targetLanguage) {
    const pickSource = (mode: SubtitleMode) => {
      setSubtitleMode(mode)
      setStep('subtitle-pick')
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={stepIndex['subtitle-source']}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => {
          setSubtitleMode(null)
          setMovie(null)
          setContentSourceId(null)
          setStep('movie')
        }}
      >
        <WizardStepHeading title={t`Choose subtitles`} />
        <div className='flex flex-col gap-2'>
          <OptionCard
            variant='navigation'
            icon={<Search />}
            title={t`Search OpenSubtitles`}
            description={t`Browse community-uploaded tracks for this movie.`}
            onSelect={() => pickSource('opensubtitles')}
          />
          <OptionCard
            variant='navigation'
            icon={<Upload />}
            title={t`Upload a .srt file`}
            description={t`Use a subtitle file you already have.`}
            onSelect={() => pickSource('upload')}
          />
        </div>
      </WizardShell>
    )
  }

  // === Step 5: subtitle pick ===
  if (step === 'subtitle-pick' && contentSourceId && targetLanguage && movie && subtitleMode) {
    const handleImported = (track: ImportedTrack) => {
      setImportedTrack(track)
      startSession(track)
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={stepIndex['subtitle-pick']}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => {
          setImportedTrack(null)
          setStep('subtitle-source')
        }}
      >
        <WizardStepHeading
          title={subtitleMode === 'opensubtitles' ? t`Pick a subtitle track` : t`Upload your .srt file`}
        />
        {subtitleMode === 'opensubtitles' && (
          <OpenSubtitlesStep
            contentSourceId={contentSourceId}
            tmdbId={movie.tmdbId}
            language={targetLanguage}
            onImported={handleImported}
          />
        )}
        {subtitleMode === 'upload' && (
          <SrtUploadStep
            contentSourceId={contentSourceId}
            defaultLanguage={targetLanguage}
            onImported={handleImported}
          />
        )}
        {(isCreatingSession || importedTrack) && (
          <p className='text-muted-foreground text-sm'>{t`Starting session…`}</p>
        )}
      </WizardShell>
    )
  }

  // Fallback — invalid state, return to step 1.
  return (
    <WizardShell title={t`New session`} currentStep={1} totalSteps={totalSteps} onClose={closeWizard}>
      <WizardStepHeading title={t`Something went wrong`} />
    </WizardShell>
  )
}
