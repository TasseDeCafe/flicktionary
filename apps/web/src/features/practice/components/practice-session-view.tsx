import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ArrowRight, CheckCircle2, Info, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import type { PracticeText } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { useSetLearningMode } from '@/features/vocabulary/api/vocabulary-hooks'
import {
  useDeleteChunkFromPractice,
  useFinalizePracticeText,
  useGenerateNextPracticeText,
  useGetPracticeSession,
  usePrepareNextPracticeText,
  useRatePracticeChunk,
  useRestoreChunkFromPractice,
} from '../api/practice-hooks'
import type { FloatingSheetAnchor } from '@/components/ui/floating-sheet'
import { AnnotatedText, type AnnotationInput, type PlainSelection } from './annotated-text'
import { ChunkDeleteConfirmSheet } from './chunk-delete-confirm-sheet'
import { LookupSheet } from './lookup-sheet'
import { PracticeLoader } from './practice-loader'
import { RateSheet, type RateSheetChunkContent } from './rate-sheet'
import type { RateValue } from '@/components/ui/rate-buttons'

type AdvancingSnapshot = {
  ratedCount: number
  totalCount: number
}

export const PracticeSessionView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { practiceSessionId } = useParams({ from: '/_authenticated/_app/practice/$practiceSessionId' })

  const { data: sessionData, isLoading } = useGetPracticeSession(practiceSessionId)
  const { mutate: generateNextText, isPending: isGenerating } = useGenerateNextPracticeText(practiceSessionId)
  const { mutate: rateChunk, isPending: isRating } = useRatePracticeChunk(practiceSessionId)
  const { mutate: finalizeText, isPending: isFinalizing } = useFinalizePracticeText(practiceSessionId)
  const { mutate: prepareNextText } = usePrepareNextPracticeText()
  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunkFromPractice(practiceSessionId)
  const { mutate: restoreChunk, isPending: isRestoring } = useRestoreChunkFromPractice(practiceSessionId)
  const { mutate: setLearningMode, isPending: isTogglingLearningMode } = useSetLearningMode()
  const { data: userPrefs } = useGetUserPrefs()

  // Per-text map of annotation index -> the rating the user submitted. Used
  // both to mark already-rated chunks in the body and to pre-select the
  // previous rating when the user re-opens a chunk.
  const [ratings, setRatings] = useState<Map<number, RateValue>>(new Map())
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Separate visibility flag so vaul's close animation can finish with the
  // chunk content still mounted. Clearing `openIndex` on close used to flash
  // an empty "Rate" header for one frame before unmount. `openIndex` now only
  // clears on text change; close paths just flip `sheetOpen`.
  const [sheetOpen, setSheetOpen] = useState(false)
  // DOM anchor for the floating RateSheet — set when the user taps an
  // annotation. Snapshotted so the popover doesn't jump if the annotation
  // re-renders.
  const [rateAnchor, setRateAnchor] = useState<FloatingSheetAnchor>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  // Plain-span selection (peek + Save). Stays open until the user closes or
  // saves; saving creates an adhoc card and navigates to its focus view.
  const [lookupSelection, setLookupSelection] = useState<PlainSelection | null>(null)
  const [lookupOpen, setLookupOpen] = useState(false)
  // Index of the annotation the delete-confirm sheet is operating on. We keep
  // a separate slot from `openIndex` because the rate sheet closes when the
  // confirm opens, but we still need to know which chunk to delete.
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  // True from the moment Next is clicked until the new text lands in cache.
  // Hides the previous text and gates the auto-trigger effect so we don't
  // flash a stale text or double-fire the LLM call.
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [advancingSnapshot, setAdvancingSnapshot] = useState<AdvancingSnapshot | null>(null)
  // Snapshot of the just-finalized text so we can keep it visible (read-only)
  // during the finalize→generate round-trip. Avoids a brief skeleton flash
  // between texts and, on the last advance, between the previous text and the
  // "All caught up" view.
  const [previousText, setPreviousText] = useState<PracticeText | null>(null)

  const currentText = sessionData?.currentText ?? null
  const currentTextId = currentText?.id ?? null
  const progress = sessionData?.progress ?? null
  const targetLanguage = sessionData?.session.targetLanguage ?? null
  const isSessionActive = sessionData?.session.status === 'active'

  useEffect(() => {
    if (!sessionData || isSessionActive) return
    void navigate({
      to: '/practice/language/$targetLanguage',
      params: { targetLanguage: sessionData.session.targetLanguage },
      replace: true,
    })
  }, [isSessionActive, navigate, sessionData])

  // Auto-trigger generation if the session has no current text and isn't done.
  useEffect(() => {
    if (!sessionData) return
    if (!isSessionActive) return
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
  }, [sessionData, isSessionActive, currentText, done, isGenerating, isAdvancing, generateNextText, practiceSessionId])

  // Reset per-text UI state when the text changes.
  useEffect(() => {
    setRatings(new Map())
    setOpenIndex(null)
    setSheetOpen(false)
    setRateAnchor(null)
    setDeleteConfirmOpen(false)
    setPendingDeleteIndex(null)
    setLookupSelection(null)
    setLookupOpen(false)
  }, [currentTextId])

  // Eager pre-gen (Problem 4): kick off the next slot as soon as a fresh
  // text loads so handleNext can hand back a 'ready' row instantly. Server
  // is idempotent — repeat fires no-op.
  useEffect(() => {
    if (!currentTextId) return
    if (!isSessionActive) return
    prepareNextText({ sessionId: practiceSessionId })
  }, [currentTextId, isSessionActive, practiceSessionId, prepareNextText])

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
      deleted: !!a.deletedAt,
    }))
  }, [currentText, ratings])

  const openChunk: RateSheetChunkContent | null = useMemo(() => {
    if (openIndex == null || !currentText || !targetLanguage) return null
    const ann = currentText.annotations[openIndex]
    if (!ann) return null
    // Translation/definition/grammar are joined server-side from user_lookups
    // so the rate sheet shows live content (edits in the focus view propagate).
    // Examples aren't surfaced here yet — they'd need their own fetch.
    const grammar = ann.grammar
    const displayForm = typeof grammar?.display_form === 'string' ? grammar.display_form : null
    const ipa = pickIpa(grammar?.ipa, targetLanguage, userPrefs?.englishIpaDialect ?? 'ga') ?? null
    return {
      headword: ann.headword,
      displayForm,
      ipa,
      translation: ann.translation,
      definition: ann.definition,
      targetExample: null,
      nativeExample: null,
      grammar,
      targetLanguage,
      isDeleted: !!ann.deletedAt,
      learningMode: ann.learningMode,
    }
  }, [openIndex, currentText, targetLanguage, userPrefs?.englishIpaDialect])

  // Annotation the delete-confirm sheet is operating on. Snapshotted because
  // the user may open a different chunk before confirming, which would shift
  // `openIndex` to a different target.
  const pendingDeleteAnnotation = useMemo(() => {
    if (pendingDeleteIndex == null || !currentText) return null
    return currentText.annotations[pendingDeleteIndex] ?? null
  }, [pendingDeleteIndex, currentText])

  // Annotation the rate sheet's actions mode acts on. Always sourced from the
  // currently-open rate sheet so Edit/Delete operate on the right chunk.
  const openAnnotation = useMemo(() => {
    if (openIndex == null || !currentText) return null
    return currentText.annotations[openIndex] ?? null
  }, [openIndex, currentText])

  const handleAnnotationClick = (index: number, element: HTMLElement) => {
    setRateAnchor(element)
    setOpenIndex(index)
    setSheetOpen(true)
  }

  const handlePlainSelection = (selection: PlainSelection) => {
    setLookupSelection(selection)
    setLookupOpen(true)
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
          setSheetOpen(false)
        },
      }
    )
  }

  const handleEdit = () => {
    if (!openAnnotation || !openAnnotation.cardId || !openAnnotation.cardSessionId) return
    const sessionId = openAnnotation.cardSessionId
    const cardId = openAnnotation.cardId
    setSheetOpen(false)
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId, cardId },
      search: { from: 'practice' as const, practiceSessionId },
    })
  }

  const handleDeleteRequest = () => {
    if (openIndex == null) return
    setPendingDeleteIndex(openIndex)
    setSheetOpen(false)
    setDeleteConfirmOpen(true)
  }

  const handleDeleteConfirm = () => {
    if (!pendingDeleteAnnotation?.userLookupId) return
    const lookupId = pendingDeleteAnnotation.userLookupId
    const headword = pendingDeleteAnnotation.headword
    deleteChunk(
      { id: lookupId },
      {
        onSuccess: () => {
          setDeleteConfirmOpen(false)
          setPendingDeleteIndex(null)
          toast.success(t`Deleted "${headword}"`, {
            action: {
              label: t`Restore`,
              onClick: () => {
                restoreChunk({ id: lookupId })
              },
            },
          })
        },
      }
    )
  }

  // From the slim "deleted" RateSheet variant: restore + dismiss.
  const handleRestoreFromSheet = () => {
    if (openIndex == null || !currentText) return
    const ann = currentText.annotations[openIndex]
    if (!ann?.userLookupId) return
    restoreChunk(
      { id: ann.userLookupId },
      {
        onSuccess: () => {
          setSheetOpen(false)
        },
      }
    )
  }

  // Flip the open chunk between passive and active vocabulary, then dismiss
  // the sheet so the user sees the practice text again with the choice applied.
  const handleToggleLearningMode = (next: 'passive' | 'active') => {
    if (!openAnnotation?.userLookupId) return
    setLearningMode(
      { chunkId: openAnnotation.userLookupId, learningMode: next },
      {
        onSuccess: () => {
          setSheetOpen(false)
        },
      }
    )
  }

  const handleNext = () => {
    if (!currentText) return
    setPreviousText(currentText)
    setAdvancingSnapshot({
      ratedCount: ratings.size,
      totalCount: annotations.length,
    })
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
                setAdvancingSnapshot(null)
                setIsAdvancing(false)
                setPreviousText(null)
              },
              onError: () => {
                setAdvancingSnapshot(null)
                setIsAdvancing(false)
                setPreviousText(null)
              },
            }
          )
        },
        onError: () => {
          setAdvancingSnapshot(null)
          setIsAdvancing(false)
          setPreviousText(null)
        },
      }
    )
  }

  const close = () => {
    if (targetLanguage) {
      return navigate({
        to: '/practice/language/$targetLanguage',
        params: { targetLanguage },
      })
    }
    return navigate({ to: '/practice' })
  }

  const showInitialLoader = !done && (isLoading || (!isAdvancing && !currentText))
  const displayProgress = progress

  // Cap the visible bar at 100% — the numerator can briefly equal the
  // denominator on the all-caught-up frame.
  const progressPct =
    displayProgress && displayProgress.target > 0
      ? Math.min(100, Math.round((displayProgress.completed / displayProgress.target) * 100))
      : 0

  // finalize bumps progress to completed === target before generateNextText
  // confirms `done: true`. Treat at-capacity-while-advancing as done so the
  // user sees "All caught up" immediately instead of a brief skeleton flash.
  const isAtCapacity =
    !!displayProgress && displayProgress.target > 0 && displayProgress.completed >= displayProgress.target
  const showDone = done || (isAdvancing && isAtCapacity)

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Practice`}>
      {showInitialLoader && <PracticeLoader label={t`Preparing the session…`} />}

      {!showInitialLoader && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          {displayProgress && displayProgress.target > 0 && (
            <div className='border-b bg-white/95 px-4 py-2 backdrop-blur'>
              <div className='mx-auto flex max-w-2xl items-center gap-3'>
                <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200'>
                  <div
                    className='h-full bg-yellow-500 transition-[width] duration-700 ease-out'
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {displayProgress.completed}/{displayProgress.target}
                </span>
              </div>
            </div>
          )}

          <div className='flex-1 overflow-y-auto px-4 py-6'>
            <div className='mx-auto flex max-w-2xl flex-col gap-6'>
              {showDone && (
                <div className='flex flex-col items-center gap-3 rounded-xl border bg-yellow-50 p-8 text-center'>
                  <CheckCircle2 className='h-10 w-10 text-yellow-600' />
                  <h2 className='text-lg font-semibold'>{t`All caught up`}</h2>
                  <p className='text-sm text-gray-700'>
                    {t`You've reviewed every due term for this language. Come back later when more are ready.`}
                  </p>
                </div>
              )}

              {!showDone && isAdvancing && previousText && previousText.body && (
                <article className='pointer-events-none opacity-60'>
                  {previousText.generationWarning && (
                    <p className='text-muted-foreground mb-3 text-xs italic'>{previousText.generationWarning}</p>
                  )}
                  <AnnotatedText
                    body={previousText.body}
                    annotations={previousText.annotations.map((a, i) => ({
                      index: i,
                      headword: a.headword,
                      sense: a.sense,
                      surfaceForm: a.surfaceForm,
                      charStart: a.charStart,
                      charEnd: a.charEnd,
                      rated: ratings.has(i),
                      deleted: !!a.deletedAt,
                    }))}
                    onAnnotationClick={() => {}}
                    onPlainSelection={() => {}}
                  />
                </article>
              )}

              {!showDone && !isAdvancing && currentText && currentText.body && (
                <article>
                  {currentText.generationWarning && (
                    <p className='text-muted-foreground mb-3 text-xs italic'>{currentText.generationWarning}</p>
                  )}
                  <AnnotatedText
                    body={currentText.body}
                    annotations={annotations}
                    onAnnotationClick={handleAnnotationClick}
                    onPlainSelection={handlePlainSelection}
                  />
                </article>
              )}
            </div>
          </div>

          {showDone && (
            <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
              <div className='mx-auto flex w-full max-w-md flex-col gap-2 md:max-w-lg'>
                <Button onClick={close} size='xl' className='w-full'>
                  {t`Back to Practice`}
                </Button>
              </div>
            </div>
          )}

          {!showDone && (currentText || isAdvancing) && (
            <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 px-3 pt-2 pb-3 backdrop-blur'>
              <div className='mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                {(() => {
                  const ratedCount = advancingSnapshot?.ratedCount ?? ratings.size
                  const totalCount = advancingSnapshot?.totalCount ?? annotations.length
                  return (
                    <div className='text-muted-foreground flex items-center gap-1 text-xs'>
                      <span>{t`${ratedCount} of ${totalCount} rated`}</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className='text-muted-foreground -my-1 h-7 w-7'
                            aria-label={t`How rating works on Next`}
                          >
                            <Info className='h-3.5 w-3.5' />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent side='top' align='start' className='w-64 p-3 text-xs leading-relaxed'>
                          {t`Untapped terms count as 'good' when you advance to the next text.`}
                        </PopoverContent>
                      </Popover>
                    </div>
                  )
                })()}
                <Button
                  onClick={handleNext}
                  disabled={isAdvancing || isFinalizing || isGenerating || isRating}
                  size='xl'
                  className='w-full sm:w-auto'
                >
                  {isAdvancing ? (
                    <>
                      {t`Generating…`}
                      <LoaderCircle className='ml-1 h-4 w-4 animate-spin' />
                    </>
                  ) : (
                    <>
                      {t`Next text`}
                      <ArrowRight className='ml-1 h-4 w-4' />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <RateSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          // Keep rateAnchor + openIndex in state across the close animation so
          // the popover doesn't briefly flash at (0,0) or render an empty
          // header on dismiss. Both overwrite on the next open.
          setSheetOpen(open)
        }}
        chunk={openChunk}
        anchor={rateAnchor}
        currentRating={openIndex != null ? (ratings.get(openIndex) ?? null) : null}
        onSubmit={handleRate}
        canEdit={!!openAnnotation?.cardId && !!openAnnotation?.cardSessionId}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
        onToggleLearningMode={handleToggleLearningMode}
        isTogglingLearningMode={isTogglingLearningMode}
        onRestore={handleRestoreFromSheet}
        isRestoring={isRestoring}
      />
      <ChunkDeleteConfirmSheet
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open)
          if (!open && !isDeleting) setPendingDeleteIndex(null)
        }}
        headword={pendingDeleteAnnotation?.headword ?? ''}
        anchor={null}
        isDeleting={isDeleting}
        onConfirm={handleDeleteConfirm}
      />
      {targetLanguage && currentText?.body && currentText.id && (
        <LookupSheet
          open={lookupOpen}
          selection={lookupSelection}
          practiceTextId={currentText.id}
          practiceSessionId={practiceSessionId}
          practiceTextBody={currentText.body}
          targetLanguage={targetLanguage}
          onClose={() => setLookupOpen(false)}
        />
      )}
    </ModalScreen>
  )
}
