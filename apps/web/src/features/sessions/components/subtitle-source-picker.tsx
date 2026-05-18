import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { OptionCard } from '@/components/ui/option-card'
import { useImportFromOpenSubtitles, useSearchOpenSubtitles, useUploadSrt } from '../api/sessions-hooks'
import { useDetectLanguage } from '../api/languages-hooks'
import { SrtUploadInput } from './srt-upload-input'

// Strip SRT timecodes / sequence numbers / inline tags so the detector sees pure dialogue.
const SRT_LINE_PATTERN = /^\s*(\d+|\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3})\s*$/
const stripSrtForDetection = (srt: string): string =>
  srt
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !SRT_LINE_PATTERN.test(line))
    .map((line) => line.replace(/<[^>]+>/g, ''))
    .slice(0, 30)
    .join(' ')

export type ImportedTrack = {
  trackId: string
  language: string
  segmentCount: number
}

type OpenSubtitlesStepProps = {
  contentSourceId: string
  tmdbId: number
  language: string
  onImported: (track: ImportedTrack) => void
}

export const OpenSubtitlesStep = ({ contentSourceId, tmdbId, language, onImported }: OpenSubtitlesStepProps) => {
  const { t } = useLingui()
  const trimmed = language.trim()
  const { data: results, isFetching } = useSearchOpenSubtitles(
    trimmed.length > 0 ? { tmdbId, language: trimmed } : null
  )
  const { mutate: importFromOs, isPending: isImporting } = useImportFromOpenSubtitles()
  const [importingFileId, setImportingFileId] = useState<number | null>(null)

  const handlePick = (fileId: number, trackLanguage: string) => {
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
        onSettled: () => setImportingFileId(null),
      }
    )
  }

  const languageName = getLanguageName(trimmed)

  return (
    <div className='flex flex-col gap-3'>
      {isFetching && <p className='text-muted-foreground text-sm'>{t`Searching OpenSubtitles…`}</p>}
      {!isFetching && (results?.length ?? 0) === 0 && (
        <p className='text-muted-foreground text-sm'>
          {t`No tracks found in ${languageName}. Try uploading a .srt file instead.`}
        </p>
      )}
      {(results ?? []).slice(0, 12).map((track) => {
        const badges = [`${track.downloadCount} ${t`downloads`}`]
        if (track.uploaderName) badges.push(track.uploaderName)
        if (track.hearingImpaired) badges.push(t`HI`)
        const description = badges.join(' · ')
        return (
          <OptionCard
            key={track.fileId}
            variant='navigation'
            title={track.release}
            description={description}
            badge={track.language.toUpperCase()}
            disabled={isImporting && importingFileId !== track.fileId}
            onSelect={() => handlePick(track.fileId, track.language)}
          />
        )
      })}
      {importingFileId !== null && <p className='text-muted-foreground text-sm'>{t`Importing…`}</p>}
    </div>
  )
}

type SrtUploadStepProps = {
  contentSourceId: string
  defaultLanguage: string
  onImported: (track: ImportedTrack) => void
}

export const SrtUploadStep = ({ contentSourceId, defaultLanguage, onImported }: SrtUploadStepProps) => {
  const { t } = useLingui()
  const { mutate: uploadSrt, isPending: isUploading } = useUploadSrt()
  const { mutateAsync: detectLanguageAsync, isPending: isDetecting } = useDetectLanguage()

  const handleFile = async (srtContent: string) => {
    let detected: string | null = null
    try {
      const response = await detectLanguageAsync({ text: stripSrtForDetection(srtContent) })
      detected = response.data.code
    } catch {
      // detection is advisory — fall through to defaultLanguage
    }
    const langToUse = detected ?? defaultLanguage
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
      <p className='text-muted-foreground text-sm'>
        {t`We support .srt subtitle files. The language is detected automatically from the file contents.`}
      </p>
      <SrtUploadInput onLoaded={(content) => void handleFile(content)} disabled={isUploading || isDetecting} />
      {(isDetecting || isUploading) && (
        <p className='text-muted-foreground text-sm'>{isDetecting ? t`Detecting language…` : t`Uploading…`}</p>
      )}
    </div>
  )
}
