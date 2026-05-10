import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@/components/ui/button'
import { LanguagePicker } from '@/components/language-picker'
import { useImportFromOpenSubtitles, useSearchOpenSubtitles, useUploadSrt } from '../api/sessions-hooks'
import { SrtUploadInput } from './srt-upload-input'
import { detectLanguage } from '../utils/detect-language'

// Strip SRT timecodes / sequence numbers / inline tags so franc sees pure dialogue.
const SRT_LINE_PATTERN = /^\s*(\d+|\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3})\s*$/
const stripSrtForDetection = (srt: string): string =>
  srt
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !SRT_LINE_PATTERN.test(line))
    .map((line) => line.replace(/<[^>]+>/g, ''))
    .slice(0, 30)
    .join(' ')

type ImportedTrack = {
  trackId: string
  language: string
  segmentCount: number
}

type Props = {
  contentSourceId: string
  tmdbId: number
  defaultTargetLanguage: string
  onImported: (track: ImportedTrack) => void
}

export const SubtitleSourcePicker = ({ contentSourceId, tmdbId, defaultTargetLanguage, onImported }: Props) => {
  const { t } = useLingui()
  const [targetLanguage, setTargetLanguage] = useState(defaultTargetLanguage)
  const [tab, setTab] = useState<'opensubtitles' | 'upload'>('opensubtitles')
  const language = targetLanguage.trim()

  const { data: opensubtitlesResults, isFetching } = useSearchOpenSubtitles(
    tab === 'opensubtitles' && language.length > 0 ? { tmdbId, language } : null
  )

  const { mutate: importFromOs, isPending: isImporting } = useImportFromOpenSubtitles()
  const { mutate: uploadSrt, isPending: isUploading } = useUploadSrt()
  const [importingFileId, setImportingFileId] = useState<number | null>(null)

  const handleImportOs = (fileId: number, trackLanguage: string) => {
    setImportingFileId(fileId)
    importFromOs(
      { contentSourceId, fileId, language: trackLanguage },
      {
        onSuccess: (response) => {
          onImported({
            trackId: response.data.track.id,
            language: response.data.track.language,
            segmentCount: response.data.segmentCount,
          })
        },
        onSettled: () => {
          setImportingFileId(null)
        },
      }
    )
  }

  const handleUpload = (srtContent: string, languageOverride?: string) => {
    const langToUse = languageOverride ?? language
    if (!langToUse) return
    uploadSrt(
      { contentSourceId, language: langToUse, srtContent },
      {
        onSuccess: (response) => {
          onImported({
            trackId: response.data.track.id,
            language: response.data.track.language,
            segmentCount: response.data.segmentCount,
          })
        },
      }
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <label htmlFor='target-language' className='text-sm font-medium'>{t`Target language`}</label>
        <div className='max-w-xs'>
          <LanguagePicker id='target-language' value={targetLanguage} onChange={(code) => setTargetLanguage(code)} />
        </div>
        <p className='text-muted-foreground text-xs'>{t`The chosen subtitle track must match this language.`}</p>
      </div>

      <div className='flex gap-2'>
        <Button
          variant={tab === 'opensubtitles' ? 'default' : 'outline'}
          size='sm'
          onClick={() => setTab('opensubtitles')}
        >
          {t`OpenSubtitles search`}
        </Button>
        <Button variant={tab === 'upload' ? 'default' : 'outline'} size='sm' onClick={() => setTab('upload')}>
          {t`Upload .srt`}
        </Button>
      </div>

      {tab === 'opensubtitles' && (
        <div className='flex flex-col gap-2'>
          {isFetching && <p className='text-muted-foreground text-sm'>{t`Searching OpenSubtitles…`}</p>}
          {!isFetching &&
            language &&
            (opensubtitlesResults?.length ?? 0) === 0 &&
            (() => {
              const languageName = getLanguageName(language)
              return (
                <p className='text-muted-foreground text-sm'>
                  {t`No tracks found in ${languageName}. Try uploading a .srt file instead.`}
                </p>
              )
            })()}
          <ul className='divide-y rounded-md border'>
            {(opensubtitlesResults ?? []).slice(0, 8).map((track) => (
              <li key={track.fileId} className='flex items-start gap-3 p-3'>
                <div className='min-w-0 flex-1 text-sm'>
                  <div className='font-medium break-all'>{track.release}</div>
                  <div className='text-muted-foreground text-xs'>
                    {track.language} · {track.downloadCount} {t`downloads`}
                    {track.uploaderName ? ` · ${track.uploaderName}` : ''}
                    {track.hearingImpaired ? ` · ${t`HI`}` : ''}
                  </div>
                </div>
                <Button
                  size='sm'
                  className='shrink-0'
                  disabled={isImporting}
                  onClick={() => handleImportOs(track.fileId, track.language)}
                >
                  {importingFileId === track.fileId ? t`Importing…` : t`Use`}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'upload' && (
        <div className='flex flex-col gap-3'>
          <SrtUploadInput
            onLoaded={(content) => {
              const detected = detectLanguage(stripSrtForDetection(content))
              if (detected && detected !== targetLanguage) {
                setTargetLanguage(detected)
              }
              handleUpload(content, detected ?? targetLanguage)
            }}
          />
          {isUploading && <p className='text-muted-foreground text-sm'>{t`Uploading…`}</p>}
        </div>
      )}
    </div>
  )
}
