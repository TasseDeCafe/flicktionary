import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import {
  useFinalizePracticeText,
  useGenerateNextPracticeText,
  useGetPracticeSession,
  useRatePracticeChunk,
} from '../api/practice-hooks'
import { AnnotatedText, type AnnotationInput } from './annotated-text'
import { RateSheet, type RateSheetChunkContent } from './rate-sheet'
import type { RateValue } from '@/components/ui/rate-buttons'

export const PracticeSessionView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { practiceSessionId } = useParams({ from: '/_authenticated/_app/practice/$practiceSessionId' })

  const { data: sessionData, isLoading } = useGetPracticeSession(practiceSessionId)
  const { mutate: generateNextText, isPending: isGenerating } = useGenerateNextPracticeText(practiceSessionId)
  const { mutate: rateChunk } = useRatePracticeChunk()
  const { mutate: finalizeText, isPending: isFinalizing } = useFinalizePracticeText(practiceSessionId)

  // Local set of annotation indices the user has explicitly rated this text.
  const [rated, setRated] = useState<Set<number>>(new Set())
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  // True from the moment Next is clicked until the new text lands in cache.
  // Hides the previous text and gates the auto-trigger effect so we don't
  // flash a stale text or double-fire the LLM call.
  const [isAdvancing, setIsAdvancing] = useState(false)

  const currentText = sessionData?.currentText ?? null
  const currentTextId = currentText?.id ?? null

  // Auto-trigger generation if the session has no current text and isn't done.
  useEffect(() => {
    if (!sessionData) return
    if (currentText) return
    if (done) return
    if (isGenerating) return
    if (isAdvancing) return
    generateNextText(
      { sessionId: practiceSessionId },
      {
        onSuccess: (response) => {
          if (response.data.done) setDone(true)
        },
      }
    )
  }, [sessionData, currentText, done, isGenerating, isAdvancing, generateNextText, practiceSessionId])

  // Reset rated state when the text changes.
  useEffect(() => {
    setRated(new Set())
    setOpenIndex(null)
  }, [currentTextId])

  const annotations: AnnotationInput[] = useMemo(() => {
    if (!currentText) return []
    return currentText.annotations.map((a, i) => ({
      index: i,
      headword: a.headword,
      sense: a.sense,
      surfaceForm: a.surfaceForm,
      charStart: a.charStart,
      charEnd: a.charEnd,
      rated: rated.has(i),
    }))
  }, [currentText, rated])

  const openChunk: RateSheetChunkContent | null = useMemo(() => {
    if (openIndex == null || !currentText) return null
    const ann = currentText.annotations[openIndex]
    if (!ann) return null
    // We don't have translation/definition/example client-side without an
    // extra fetch. The MVP shows the headword + sense + surface_form only;
    // the next iteration can wire a per-chunk content fetch (cards.findByKey
    // or a dedicated practice.getChunkContent endpoint).
    return {
      headword: ann.headword,
      sense: ann.sense,
      translation: null,
      definition: null,
      targetExample: null,
      nativeExample: null,
    }
  }, [openIndex, currentText])

  const handleAnnotationClick = (index: number) => {
    setOpenIndex(index)
  }

  const handleRate = (rating: RateValue) => {
    if (openIndex == null || !currentText) return
    const ann = currentText.annotations[openIndex]
    if (!ann) return
    rateChunk(
      {
        textId: currentText.id,
        headword: ann.headword,
        sense: ann.sense,
        rating,
      },
      {
        onSuccess: () => {
          setRated((prev) => {
            const next = new Set(prev)
            next.add(openIndex)
            return next
          })
          setOpenIndex(null)
        },
      }
    )
  }

  const handleNext = () => {
    if (!currentText) return
    setIsAdvancing(true)
    finalizeText(
      { textId: currentText.id },
      {
        onSuccess: () => {
          generateNextText(
            { sessionId: practiceSessionId },
            {
              onSuccess: (response) => {
                if (response.data.done) setDone(true)
                setIsAdvancing(false)
              },
              onError: () => setIsAdvancing(false),
            }
          )
        },
        onError: () => setIsAdvancing(false),
      }
    )
  }

  const close = () => navigate({ to: '/practice' })

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Practice`}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-y-auto px-4 py-6'>
          <div className='mx-auto flex max-w-2xl flex-col gap-6'>
            {isLoading && <div className='py-12 text-center text-sm text-gray-500'>{t`Loading…`}</div>}

            {!isLoading && done && (
              <div className='flex flex-col items-center gap-3 rounded-xl border bg-yellow-50 p-8 text-center'>
                <CheckCircle2 className='h-10 w-10 text-yellow-600' />
                <h2 className='text-lg font-semibold'>{t`All caught up`}</h2>
                <p className='text-sm text-gray-700'>
                  {t`You've reviewed every due chunk for this language. Come back later when more are ready.`}
                </p>
                <Button onClick={close}>{t`Back to Practice`}</Button>
              </div>
            )}

            {!isLoading && !done && (isAdvancing || !currentText) && (
              <div className='flex flex-col items-center gap-3 py-12 text-center text-sm text-gray-600'>
                <Sparkles className='h-6 w-6 animate-pulse text-yellow-500' />
                {isAdvancing ? t`Generating the next text…` : t`Preparing the session…`}
              </div>
            )}

            {!isLoading && !isAdvancing && currentText && currentText.body && (
              <article className='rounded-xl border bg-white p-5 shadow-sm'>
                {currentText.generationWarning && (
                  <p className='text-muted-foreground mb-3 text-xs italic'>{currentText.generationWarning}</p>
                )}
                <AnnotatedText
                  body={currentText.body}
                  annotations={annotations}
                  onAnnotationClick={handleAnnotationClick}
                />
              </article>
            )}
          </div>
        </div>

        {!done && currentText && !isAdvancing && (
          <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
            <div className='mx-auto flex max-w-2xl items-center justify-between gap-3'>
              {(() => {
                const ratedCount = rated.size
                const totalCount = annotations.length
                return (
                  <span className='text-muted-foreground text-xs'>
                    {t`${ratedCount} of ${totalCount} rated. Untapped chunks count as 'good' on Next.`}
                  </span>
                )
              })()}
              <Button onClick={handleNext} disabled={isFinalizing || isGenerating} size='lg'>
                {t`Next text`}
                <ArrowRight className='ml-1 h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </div>

      <RateSheet
        open={openIndex !== null}
        onOpenChange={(open) => {
          if (!open) setOpenIndex(null)
        }}
        chunk={openChunk}
        onSubmit={handleRate}
      />
    </ModalScreen>
  )
}
