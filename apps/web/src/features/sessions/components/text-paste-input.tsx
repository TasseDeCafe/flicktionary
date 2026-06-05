import { useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { LanguageSelectField } from '@/components/language-select-field'
import { useDetectLanguage } from '../api/languages-hooks'
import { useDebouncedValue } from '../hooks/use-debounced-value'

import {
  TEXT_PASTE_MAX_LENGTH,
  TEXT_PASTE_MIN_LENGTH,
  TEXT_PASTE_TITLE_MAX_LENGTH,
  suggestTitleFromText,
} from './text-paste-helpers'

type Props = {
  text: string
  setText: (text: string) => void
  title: string
  setTitle: (title: string) => void
  // `setTitleTouched(true)` is called once the user types in the title, so the
  // auto-suggestion stops overwriting their edits.
  titleTouched: boolean
  setTitleTouched: (touched: boolean) => void
  language: string
  setLanguage: (language: string) => void
  languageTouched: boolean
  setLanguageTouched: (touched: boolean) => void
  disabled?: boolean
}

export const TextPasteFields = ({
  text,
  setText,
  title,
  setTitle,
  titleTouched,
  setTitleTouched,
  language,
  setLanguage,
  languageTouched,
  setLanguageTouched,
  disabled,
}: Props) => {
  const { t } = useLingui()
  const { mutate: detectLanguageMutation } = useDetectLanguage()

  // Auto-suggest a title from the paste; the user can override.
  useEffect(() => {
    if (titleTouched) return
    setTitle(suggestTitleFromText(text))
  }, [text, titleTouched, setTitle])

  // Auto-detect language via the backend Haiku call once the user pauses typing.
  // Skip once the user manually picks — their override always wins.
  const debouncedText = useDebouncedValue(text, 300)
  useEffect(() => {
    if (languageTouched) return
    if (debouncedText.trim().length === 0) return
    detectLanguageMutation(
      { text: debouncedText },
      {
        onSuccess: (response) => {
          if (languageTouched) return
          const code = response.data.code
          if (code && code !== language) setLanguage(code)
        },
      }
    )
  }, [debouncedText, languageTouched, language, detectLanguageMutation, setLanguage])

  const charCount = text.length

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='paste-text'>{t`Paste your text`}</Label>
        <Textarea
          id='paste-text'
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          placeholder={t`Paste a Reddit comment, news excerpt, Telegram post…`}
          rows={10}
          maxLength={TEXT_PASTE_MAX_LENGTH}
          className='min-h-48 font-mono text-base'
        />
        <div className='text-muted-foreground flex justify-between text-xs'>
          <span>{t`${charCount} / ${TEXT_PASTE_MAX_LENGTH} characters`}</span>
          {charCount > 0 && charCount < TEXT_PASTE_MIN_LENGTH && (
            <span className='text-amber-700 dark:text-amber-300'>{t`At least ${TEXT_PASTE_MIN_LENGTH} characters needed`}</span>
          )}
        </div>
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='paste-title'>{t`Title`}</Label>
        <Input
          id='paste-title'
          value={title}
          disabled={disabled}
          onChange={(e) => {
            setTitleTouched(true)
            setTitle(e.target.value)
          }}
          maxLength={TEXT_PASTE_TITLE_MAX_LENGTH}
          placeholder={t`A short label for this session`}
        />
      </div>

      <LanguageSelectField
        label={t`Language of the text`}
        value={language}
        disabled={disabled}
        onChange={(code) => {
          setLanguageTouched(true)
          setLanguage(code)
        }}
      />
    </div>
  )
}
