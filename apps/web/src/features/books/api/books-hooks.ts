import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import {
  BOOK_UPLOAD_BATCH_MAX_CHARS,
  type PrelearnHorizon,
  type PrelearnItem,
} from '@flicktionary/api-client/orpc-contracts/books-contract'
import { orpcClient, orpcQuery } from '@/lib/transport/orpc-client'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'
import { hashBookParts, type BookPartDraft } from '../utils/build-book-parts'

// Polls while a pinned book's parts are still being analyzed, so the pin card
// moves from "Analyzing…" to its daily split without a manual refresh.
export const useGetBook = (contentSourceId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.books.get.queryOptions({
      input: { contentSourceId },
      select: (response) => response.data,
      refetchInterval: (query) => {
        const priority = query.state.data?.data.priority
        return priority?.pinned && priority.analysis.status === 'analyzing' ? 5000 : false
      },
      meta: { errorMessage: t`Failed to load the book` },
    })
  )
}

// Pinning reorders the new-card queue, so the practice plan/landing and the
// Vocabulary Up next list refresh with the book page; the sessions list carries
// the pin glyph on book cards.
const pinInvalidates = () => [
  orpcQuery.books.get.key(),
  orpcQuery.studySessions.list.key(),
  orpcQuery.chunks.listChunks.key(),
  ...practiceSummaryKeys(),
]

export const usePinBook = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.pin.mutationOptions({
      meta: {
        invalidates: pinInvalidates(),
        errorMessage: t`Failed to prioritize this book`,
      },
    })
  )
}

export const useUnpinBook = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.unpin.mutationOptions({
      meta: {
        invalidates: pinInvalidates(),
        errorMessage: t`Failed to stop prioritizing this book`,
      },
    })
  )
}

export const useRetryBookAnalysis = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.retryAnalysis.mutationOptions({
      meta: {
        invalidates: [orpcQuery.books.get.key()],
        errorMessage: t`Failed to retry the analysis`,
      },
    })
  )
}

export const useOpenBookPart = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.openPart.mutationOptions({
      meta: {
        invalidates: [orpcQuery.studySessions.list.key(), orpcQuery.books.get.key()],
        errorMessage: t`Failed to open this part`,
      },
    })
  )
}

export const useRemoveBook = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.remove.mutationOptions({
      meta: {
        invalidates: pinInvalidates(),
        errorMessage: t`Failed to remove the book`,
      },
    })
  )
}

// Packs parts into upload batches under the request size budget. A single part
// is never split across batches (parts are capped well below the budget).
const packUploadBatches = (parts: readonly BookPartDraft[]): BookPartDraft[][] => {
  const batches: BookPartDraft[][] = []
  let current: BookPartDraft[] = []
  let currentChars = 0
  for (const part of parts) {
    const partChars = part.segments.reduce((sum, segment) => sum + segment.length, 0)
    if (current.length > 0 && currentChars + partChars > BOOK_UPLOAD_BATCH_MAX_CHARS) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(part)
    currentChars += partChars
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export type UploadBookInput = {
  title: string
  author: string | null
  language: string
  fileName: string
  parts: BookPartDraft[]
  // Fraction of the upload done, 0..1.
  onProgress: (fraction: number) => void
}

// create → appendParts batches → finalize, as one mutation so the wizard has a
// single pending/error state. Resolves to the first part's session; a book the
// user already has resolves to its current part.
export const useUploadBook = () => {
  return useMutation({
    mutationFn: async ({ onProgress, parts, ...book }: UploadBookInput): Promise<{ sessionId: string }> => {
      onProgress(0)
      const created = await orpcClient.books.create({
        ...book,
        contentHash: hashBookParts(parts),
        partCount: parts.length,
      })
      const { contentSourceId, uploadId } = created.data
      if (!uploadId) {
        const existing = await orpcClient.books.get({ contentSourceId })
        const opened = await orpcClient.books.openPart({
          contentSourceId,
          partIndex: existing.data.currentPartIndex,
        })
        onProgress(1)
        return opened.data
      }
      const batches = packUploadBatches(parts)
      for (const [index, batch] of batches.entries()) {
        await orpcClient.books.appendParts({ contentSourceId, uploadId, parts: batch })
        // The last stretch (finalize: moderation + session) gets its own slice.
        onProgress(((index + 1) / batches.length) * 0.9)
      }
      const finalized = await orpcClient.books.finalize({ contentSourceId, uploadId })
      onProgress(1)
      return finalized.data
    },
    meta: {
      invalidates: [orpcQuery.studySessions.list.key(), orpcQuery.books.get.key()],
      // The wizard maps error codes (blocked content, superseded upload) itself.
      showErrorToast: false,
    },
  })
}

// "Learn before you read": only fetched while the book page's section is open.
// "Show more" raises `limit`; the shorter list stays on screen while the
// longer one loads.
export const useGetPrelearnCandidates = (
  contentSourceId: string,
  horizon: PrelearnHorizon,
  limit: number,
  enabled: boolean
) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.books.getPrelearnCandidates.queryOptions({
      input: { contentSourceId, horizon, limit },
      select: (response) => response.data,
      enabled,
      placeholderData: keepPreviousData,
      meta: { errorMessage: t`Failed to load the words ahead` },
    })
  )
}

// Glosses of the listed words in their listed sentences. The server caches
// them per occurrence, so they never change for a given key; when the list
// changes (a word left, the next one came in) the previous glosses stay on
// screen while the new ones load. A failure just leaves rows without a gloss.
export const useGetPrelearnGlosses = (contentSourceId: string, items: readonly PrelearnItem[]) => {
  return useQuery(
    orpcQuery.books.getPrelearnGlosses.queryOptions({
      input: {
        contentSourceId,
        items: items.map(({ lemma, headword, segmentId, context }) => ({ lemma, headword, segmentId, context })),
      },
      select: (response) => new Map(response.data.glosses.map(({ lemma, gloss }) => [lemma, gloss])),
      enabled: items.length > 0,
      staleTime: Infinity,
      placeholderData: keepPreviousData,
      meta: { showErrorToast: false },
    })
  )
}

// A known mark changes the list and every difficulty/coverage read.
const prelearnKnownInvalidates = (contentSourceId: string) => [
  orpcQuery.books.getPrelearnCandidates.key({ input: { contentSourceId } }),
  ...difficultyInvalidates(),
]

export const useMarkPrelearnKnown = (contentSourceId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.markPrelearnKnown.mutationOptions({
      meta: {
        invalidates: prelearnKnownInvalidates(contentSourceId),
        errorMessage: t`Failed to mark the word as known`,
      },
    })
  )
}

// The Known toast's Undo: the gloss sheet's plain un-mark, refreshing the list
// so the word comes back.
export const useUndoPrelearnKnown = (contentSourceId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.unmarkKnownLemma.mutationOptions({
      meta: {
        invalidates: prelearnKnownInvalidates(contentSourceId),
        errorMessage: t`Failed to remove the known mark`,
      },
    })
  )
}

// A new card: everything that depends on the vocabulary set refreshes (the
// same set as the "Add a word" flow), plus the list and the book page's split.
export const useLearnPrelearnWord = (contentSourceId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.books.learnPrelearnWord.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.books.getPrelearnCandidates.key({ input: { contentSourceId } }),
          orpcQuery.books.get.key(),
          orpcQuery.chunks.listChunks.key(),
          orpcQuery.chunks.listLanguages.key(),
          ...practiceSummaryKeys(),
          ...difficultyInvalidates(),
        ],
        errorMessage: t`Failed to add the word`,
      },
    })
  )
}
