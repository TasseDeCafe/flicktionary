import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { BookPinsRepositoryInterface } from '../../transport/database/book-pins/book-pins-repository'
import {
  isBookReady,
  type BooksRepositoryInterface,
  type DbBookPartAnalysis,
} from '../../transport/database/books/books-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { TRACK_LEMMA_PROFILE_VERSION } from '../lemma-profiles/build-track-lemma-profile'

// Pinning a book (docs/SRS.md §4 "Pinned book"): the pin itself plus the
// per-part lemma analysis it depends on (book_part_lemma_counts is written by
// the profile build). A part counts as analyzed from build bookkeeping —
// profile stamped at the current builder version — never from the existence
// of count rows: a successfully built part can legitimately match nothing.

export type BookPinDependencies = {
  booksRepository: BooksRepositoryInterface
  bookPinsRepository: BookPinsRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

export type BookAnalysisStatus = 'unsupported' | 'analyzing' | 'partly_failed' | 'ready'

export type BookAnalysis = {
  status: BookAnalysisStatus
  failedPartCount: number
}

const isPartAnalyzed = (part: DbBookPartAnalysis) =>
  part.profile_built_at !== null && part.profile_version === TRACK_LEMMA_PROFILE_VERSION

// A failed part is one whose latest build terminally failed and that has no
// current profile. The boost already works on the analyzed parts meanwhile.
export const summarizeBookAnalysis = (language: string, parts: readonly DbBookPartAnalysis[]): BookAnalysis => {
  if (!KAIKKI_LANGUAGES.has(language)) return { status: 'unsupported', failedPartCount: 0 }
  let pending = 0
  let failed = 0
  for (const part of parts) {
    if (isPartAnalyzed(part)) continue
    if (part.latest_job_status === 'failed') failed += 1
    else pending += 1
  }
  if (pending > 0) return { status: 'analyzing', failedPartCount: failed }
  if (failed > 0) return { status: 'partly_failed', failedPartCount: failed }
  return { status: 'ready', failedPartCount: 0 }
}

// Enqueues a profile build for every part that isn't analyzed yet and has no
// live build. Failed parts are only retried on an explicit request (the book
// page's Retry), so a broken part can't loop; the live-job unique index
// coalesces any race.
export const ensureBookAnalysis = async (
  params: { contentSourceId: string; userId: string; retryFailed: boolean },
  deps: BookPinDependencies
): Promise<void> => {
  const parts = await deps.booksRepository.listPartAnalysis(params.contentSourceId)
  for (const part of parts) {
    if (isPartAnalyzed(part)) continue
    if (part.latest_job_status === 'failed' && !params.retryFailed) continue
    if (part.latest_job_status === 'pending' || part.latest_job_status === 'processing') continue
    await deps.processingJobsRepository.enqueueBuildTrackLemmaProfile({
      textTrackId: part.text_track_id,
      userId: params.userId,
    })
  }
}

export type PinBookResult = { ok: true } | { ok: false; reason: 'not-found' | 'unsupported-language' }

// Pins a ready, owned book for its language (replacing any other pin of that
// language) and makes sure every part gets analyzed.
export const pinBook = async (
  params: { contentSourceId: string; userId: string },
  deps: BookPinDependencies
): Promise<PinBookResult> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source || !isBookReady(source)) return { ok: false, reason: 'not-found' }
  if (!KAIKKI_LANGUAGES.has(source.language)) return { ok: false, reason: 'unsupported-language' }
  await deps.bookPinsRepository.upsertPin({
    userId: params.userId,
    targetLanguage: source.language,
    contentSourceId: source.id,
  })
  await ensureBookAnalysis({ contentSourceId: source.id, userId: params.userId, retryFailed: false }, deps)
  return { ok: true }
}
