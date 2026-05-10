import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguagePicker } from '@/components/language-picker'
import { toast } from 'sonner'
import { useCreateContentSourceFromText, useImportFromPaste } from '../api/sessions-hooks'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import { detectLanguage } from '../utils/detect-language'

const MIN_LENGTH = 50
const MAX_LENGTH = 20_000
const TITLE_MAX_LENGTH = 200

type ImportedTrack = {
  trackId: string
  language: string
  segmentCount: number
}

type Props = {
  onImported: (contentSourceId: string, track: ImportedTrack) => void
  defaultLanguage?: string
}

const suggestTitleFromText = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 60) return compact
  const truncated = compact.slice(0, 60)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…'
}

export const TextPasteInput = ({ onImported, defaultLanguage = 'en' }: Props) => {
  const { t } = useLingui()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [language, setLanguage] = useState(defaultLanguage)
  const [languageTouched, setLanguageTouched] = useState(false)

  const { mutate: createContentSource, isPending: isCreatingSource } = useCreateContentSourceFromText()
  const { mutate: importFromPaste, isPending: isImporting } = useImportFromPaste()
  const isPending = isCreatingSource || isImporting

  // Auto-suggest a title from the paste; the user can override.
  useEffect(() => {
    if (titleTouched) return
    setTitle(suggestTitleFromText(text))
  }, [text, titleTouched])

  // Auto-detect language with franc once the textarea has enough signal.
  // Skip once the user manually picks — their override always wins.
  const debouncedText = useDebouncedValue(text, 300)
  useEffect(() => {
    if (languageTouched) return
    const detected = detectLanguage(debouncedText)
    if (detected && detected !== language) setLanguage(detected)
  }, [debouncedText, languageTouched, language])

  const charCount = text.length
  const trimmedTitle = title.trim()
  const canSubmit = !isPending && charCount >= MIN_LENGTH && charCount <= MAX_LENGTH && trimmedTitle.length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    createContentSource(
      { title: trimmedTitle, language },
      {
        onSuccess: (sourceResponse) => {
          const contentSourceId = sourceResponse.data.id
          importFromPaste(
            { contentSourceId, language, text },
            {
              onSuccess: (importResponse) => {
                onImported(contentSourceId, {
                  trackId: importResponse.data.track.id,
                  language: importResponse.data.track.language,
                  segmentCount: importResponse.data.segmentCount,
                })
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

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='paste-text'>{t`Paste your text`}</Label>
        <Textarea
          id='paste-text'
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t`Paste a Reddit comment, news excerpt, Telegram post…`}
          rows={10}
          maxLength={MAX_LENGTH}
          className='min-h-[12rem] font-mono text-sm'
        />
        <div className='text-muted-foreground flex justify-between text-xs'>
          <span>{t`${charCount} / ${MAX_LENGTH} characters`}</span>
          {charCount > 0 && charCount < MIN_LENGTH && (
            <span className='text-amber-700'>{t`At least ${MIN_LENGTH} characters needed`}</span>
          )}
        </div>
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='paste-title'>{t`Title`}</Label>
        <Input
          id='paste-title'
          value={title}
          onChange={(e) => {
            setTitleTouched(true)
            setTitle(e.target.value)
          }}
          maxLength={TITLE_MAX_LENGTH}
          placeholder={t`A short label for this session`}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='paste-language'>{t`Language of the text`}</Label>
        <div className='max-w-xs'>
          <LanguagePicker
            id='paste-language'
            value={language}
            onChange={(code) => {
              setLanguageTouched(true)
              setLanguage(code)
            }}
          />
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={!canSubmit}>
        {isPending ? t`Importing…` : t`Continue`}
      </Button>
    </div>
  )
}
