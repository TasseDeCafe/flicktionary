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
  useCreateStudySession,
  useGetUserPrefs,
  useSetCefrForLanguage,
  useSetNativeLanguage,
} from '../api/sessions-hooks'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { TextPasteInput } from './text-paste-input'
import { CefrPromptDialog } from './cefr-prompt-dialog'

type ImportedTrack = {
  trackId: string
  language: string
  segmentCount: number
}

export const NewTextSessionWizard = () => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const [contentSourceId, setContentSourceId] = useState<string | null>(null)
  const [importedTrack, setImportedTrack] = useState<ImportedTrack | null>(null)
  const [showCefrDialog, setShowCefrDialog] = useState(false)

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setNativeLanguage } = useSetNativeLanguage()
  const { mutate: setCefr } = useSetCefrForLanguage()
  const { mutate: createSession, isPending: isCreatingSession } = useCreateStudySession()

  const cefrForTrack =
    importedTrack && prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === importedTrack.language)?.cefrLevel

  const handleImported = (sourceId: string, track: ImportedTrack) => {
    setContentSourceId(sourceId)
    setImportedTrack(track)
  }

  const startSession = (cefrLevel: string, nativeLanguage: string) => {
    if (!contentSourceId || !importedTrack) return
    createSession(
      {
        contentSourceId,
        textTrackId: importedTrack.trackId,
        nativeLanguage,
        targetLanguage: importedTrack.language,
        cefrLevel,
      },
      {
        onSuccess: (response) => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id } })
        },
      }
    )
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
    startSession(existingCefr, prefs.nativeLanguage)
  }

  const handleCefrSubmit = (level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2') => {
    if (!importedTrack || !prefs?.nativeLanguage || !contentSourceId) return
    setCefr(
      { targetLanguage: importedTrack.language, cefrLevel: level },
      {
        onSuccess: () => {
          setShowCefrDialog(false)
          startSession(level, prefs.nativeLanguage!)
        },
      }
    )
  }

  return (
    <ModalScreen onClose={() => navigate({ to: '/sessions' })} title={t`Practice with a text`}>
      <div className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6'>
        {/* Step 1 — paste text */}
        <Card>
          <CardHeader>
            <CardTitle>1. {t`Paste a text`}</CardTitle>
          </CardHeader>
          <CardContent>
            {importedTrack ? (
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-medium'>{t`Text imported`}</div>
                  <div className='text-muted-foreground text-sm'>
                    {getLanguageName(importedTrack.language)} · {importedTrack.segmentCount} {t`segments`}
                  </div>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    setImportedTrack(null)
                    setContentSourceId(null)
                  }}
                >
                  {t`Change`}
                </Button>
              </div>
            ) : (
              <TextPasteInput onImported={handleImported} defaultLanguage={prefs?.nativeLanguage ?? 'en'} />
            )}
          </CardContent>
        </Card>

        {/* Step 2 — finalize */}
        {importedTrack && (
          <Card>
            <CardHeader>
              <CardTitle>2. {t`Start session`}</CardTitle>
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
    </ModalScreen>
  )
}
