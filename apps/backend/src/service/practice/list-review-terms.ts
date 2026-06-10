import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeTextsRepositoryInterface } from '../../transport/database/practice-texts/practice-texts-repository'
import type { ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { resolveReviewCaps, type ReviewCapsDependencies } from './review-caps'

export type ListReviewTermsDependencies = ReviewCapsDependencies & {
  practiceTextsRepository?: PracticeTextsRepositoryInterface
}

type RawAnnotation = { headword?: unknown; sense?: unknown }

const readAnnotationKeys = (annotations: unknown): Array<{ headword: string; sense: string }> => {
  const raw = Array.isArray(annotations) ? (annotations as RawAnnotation[]) : []
  return raw
    .map((a) => ({
      headword: typeof a.headword === 'string' ? a.headword : '',
      sense: typeof a.sense === 'string' ? a.sense : '',
    }))
    .filter((a) => a.headword.length > 0)
}

const listCurrentReadingLookupIds = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  deps: ListReviewTermsDependencies
): Promise<string[]> => {
  if (!deps.practiceTextsRepository) return []
  const current = await deps.practiceTextsRepository.findCurrentReading({ userId, targetLanguage, pool })
  if (!current) return []
  const keys = readAnnotationKeys(current.annotations)
  if (keys.length === 0) return []
  const keySet = new Set(keys.map((key) => `${key.headword}::${key.sense}`))
  const rows = await deps.userLookupsRepository.listChunkContentForKeys({ userId, targetLanguage, keys })
  return rows.filter((row) => keySet.has(`${row.headword}::${row.sense}`)).map((row) => row.id)
}

// Resolve the effective caps for the (user, language, pool, scope) and return
// the live review slice. Feeds both the flashcard queue (router) and the
// reading generator's candidate set, so the daily budgets are shared between
// the two render modes. `requestedNewCount` is the explicit learn-new batch
// size (flashcards only — the reading generator never passes it, so a
// URL-crafted read+learn_new session stays within the daily budget).
//
// `excludeCurrentReadingTerms` is for the reading GENERATOR only: a new text
// must not embed terms already held by the open 'reading' text. The flashcard
// queue must NOT set it — an abandoned reading would otherwise hold its terms
// hostage indefinitely (with a small pool, the entire due set), serving an
// empty session while the due-summary landing still advertises the work.
// Serving a held term in flashcards is FSRS-safe: the reading finalizer skips
// any annotation reviewed after the text was prepared
// (wasReviewedAfterTextWasPrepared in advance-reading-text).
export const listReviewTerms = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  scope: ReviewScope,
  deps: ListReviewTermsDependencies,
  options?: { requestedNewCount?: number; excludeCurrentReadingTerms?: boolean }
): Promise<DbUserLookupWithFacet[]> => {
  const caps = await resolveReviewCaps({
    userId,
    targetLanguage,
    pool,
    scope,
    requestedNewCount: options?.requestedNewCount,
    deps,
  })
  const excludeUserLookupIds = options?.excludeCurrentReadingTerms
    ? await listCurrentReadingLookupIds(userId, targetLanguage, pool, deps)
    : []
  return deps.userLookupsRepository.listReviewTerms({
    userId,
    targetLanguage,
    pool,
    scope,
    maxReviewTerms: caps.maxReviewTerms,
    maxLearningTerms: caps.maxLearningTerms,
    maxNewTerms: caps.maxNewTerms,
    maxOptInNewTerms: caps.maxOptInNewTerms,
    excludeUserLookupIds,
  })
}
