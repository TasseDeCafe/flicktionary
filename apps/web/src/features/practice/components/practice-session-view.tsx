import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import {
  useFinalizePracticeText,
  useGenerateNextPracticeText,
  useGetPracticeSession,
  usePrepareNextPracticeText,
  useRatePracticeChunk,
} from '../api/practice-hooks'
import { AnnotatedText, type AnnotationInput } from './annotated-text'
import { PracticeLoader } from './practice-loader'
import { RateSheet, type RateSheetChunkContent } from './rate-sheet'
import type { RateValue } from '@/components/ui/rate-buttons'

export const PracticeSessionView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { practiceSessionId } = useParams({ from: '/_authenticated/_app/practice/$practiceSessionId' })

  const { data: sessionData, isLoading } = useGetPracticeSession(practiceSessionId)
  const { mutate: generateNextText, isPending: isGenerating } = useGenerateNextPracticeText(practiceSessionId)
  const { mutate: rateChunk, isPending: isRating } = useRatePracticeChunk(practiceSessionId)
  const { mutate: finalizeText, isPending: isFinalizing } = useFinalizePracticeText(practiceSessionId)
  const { mutate: prepareNextText } = usePrepareNextPracticeText()

  // Per-text map of annotation index -> the rating the user submitted. Used
  // both to mark already-rated chunks in the body and to pre-select the
  // previous rating when the user re-opens a chunk.
  const [ratings, setRatings] = useState<Map<number, RateValue>>(new Map())
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  // True from the moment Next is clicked until the new text lands in cache.
  // Hides the previous text and gates the auto-trigger effect so we don't
  // flash a stale text or double-fire the LLM call.
  const [isAdvancing, setIsAdvancing] = useState(false)

  const currentText = sessionData?.currentText ?? null
  const currentTextId = currentText?.id ?? null
  const progress = sessionData?.progress ?? null

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
    setRatings(new Map())
    setOpenIndex(null)
  }, [currentTextId])

  // Eager pre-gen (Problem 4): kick off the next slot as soon as a fresh
  // text loads so handleNext can hand back a 'ready' row instantly. Server
  // is idempotent — repeat fires no-op.
  useEffect(() => {
    if (!currentTextId) return
    prepareNextText({ sessionId: practiceSessionId })
  }, [currentTextId, practiceSessionId, prepareNextText])

  const annotations: AnnotationInput[] = useMemo(() => {
    if (!currentText) return []
    return currentText.annotations.map((a, i) => ({
      index: i,
      headword: a.headword,
      sense: a.sense,
      surfaceForm: a.surfaceForm,
      charStart: a.charStart,
      charEnd: a.charEnd,
      rated: ratings.has(i),
    }))
  }, [currentText, ratings])

  const openChunk: RateSheetChunkContent | null = useMemo(() => {
    if (openIndex == null || !currentText) return null
    const ann = currentText.annotations[openIndex]
    if (!ann) return null
    // Translation/definition are joined server-side from user_lookups so the
    // rate sheet shows live content (edits in the focus view propagate).
    // Examples aren't surfaced here yet — they'd need their own fetch.
    return {
      headword: ann.headword,
      translation: ann.translation,
      definition: ann.definition,
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
          setRatings((prev) => {
            const next = new Map(prev)
            next.set(openIndex, rating)
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

  const showLoader = !done && (isLoading || isAdvancing || !currentText)
  const loaderLabel = isAdvancing ? t`Generating the next text…` : t`Preparing the session…`

  // Cap the visible bar at 100% — the numerator can briefly equal the
  // denominator on the all-caught-up frame.
  const progressPct =
    progress && progress.target > 0 ? Math.min(100, Math.round((progress.completed / progress.target) * 100)) : 0

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Practice`}>
      {showLoader && <PracticeLoader label={loaderLabel} />}

      {!showLoader && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          {progress && progress.target > 0 && (
            <div className='border-b bg-white/95 px-4 py-2 backdrop-blur'>
              <div className='mx-auto flex max-w-2xl items-center gap-3'>
                <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200'>
                  <div
                    className='h-full bg-yellow-500 transition-[width] duration-300 ease-out'
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {progress.completed}/{progress.target}
                </span>
              </div>
            </div>
          )}

          <div className='flex-1 overflow-y-auto px-4 py-6'>
            <div className='mx-auto flex max-w-2xl flex-col gap-6'>
              {done && (
                <div className='flex flex-col items-center gap-3 rounded-xl border bg-yellow-50 p-8 text-center'>
                  <CheckCircle2 className='h-10 w-10 text-yellow-600' />
                  <h2 className='text-lg font-semibold'>{t`All caught up`}</h2>
                  <p className='text-sm text-gray-700'>
                    {t`You've reviewed every due term for this language. Come back later when more are ready.`}
                  </p>
                  <Button onClick={close}>{t`Back to Practice`}</Button>
                </div>
              )}

              {!done && currentText && currentText.body && (
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

          {!done && currentText && (
            <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
              <div className='mx-auto flex max-w-2xl items-center justify-between gap-3'>
                {(() => {
                  const ratedCount = ratings.size
                  const totalCount = annotations.length
                  return (
                    <span className='text-muted-foreground text-xs'>
                      {t`${ratedCount} of ${totalCount} rated. Untapped terms count as 'good' on Next.`}
                    </span>
                  )
                })()}
                <Button onClick={handleNext} disabled={isFinalizing || isGenerating || isRating} size='lg'>
                  {t`Next text`}
                  <ArrowRight className='ml-1 h-4 w-4' />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <RateSheet
        open={openIndex !== null}
        onOpenChange={(open) => {
          if (!open) setOpenIndex(null)
        }}
        chunk={openChunk}
        currentRating={openIndex != null ? (ratings.get(openIndex) ?? null) : null}
        onSubmit={handleRate}
      />
    </ModalScreen>
  )
}
