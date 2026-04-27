import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { LanguagePicker } from '@/components/language-picker'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { toast } from 'sonner'
import {
  useCreateContentSourceFromTmdb,
  useCreateStudySession,
  useGetUserPrefs,
  useSetCefrForLanguage,
  useSetNativeLanguage,
} from '../api/sessions-hooks'
import { TmdbSearch, TmdbMoviePick } from './tmdb-search'
import { SubtitleSourcePicker } from './subtitle-source-picker'
import { CefrPromptDialog } from './cefr-prompt-dialog'

type StepKey = 'movie' | 'subtitles' | 'finalize'

type ImportedTrack = {
  trackId: string
  language: string
  segmentCount: number
}

export const NewSessionWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const [step, setStep] = useState<StepKey>('movie')
  const [movie, setMovie] = useState<TmdbMoviePick | null>(null)
  const [contentSourceId, setContentSourceId] = useState<string | null>(null)
  const [contentSourceLanguage, setContentSourceLanguage] = useState<string>('en')
  const [importedTrack, setImportedTrack] = useState<ImportedTrack | null>(null)
  const [showCefrDialog, setShowCefrDialog] = useState(false)

  const { data: prefs } = useGetUserPrefs()
  const { mutate: createContentSource, isPending: isCreatingSource } = useCreateContentSourceFromTmdb()
  const { mutate: setNativeLanguage } = useSetNativeLanguage()
  const { mutate: setCefr } = useSetCefrForLanguage()
  const { mutate: createSession, isPending: isCreatingSession } = useCreateStudySession()

  const cefrForTrack =
    importedTrack && prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === importedTrack.language)?.cefrLevel

  const handlePickMovie = (picked: TmdbMoviePick) => {
    setMovie(picked)
    createContentSource(
      {
        tmdbId: picked.tmdbId,
        title: picked.title,
        originalTitle: picked.originalTitle,
        year: picked.year,
        posterUrl: picked.posterUrl,
        language: contentSourceLanguage,
      },
      {
        onSuccess: (response) => {
          setContentSourceId(response.data.id)
          setStep('subtitles')
        },
      }
    )
  }

  const handleImported = (track: ImportedTrack) => {
    setImportedTrack(track)
    setStep('finalize')
  }

  const handleStartSession = () => {
    if (!contentSourceId || !importedTrack) return
    if (!prefs?.nativeLanguage) {
      toast.error(t`Set your native language first.`)
      return
    }
    const existingCefr = prefs.targetLanguagePrefs.find((p) => p.targetLanguage === importedTrack.language)?.cefrLevel
    if (!existingCefr) {
      setShowCefrDialog(true)
      return
    }
    createSession(
      {
        contentSourceId,
        textTrackId: importedTrack.trackId,
        nativeLanguage: prefs.nativeLanguage,
        targetLanguage: importedTrack.language,
        cefrLevel: existingCefr,
      },
      {
        onSuccess: (response) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id } })
        },
      }
    )
  }

  const handleCefrSubmit = (level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2') => {
    if (!importedTrack || !prefs?.nativeLanguage || !contentSourceId) return
    setCefr(
      { targetLanguage: importedTrack.language, cefrLevel: level },
      {
        onSuccess: () => {
          setShowCefrDialog(false)
          createSession(
            {
              contentSourceId,
              textTrackId: importedTrack.trackId,
              nativeLanguage: prefs.nativeLanguage!,
              targetLanguage: importedTrack.language,
              cefrLevel: level,
            },
            {
              onSuccess: (response) => {
                void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id } })
              },
            }
          )
        },
      }
    )
  }

  return (
    <div className='mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6'>
      <h1 className='text-2xl font-bold'>{t`New session`}</h1>

      {/* Step 1 — pick a movie */}
      <Card>
        <CardHeader>
          <CardTitle>1. {t`Pick a movie`}</CardTitle>
        </CardHeader>
        <CardContent>
          {movie ? (
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-3'>
                {movie.posterUrl && (
                  <img src={movie.posterUrl} alt={movie.title} className='h-20 w-14 rounded object-cover' />
                )}
                <div>
                  <div className='font-medium'>{movie.title}</div>
                  <div className='text-muted-foreground text-sm'>{movie.year ?? t`Unknown year`}</div>
                </div>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setMovie(null)
                  setContentSourceId(null)
                  setImportedTrack(null)
                  setStep('movie')
                }}
              >
                {t`Change`}
              </Button>
            </div>
          ) : (
            <div className='flex flex-col gap-3'>
              <div className='flex items-end gap-2'>
                <div className='flex-1'>
                  <Label htmlFor='source-language' className='text-sm'>{t`Original language`}</Label>
                  <div className='mt-1 max-w-xs'>
                    <LanguagePicker
                      id='source-language'
                      value={contentSourceLanguage}
                      onChange={(code) => setContentSourceLanguage(code)}
                    />
                  </div>
                </div>
              </div>
              <TmdbSearch onPick={handlePickMovie} />
              {isCreatingSource && <p className='text-muted-foreground text-sm'>{t`Registering movie…`}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — pick subtitles */}
      {step !== 'movie' && contentSourceId && movie && (
        <Card>
          <CardHeader>
            <CardTitle>2. {t`Choose subtitles`}</CardTitle>
          </CardHeader>
          <CardContent>
            {importedTrack ? (
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-medium'>{t`Track imported`}</div>
                  <div className='text-muted-foreground text-sm'>
                    {getLanguageName(importedTrack.language)} · {importedTrack.segmentCount} {t`segments`}
                  </div>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    setImportedTrack(null)
                    setStep('subtitles')
                  }}
                >
                  {t`Change`}
                </Button>
              </div>
            ) : (
              <SubtitleSourcePicker
                contentSourceId={contentSourceId}
                tmdbId={movie.tmdbId}
                defaultTargetLanguage={contentSourceLanguage}
                onImported={handleImported}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3 — finalize */}
      {step === 'finalize' && importedTrack && (
        <Card>
          <CardHeader>
            <CardTitle>3. {t`Start session`}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {!prefs?.nativeLanguage ? (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='native-language' className='text-sm'>{t`Your native language`}</Label>
                <div className='max-w-xs'>
                  <LanguagePicker
                    id='native-language'
                    value={null}
                    onChange={(code) => setNativeLanguage({ nativeLanguage: code })}
                  />
                </div>
              </div>
            ) : (
              (() => {
                const nativeLanguage = getLanguageName(prefs.nativeLanguage)
                const trackLanguage = getLanguageName(importedTrack.language)
                const cefrLabel = cefrForTrack
                return (
                  <div className='text-muted-foreground text-sm'>
                    {t`Native language: ${nativeLanguage}.`}{' '}
                    {cefrLabel ? t`Level for ${trackLanguage}: ${cefrLabel}.` : t`We'll ask your level next.`}
                  </div>
                )
              })()
            )}
            <Button onClick={handleStartSession} disabled={!prefs?.nativeLanguage || isCreatingSession}>
              {isCreatingSession ? t`Creating…` : t`Start session`}
            </Button>
          </CardContent>
        </Card>
      )}

      {showCefrDialog && importedTrack && (
        <CefrPromptDialog
          open={showCefrDialog}
          targetLanguage={importedTrack.language}
          onSubmit={handleCefrSubmit}
          onCancel={() => setShowCefrDialog(false)}
        />
      )}
    </div>
  )
}
