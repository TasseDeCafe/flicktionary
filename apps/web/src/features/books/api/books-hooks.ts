import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { BOOK_UPLOAD_BATCH_MAX_CHARS } from '@flicktionary/api-client/orpc-contracts/books-contract'
import { orpcClient, orpcQuery } from '@/lib/transport/orpc-client'
import { practiceSummaryKeys } from '@/features/practice/api/practice-hooks'
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
// Vocabulary Up next list refresh with the book page.
const pinInvalidates = () => [orpcQuery.books.get.key(), orpcQuery.chunks.listChunks.key(), ...practiceSummaryKeys()]

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
        invalidates: [orpcQuery.studySessions.list.key(), ...pinInvalidates()],
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
