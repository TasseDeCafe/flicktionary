import { useEffect, useMemo, useRef, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Clapperboard, Search, Tv, Upload } from 'lucide-react'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { WizardShell, WizardStepHeading } from '@/components/ui/wizard-shell'
import { LanguageOptionList } from '@/components/language-option-list'
import {
  useCreateContentSourceFromTmdb,
  useCreateContentSourceFromTmdbTv,
  useCreateStudySession,
  useGetUserPrefs,
  useListStudySessions,
  useSetCefrForLanguage,
} from '../api/sessions-hooks'
import { deriveTvShows } from '../utils/derive-tv-shows'
import { CefrStep } from './cefr-step'
import type { CefrLevel } from '../constants/cefr'
import { TmdbSearch, type TmdbMoviePick } from './tmdb-search'
import { TmdbTvSearch, type TmdbTvShowPick } from './tmdb-tv-search'
import { TvSeasonPicker, type TvSeasonPick } from './tv-season-picker'
import { TvEpisodePicker, type TvEpisodePick } from './tv-episode-picker'
import {
  OpenSubtitlesStep,
  OpenSubtitlesEpisodeStep,
  SrtUploadStep,
  type ImportedTrack,
} from './subtitle-source-picker'
import { getShowTranslationsEnabledForLanguage } from '../utils/show-translations-pref'

type Step =
  | 'language'
  | 'cefr'
  | 'content-type'
  | 'movie'
  | 'tv-show'
  | 'tv-season'
  | 'tv-episode'
  | 'subtitle-source'
  | 'subtitle-pick'
type ContentType = 'movie' | 'tv'
type SubtitleMode = 'opensubtitles' | 'upload'

const routeApi = getRouteApi('/_authenticated/_app/sessions/new')

export const NewSessionWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: prefs } = useGetUserPrefs()
  const { data: sessions } = useListStudySessions()
  const { tmdbShowId: seedShowId, tgt: seedLanguage, season: seedSeason } = routeApi.useSearch()

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
  const [contentType, setContentType] = useState<ContentType | null>(null)
  const [movie, setMovie] = useState<TmdbMoviePick | null>(null)
  const [tvShow, setTvShow] = useState<TmdbTvShowPick | null>(null)
  const [season, setSeason] = useState<TvSeasonPick | null>(null)
  const [episode, setEpisode] = useState<TvEpisodePick | null>(null)
  const [contentSourceId, setContentSourceId] = useState<string | null>(null)
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode | null>(null)
  const [importedTrack, setImportedTrack] = useState<ImportedTrack | null>(null)

  const [step, setStep] = useState<Step>('language')

  // "Add episode" shortcut: when the route carries a show seed, jump straight to
  // the episode picker with the show/season pre-filled (CEFR is already set for
  // an existing show, so that step is skipped). Reconstruct the show from the
  // cached session list. Applied once, when the data is available.
  const seedGroup = useMemo(
    () => (seedShowId != null ? deriveTvShows(sessions ?? []).find((g) => g.tmdbShowId === seedShowId) : undefined),
    [sessions, seedShowId]
  )
  const seedApplied = useRef(false)
  useEffect(() => {
    if (seedApplied.current) return
    if (seedShowId == null || !seedLanguage || seedSeason == null || !seedGroup) return
    seedApplied.current = true
    setContentType('tv')
    setTargetLanguage(seedLanguage)
    setLanguageTouched(true)
    setTvShow({
      tmdbId: seedGroup.tmdbShowId,
      title: seedGroup.showTitle,
      originalTitle: seedGroup.originalTitle ?? seedGroup.showTitle,
      year: seedGroup.year,
      posterUrl: seedGroup.posterUrl,
    })
    setSeason({ seasonNumber: seedSeason, name: '' })
    setEpisode(null)
    setStep('tv-episode')
  }, [seedShowId, seedLanguage, seedSeason, seedGroup])

  // Episodes of the selected show+season already in the user's sessions — the
  // picker marks these "Added" and highlights the first not-yet-added episode.
  const addedEpisodeNumbers = useMemo(() => {
    if (!tvShow || !season) return undefined
    const group = deriveTvShows(sessions ?? []).find((g) => g.tmdbShowId === tvShow.tmdbId)
    if (!group) return undefined
    return new Set(group.episodes.filter((e) => e.seasonNumber === season.seasonNumber).map((e) => e.episodeNumber))
  }, [sessions, tvShow, season])

  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: createContentSource, isPending: isCreatingSource } = useCreateContentSourceFromTmdb()
  const { mutate: createTvContentSource, isPending: isCreatingTvSource } = useCreateContentSourceFromTmdbTv()
  const { mutate: createSession, isPending: isCreatingSession } = useCreateStudySession()

  const cefrForLanguage = (lang: string): CefrLevel | undefined =>
    prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === lang)?.cefrLevel as CefrLevel | undefined

  const requiresCefrStep = !!targetLanguage && !cefrForLanguage(targetLanguage)

  // Branch-aware step ordering: the TV path inserts show → season → episode
  // where the movie path has a single pick step. The progress bar and back
  // navigation both derive from this array, so they stay honest in both
  // branches. Before a content type is chosen we size as the movie branch.
  const activeSteps: Step[] = [
    'language',
    ...(requiresCefrStep ? (['cefr'] as const) : []),
    'content-type',
    ...(contentType === 'tv' ? (['tv-show', 'tv-season', 'tv-episode'] as const) : (['movie'] as const)),
    'subtitle-source',
    'subtitle-pick',
  ]
  const totalSteps = activeSteps.length
  const currentStep = Math.max(activeSteps.indexOf(step), 0) + 1
  const prevStep = (): Step => activeSteps[Math.max(activeSteps.indexOf(step) - 1, 0)]!

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

  // === Step: language ===
  if (step === 'language') {
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        primary={{
          label: t`Continue`,
          onClick: () => {
            if (!targetLanguage) return
            setStep(requiresCefrStep ? 'cefr' : 'content-type')
          },
          disabled: !targetLanguage,
        }}
      >
        <WizardStepHeading
          title={t`What language are you studying?`}
          subtitle={t`Pick the language of the movie or show you'll watch. Subtitles and explanations will be in this language.`}
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

  // === Step (conditional): CEFR ===
  if (step === 'cefr' && targetLanguage) {
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
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
                onSuccess: () => setStep('content-type'),
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

  // === Step: content type (movie vs TV) ===
  if (step === 'content-type' && targetLanguage) {
    const pickType = (type: ContentType) => {
      setContentType(type)
      setStep(type === 'tv' ? 'tv-show' : 'movie')
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep(prevStep())}
      >
        <WizardStepHeading
          title={t`What are you watching?`}
          subtitle={t`We'll find subtitles for it — this doesn't play the video.`}
        />
        <div className='flex flex-col gap-2'>
          <OptionCard
            variant='navigation'
            icon={<Clapperboard />}
            title={t`Movie`}
            description={t`A single film.`}
            onSelect={() => pickType('movie')}
          />
          <OptionCard
            variant='navigation'
            icon={<Tv />}
            title={t`TV show`}
            description={t`Pick a season and episode.`}
            onSelect={() => pickType('tv')}
          />
        </div>
      </WizardShell>
    )
  }

  // === Step: movie ===
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
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('content-type')}
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

  // === Step: TV show ===
  if (step === 'tv-show' && targetLanguage) {
    const handlePick = (picked: TmdbTvShowPick) => {
      setTvShow(picked)
      setSeason(null)
      setEpisode(null)
      setStep('tv-season')
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('content-type')}
      >
        <WizardStepHeading title={t`Pick a TV show`} />
        <TmdbTvSearch onPick={handlePick} />
      </WizardShell>
    )
  }

  // === Step: TV season ===
  if (step === 'tv-season' && targetLanguage && tvShow) {
    const handlePick = (picked: TvSeasonPick) => {
      setSeason(picked)
      setEpisode(null)
      setStep('tv-episode')
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('tv-show')}
      >
        <WizardStepHeading title={t`Pick a season`} subtitle={tvShow.title} />
        <TvSeasonPicker tmdbShowId={tvShow.tmdbId} onPick={handlePick} />
      </WizardShell>
    )
  }

  // === Step: TV episode ===
  if (step === 'tv-episode' && targetLanguage && tvShow && season) {
    const seasonNumber = season.seasonNumber
    const handlePick = (picked: TvEpisodePick) => {
      setEpisode(picked)
      createTvContentSource(
        {
          tmdbShowId: tvShow.tmdbId,
          showTitle: tvShow.title,
          originalTitle: tvShow.originalTitle,
          seasonNumber: season.seasonNumber,
          episodeNumber: picked.episodeNumber,
          episodeTitle: picked.name,
          year: tvShow.year,
          posterUrl: tvShow.posterUrl,
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
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={() => setStep('tv-season')}
      >
        <WizardStepHeading title={t`Pick an episode`} subtitle={season.name || t`Season ${seasonNumber}`} />
        <TvEpisodePicker
          tmdbShowId={tvShow.tmdbId}
          seasonNumber={season.seasonNumber}
          onPick={handlePick}
          disabled={isCreatingTvSource}
          addedEpisodeNumbers={addedEpisodeNumbers}
        />
        {isCreatingTvSource && <p className='text-muted-foreground text-sm'>{t`Registering episode…`}</p>}
      </WizardShell>
    )
  }

  // === Step: subtitle source ===
  if (step === 'subtitle-source' && contentSourceId && targetLanguage) {
    const pickSource = (mode: SubtitleMode) => {
      setSubtitleMode(mode)
      setStep('subtitle-pick')
    }
    const backToPick = () => {
      setSubtitleMode(null)
      setContentSourceId(null)
      if (contentType === 'tv') {
        setEpisode(null)
        setStep('tv-episode')
      } else {
        setMovie(null)
        setStep('movie')
      }
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onClose={closeWizard}
        onBack={backToPick}
      >
        <WizardStepHeading title={t`Choose subtitles`} />
        <div className='flex flex-col gap-2'>
          <OptionCard
            variant='navigation'
            icon={<Search />}
            title={t`Search OpenSubtitles`}
            description={t`Browse community-uploaded tracks.`}
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

  // === Step: subtitle pick ===
  const hasPick = contentType === 'tv' ? !!(tvShow && season && episode) : !!movie
  if (step === 'subtitle-pick' && contentSourceId && targetLanguage && hasPick && subtitleMode) {
    const handleImported = (track: ImportedTrack) => {
      setImportedTrack(track)
      startSession(track)
    }
    return (
      <WizardShell
        title={t`New session`}
        currentStep={currentStep}
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
        {subtitleMode === 'opensubtitles' &&
          (contentType === 'tv' && tvShow && season && episode ? (
            <OpenSubtitlesEpisodeStep
              contentSourceId={contentSourceId}
              tmdbShowId={tvShow.tmdbId}
              seasonNumber={season.seasonNumber}
              episodeNumber={episode.episodeNumber}
              language={targetLanguage}
              onImported={handleImported}
            />
          ) : (
            movie && (
              <OpenSubtitlesStep
                contentSourceId={contentSourceId}
                tmdbId={movie.tmdbId}
                language={targetLanguage}
                onImported={handleImported}
              />
            )
          ))}
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
