import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type {
  PracticePool,
  PracticeText,
  ReviewScope,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { Button } from '@flicktionary/ui/components/button'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { useSetFacetEnabled } from '@/features/vocabulary/api/vocabulary-hooks'
import {
  useAdvanceReadingText,
  useDeleteChunkFromPractice,
  useGenerateNextReadingText,
  usePrepareNextReadingText,
  useRestoreChunkFromPractice,
} from '../api/practice-hooks'
import type { FloatingSheetAnchor } from '@flicktionary/ui/components/floating-sheet'
import { AnnotatedText, type AnnotationInput, type PlainSelection } from './annotated-text'
import { ChunkDeleteConfirmSheet } from './chunk-delete-confirm-sheet'
import { LookupSheet } from './lookup-sheet'
import { PracticeLoader } from './practice-loader'
import { RateSheet, type RateSheetChunkContent } from './rate-sheet'
import { ReviewQueueStats } from './review-queue-stats'
import type { QueueCounts } from './review-counts'
import type { RateValue } from '@flicktionary/ui/components/rate-buttons'

type ReadingModeViewProps = {
  targetLanguage: string
  pool: PracticePool
  scope: ReviewScope
  counts: QueueCounts
}

// Annotation userLookupIds for the live text — fed to the pre-gen so it doesn't
// re-embed words about to be rated by the pending advance.
const annotationLookupIds = (text: PracticeText | null): string[] =>
  text ? text.annotations.map((a) => a.userLookupId).filter((id): id is string => !!id) : []

export const ReadingModeView = ({ targetLanguage, pool, scope, counts }: ReadingModeViewProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: userPrefs } = useGetUserPrefs()
  const languageName = getLanguageName(targetLanguage)
  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  const { mutate: generateNext } = useGenerateNextReadingText()
  const { mutate: advance, isPending: isAdvancing } = useAdvanceReadingText()
  const { mutate: prepareNext } = usePrepareNextReadingText()
  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunkFromPractice()
  const { mutate: restoreChunk, isPending: isRestoring } = useRestoreChunkFromPractice()
  const { mutate: setFacetEnabled, isPending: isTogglingProduction } = useSetFacetEnabled()

  // Past + current texts, oldest first. viewIndex selects which is shown; the
  // last entry is the live (rateable) text. Earlier entries are peek-back,
  // read-only.
  const [history, setHistory] = useState<PracticeText[]>([])
  const [viewIndex, setViewIndex] = useState(0)
  const [done, setDone] = useState(false)
  const [loadingFirst, setLoadingFirst] = useState(true)
  const bootstrappedRef = useRef(false)

  const [ratings, setRatings] = useState<Map<number, RateValue>>(new Map())
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [rateAnchor, setRateAnchor] = useState<FloatingSheetAnchor>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [lookupSelection, setLookupSelection] = useState<PlainSelection | null>(null)
  const [lookupOpen, setLookupOpen] = useState(false)
  // Selection paint persists while the lookup sheet is open; the close handler
  // must sweep it up (see the use-word-selection contract).
  const clearLookupPaintRef = useRef<(() => void) | null>(null)
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null)

  const liveText = history[history.length - 1] ?? null
  const displayText = history[viewIndex] ?? null
  const isPeeking = viewIndex < history.length - 1
  const isLive = !!liveText && viewIndex === history.length - 1 && !done

  const pushText = (text: PracticeText) => {
    setHistory((h) => [...h, text])
    setViewIndex((_) => history.length) // index of the newly pushed text
  }

  // Bootstrap: generate (or resume) the first text once.
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    generateNext(
      { targetLanguage, pool, scope },
      {
        onSuccess: (response) => {
          setLoadingFirst(false)
          if (response.data.done) {
            setDone(true)
            return
          }
          setHistory([response.data.practiceText])
          setViewIndex(0)
        },
        onError: () => setLoadingFirst(false),
      }
    )
  }, [generateNext, targetLanguage, pool, scope])

  // Reset per-text rating state when the live text changes.
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-chain-state-updates -- the live text swaps in from several async paths (bootstrap onSuccess, next-text promotion, resume), so keying the per-text UI reset on the text id covers them all; a key-remounted per-text child was considered and rejected — this state spans the article body, the footer's pending ratings, and three sheets, so the keyed subtree would have to wrap essentially the whole screen */
    setRatings(new Map())
    setOpenIndex(null)
    setSheetOpen(false)
    setRateAnchor(null)
    setDeleteConfirmOpen(false)
    setPendingDeleteIndex(null)
    setLookupSelection(null)
    setLookupOpen(false)
    /* eslint-enable react-you-might-not-need-an-effect/no-chain-state-updates */
  }, [liveText?.id])

  // Eager pre-gen: kick off the next slot as soon as a live text loads.
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- fire-and-forget pre-generation triggered by a text landing (async arrival from any of the swap paths), not by a user event
    if (!liveText) return
    prepareNext({ targetLanguage, pool, scope, excludeUserLookupIds: annotationLookupIds(liveText) })
  }, [liveText, targetLanguage, pool, scope, prepareNext])

  const annotations: AnnotationInput[] = useMemo(() => {
    if (!displayText) return []
    return displayText.annotations.map((a, i) => ({
      index: i,
      headword: a.headword,
      sense: a.sense,
      surfaceForm: a.surfaceForm,
      charStart: a.charStart,
      charEnd: a.charEnd,
      rated: isLive && ratings.has(i),
      deleted: !!a.deletedAt,
    }))
  }, [displayText, ratings, isLive])

  const openChunk: RateSheetChunkContent | null = useMemo(() => {
    if (openIndex == null || !liveText) return null
    const ann = liveText.annotations[openIndex]
    if (!ann) return null
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
      isProductionEnabled: ann.isProductionEnabled,
    }
  }, [openIndex, liveText, targetLanguage, userPrefs?.englishIpaDialect])

  const openAnnotation = useMemo(() => {
    if (openIndex == null || !liveText) return null
    return liveText.annotations[openIndex] ?? null
  }, [openIndex, liveText])

  const pendingDeleteAnnotation = useMemo(() => {
    if (pendingDeleteIndex == null || !liveText) return null
    return liveText.annotations[pendingDeleteIndex] ?? null
  }, [pendingDeleteIndex, liveText])

  // Optimistically flip an annotation's deleted state on the live text.
  const patchLiveAnnotationDeleted = (userLookupId: string, deleted: boolean) => {
    setHistory((h) => {
      if (h.length === 0) return h
      const last = h[h.length - 1]!
      const patched = {
        ...last,
        annotations: last.annotations.map((a) =>
          a.userLookupId === userLookupId ? { ...a, deletedAt: deleted ? new Date().toISOString() : null } : a
        ),
      }
      return [...h.slice(0, -1), patched]
    })
  }

  const handleAnnotationClick = (index: number, element: HTMLElement) => {
    if (!isLive) return
    setRateAnchor(element)
    setOpenIndex(index)
    setSheetOpen(true)
  }

  const handlePlainSelection = (selection: PlainSelection) => {
    if (!isLive) return
    setLookupSelection(selection)
    setLookupOpen(true)
  }

  // Reading mode batches ratings: record locally, no per-tap server call.
  const handleRate = (rating: RateValue) => {
    if (openIndex == null) return
    setRatings((prev) => {
      const next = new Map(prev)
      next.set(openIndex, rating)
      return next
    })
    setSheetOpen(false)
  }

  const handleEdit = () => {
    if (!openAnnotation || !openAnnotation.cardId || !openAnnotation.cardSessionId) return
    const sessionId = openAnnotation.cardSessionId
    const cardId = openAnnotation.cardId
    setSheetOpen(false)
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId, cardId },
      search: { from: 'practice' as const, practiceLang: targetLanguage, practicePool: pool },
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
          patchLiveAnnotationDeleted(lookupId, true)
          toast.success(t`Deleted "${headword}"`, {
            action: {
              label: t`Restore`,
              onClick: () =>
                restoreChunk({ id: lookupId }, { onSuccess: () => patchLiveAnnotationDeleted(lookupId, false) }),
            },
          })
        },
      }
    )
  }

  const handleRestoreFromSheet = () => {
    if (openIndex == null || !liveText) return
    const ann = liveText.annotations[openIndex]
    if (!ann?.userLookupId) return
    const lookupId = ann.userLookupId
    restoreChunk(
      { id: lookupId },
      {
        onSuccess: () => {
          setSheetOpen(false)
          patchLiveAnnotationDeleted(lookupId, false)
        },
      }
    )
  }

  const handleToggleProduction = (next: boolean) => {
    if (!openAnnotation?.userLookupId) return
    setFacetEnabled(
      { chunkId: openAnnotation.userLookupId, skill: 'meaning_production', targetForm: '', enabled: next },
      { onSuccess: () => setSheetOpen(false) }
    )
  }

  const handleNext = () => {
    if (!liveText) return
    const ratingsPayload = Array.from(ratings.entries())
      .map(([annIndex, rating]) => {
        const userLookupId = liveText.annotations[annIndex]?.userLookupId
        return userLookupId ? { userLookupId, rating } : null
      })
      .filter((r): r is { userLookupId: string; rating: RateValue } => r !== null)

    advance(
      { textId: liveText.id, pool, scope, ratings: ratingsPayload },
      {
        onSuccess: (response) => {
          if (response.data.done) {
            setDone(true)
            return
          }
          pushText(response.data.nextText)
        },
      }
    )
  }

  if (loadingFirst) return <PracticeLoader label={t`Preparing your text…`} />

  if (done && history.length === 0) {
    return (
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center'>
          <CheckCircle2 className='h-10 w-10 text-yellow-600 dark:text-yellow-400' />
          <h2 className='text-lg font-semibold'>{t`All caught up`}</h2>
          <p className='text-muted-foreground text-sm'>
            {t`You've reviewed every due term for this language. Come back later when more are ready.`}
          </p>
        </div>
        <div className='bg-background border-t px-4 pt-2 pb-3'>
          <div className='mx-auto w-full max-w-2xl'>
            <Button type='button' size='xl' className='w-full' onClick={close}>
              {t`Back to ${languageName}`}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const showDone = done && !isPeeking

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto px-4 py-6'>
        <div className='mx-auto flex max-w-2xl flex-col gap-6'>
          {showDone ? (
            <div className='flex flex-col items-center gap-3 rounded-xl border bg-yellow-50 p-8 text-center dark:bg-yellow-400/10'>
              <CheckCircle2 className='h-10 w-10 text-yellow-600 dark:text-yellow-400' />
              <h2 className='text-lg font-semibold'>{t`All caught up`}</h2>
              <p className='text-muted-foreground text-sm'>
                {t`You've reviewed every due term for this language. Come back later when more are ready.`}
              </p>
            </div>
          ) : (
            displayText?.body && (
              <article className={isPeeking ? 'opacity-70' : undefined}>
                {displayText.generationWarning && (
                  <p className='text-muted-foreground mb-3 text-xs italic'>{displayText.generationWarning}</p>
                )}
                <AnnotatedText
                  body={displayText.body}
                  targetLanguage={targetLanguage}
                  enabled={isLive}
                  annotations={annotations}
                  onAnnotationClick={handleAnnotationClick}
                  onPlainSelection={handlePlainSelection}
                  clearPaintRef={clearLookupPaintRef}
                />
              </article>
            )
          )}
        </div>
      </div>

      <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-2 pb-3 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t`Previous text`}
              disabled={viewIndex <= 0}
              onClick={() => setViewIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className='h-5 w-5' />
            </Button>
            <ReviewQueueStats counts={counts} />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t`Forward`}
              disabled={!isPeeking}
              onClick={() => setViewIndex((i) => Math.min(history.length - 1, i + 1))}
            >
              <ChevronRight className='h-5 w-5' />
            </Button>
          </div>

          {isPeeking ? (
            <Button
              type='button'
              size='xl'
              variant='outline'
              className='w-full'
              onClick={() => setViewIndex(history.length - 1)}
            >
              {t`Back to current text`}
            </Button>
          ) : showDone ? null : (
            <Button onClick={handleNext} disabled={isAdvancing} size='xl' className='w-full'>
              {isAdvancing ? (
                <>
                  {t`Generating…`}
                  <LoaderCircle className='ml-1 h-4 w-4 animate-spin' />
                </>
              ) : (
                <>
                  {t`Next`}
                  <ArrowRight className='ml-1 h-4 w-4' />
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <RateSheet
        open={sheetOpen}
        onOpenChange={(open) => setSheetOpen(open)}
        chunk={openChunk}
        anchor={rateAnchor}
        currentRating={openIndex != null ? (ratings.get(openIndex) ?? null) : null}
        onSubmit={handleRate}
        canEdit={!!openAnnotation?.cardId && !!openAnnotation?.cardSessionId}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
        onToggleProduction={handleToggleProduction}
        isTogglingProduction={isTogglingProduction}
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
      {liveText?.body && (
        <LookupSheet
          open={lookupOpen}
          selection={lookupSelection}
          contextText={liveText.body}
          targetLanguage={targetLanguage}
          onClose={() => {
            setLookupOpen(false)
            clearLookupPaintRef.current?.()
          }}
        />
      )}
    </div>
  )
}
