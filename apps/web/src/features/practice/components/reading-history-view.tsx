import { useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, FileText } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type { PracticeText } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { AnnotatedText, type AnnotationInput } from './annotated-text'
import { PracticeLoader } from './practice-loader'
import { useReadingHistory } from '../api/practice-hooks'

export const ReadingHistoryView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/history/$targetLanguage' })
  const { pool } = useSearch({ from: '/_authenticated/_app/practice/history/$targetLanguage' })
  const { data: texts, isLoading } = useReadingHistory(targetLanguage, pool)
  const [selected, setSelected] = useState<PracticeText | null>(null)

  const languageName = getLanguageName(targetLanguage)
  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  const toAnnotations = (text: PracticeText): AnnotationInput[] =>
    text.annotations.map((a, i) => ({
      index: i,
      headword: a.headword,
      sense: a.sense,
      surfaceForm: a.surfaceForm,
      charStart: a.charStart,
      charEnd: a.charEnd,
      rated: false,
      deleted: !!a.deletedAt,
    }))

  if (selected) {
    return (
      <ModalScreen onClose={() => setSelected(null)} title={languageName}>
        <div className='flex flex-1 flex-col overflow-hidden'>
          <div className='bg-background border-b px-4 py-2'>
            <Button type='button' variant='ghost' size='sm' onClick={() => setSelected(null)}>
              <ChevronLeft className='h-4 w-4' />
              {t`Back to history`}
            </Button>
          </div>
          <div className='flex-1 overflow-y-auto px-4 py-6'>
            <div className='mx-auto max-w-2xl'>
              {selected.body && (
                <AnnotatedText
                  body={selected.body}
                  targetLanguage={targetLanguage}
                  enabled={false}
                  annotations={toAnnotations(selected)}
                  onAnnotationClick={() => {}}
                  onPlainSelection={() => {}}
                />
              )}
            </div>
          </div>
        </div>
      </ModalScreen>
    )
  }

  return (
    <ModalScreen onClose={close} title={t`History · ${languageName}`}>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6'>
          {isLoading && <PracticeLoader label={t`Loading history…`} />}
          {!isLoading && (!texts || texts.length === 0) && (
            <div className='text-foreground rounded-xl border bg-yellow-50 p-6 text-sm dark:bg-yellow-400/10'>
              {t`No past texts yet. Read some practice texts and they'll show up here.`}
            </div>
          )}
          {!isLoading &&
            texts &&
            texts.map((text) => (
              <button
                key={text.id}
                type='button'
                onClick={() => setSelected(text)}
                className='bg-card hover:bg-accent flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors'
              >
                <FileText className='mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400' />
                <div className='min-w-0 flex-1'>
                  <p className='line-clamp-2 text-sm'>{text.body ?? ''}</p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {new Date(text.readAt ?? text.createdAt).toLocaleDateString()} · {text.annotations.length}{' '}
                    {t`terms`}
                  </p>
                </div>
              </button>
            ))}
        </div>
      </div>
    </ModalScreen>
  )
}
