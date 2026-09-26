import { createHash } from 'node:crypto'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { HardBlockCategory } from '../../transport/third-party/anthropic/passes/moderation-pass'
import type { BooksRepositoryInterface, BookPartInsert } from '../../transport/database/books/books-repository'
import { readBookMetadata, isBookReady } from '../../transport/database/books/books-repository'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { buildBookModerationSample, moderateIngestText } from '../moderation/moderate-ingest-text'
import { ensureTrackLemmaProfileJob } from '../lemma-profiles/ensure-profile-job'

export type BookUploadDependencies = {
  booksRepository: BooksRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
  anthropicPasses: AnthropicPassesInterface
}

// The part index is part of a book track's hash, so two parts with identical
// text (repeated interludes) never collide on the (source, language, hash)
// track key.
export const hashBookPart = (partIndex: number, segments: readonly string[]): string =>
  createHash('sha256')
    .update(`${partIndex}|${segments.join('\n')}`)
    .digest('hex')

export const toBookPartInserts = (
  parts: ReadonlyArray<{ partIndex: number; title: string; segments: string[] }>
): BookPartInsert[] =>
  parts.map((part) => ({
    partIndex: part.partIndex,
    title: part.title,
    segments: part.segments,
    hash: hashBookPart(part.partIndex, part.segments),
  }))

type SessionPrefs =
  { ok: true; nativeLanguage: string; cefrLevel: string } | { ok: false; reason: 'needs-onboarding' | 'missing-cefr' }

const resolveSessionPrefs = async (
  userId: string,
  language: string,
  deps: Pick<BookUploadDependencies, 'usersRepository' | 'userTargetLanguagePrefsRepository'>
): Promise<SessionPrefs> => {
  const [nativeLanguage, prefs] = await Promise.all([
    deps.usersRepository.getNativeLanguage(userId),
    deps.userTargetLanguagePrefsRepository.findForLanguage(userId, language),
  ])
  if (!nativeLanguage) return { ok: false, reason: 'needs-onboarding' }
  if (!prefs?.cefr_level) return { ok: false, reason: 'missing-cefr' }
  return { ok: true, nativeLanguage, cefrLevel: prefs.cefr_level }
}

// Books are moderated on a sample (buildBookModerationSample) and only csam
// rejects: novels legitimately contain sex scenes, and books are never shared
// (SHARE_MODE_BY_SOURCE_TYPE.book = 'none').
const BOOK_HARD_BLOCK_CATEGORIES: readonly HardBlockCategory[] = ['csam']

export type FinalizeBookUploadResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'not-found' | 'stale-upload' | 'incomplete' | 'needs-onboarding' | 'missing-cefr' }
  | { ok: false; reason: 'blocked'; category: HardBlockCategory }

export const finalizeBookUpload = async (
  params: { contentSourceId: string; uploadId: string; userId: string },
  deps: BookUploadDependencies
): Promise<FinalizeBookUploadResult> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source) return { ok: false, reason: 'not-found' }

  // Idempotent retry of a finalize that already committed (e.g. the response
  // was lost): hand back the first part's session.
  if (isBookReady(source)) {
    const opened = await openBookPart({ contentSourceId: source.id, partIndex: 0, userId: params.userId }, deps)
    return opened.ok ? { ok: true, sessionId: opened.sessionId } : opened
  }
  const metadata = readBookMetadata(source)
  if (metadata.uploadId !== params.uploadId) return { ok: false, reason: 'stale-upload' }

  const prefs = await resolveSessionPrefs(params.userId, source.language, deps)
  if (!prefs.ok) return prefs

  // Moderated outside the transaction (an LLM call must not hold the row
  // lock); finalizeUpload re-verifies the uploadId under the lock, so a
  // restart that replaced the parts meanwhile can't be committed on this
  // verdict.
  const partTexts = await deps.booksRepository.listPartTexts(source.id)
  if (partTexts.length !== metadata.partCount) return { ok: false, reason: 'incomplete' }
  const sample = buildBookModerationSample(partTexts.map((part) => part.text).join('\n'))
  const moderation = await moderateIngestText(sample, deps.anthropicPasses, {
    surface: 'book-upload',
    hardBlockCategories: BOOK_HARD_BLOCK_CATEGORIES,
  })
  if (!moderation.allowed) {
    await deps.booksRepository.deleteUploadingBook(source.id, params.userId)
    return { ok: false, reason: 'blocked', category: moderation.category }
  }

  const finalized = await deps.booksRepository.finalizeUpload({
    contentSourceId: source.id,
    userId: params.userId,
    uploadId: params.uploadId,
    moderation: moderation.status ? { status: moderation.status, category: moderation.category } : null,
    session: { nativeLanguage: prefs.nativeLanguage, targetLanguage: source.language, cefrLevel: prefs.cefrLevel },
  })
  if (!finalized.ok) return finalized

  const parts = await deps.booksRepository.listPartsForUser(source.id, params.userId)
  for (const part of parts) {
    await ensureTrackLemmaProfileJob({ textTrackId: part.text_track_id, userId: params.userId }, deps)
  }
  return { ok: true, sessionId: finalized.session.id }
}

export type OpenBookPartResult =
  { ok: true; sessionId: string } | { ok: false; reason: 'not-found' | 'needs-onboarding' | 'missing-cefr' }

// Find-or-create the session for one part of a ready book the user owns.
export const openBookPart = async (
  params: { contentSourceId: string; partIndex: number; userId: string },
  deps: Pick<
    BookUploadDependencies,
    'booksRepository' | 'studySessionsRepository' | 'usersRepository' | 'userTargetLanguagePrefsRepository'
  >
): Promise<OpenBookPartResult> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source || !isBookReady(source)) return { ok: false, reason: 'not-found' }
  const parts = await deps.booksRepository.listPartsForUser(source.id, params.userId)
  const part = parts.find((p) => p.book_part_index === params.partIndex)
  if (!part) return { ok: false, reason: 'not-found' }
  if (part.session_id) return { ok: true, sessionId: part.session_id }

  const prefs = await resolveSessionPrefs(params.userId, source.language, deps)
  if (!prefs.ok) return prefs
  const inserted = await deps.studySessionsRepository.insertStudySession({
    userId: params.userId,
    contentSourceId: source.id,
    textTrackId: part.text_track_id,
    nativeLanguage: prefs.nativeLanguage,
    targetLanguage: source.language,
    cefrLevel: prefs.cefrLevel,
  })
  if (!inserted) return { ok: false, reason: 'not-found' }
  return { ok: true, sessionId: inserted.session.id }
}
