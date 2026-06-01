import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
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

// Resolve the effective caps for the (user, language, pool) and return the live
// review slice for the scope. Feeds both the flashcard queue (router) and the
// reading generator's candidate set, so the daily-new budget is shared between
// the two render modes.
export const listReviewTerms = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  scope: ReviewScope,
  deps: ListReviewTermsDependencies
): Promise<DbUserLookup[]> => {
  const caps = await resolveReviewCaps({ userId, targetLanguage, pool, deps })
  const excludeUserLookupIds = await listCurrentReadingLookupIds(userId, targetLanguage, pool, deps)
  return deps.userLookupsRepository.listReviewTerms({
    userId,
    targetLanguage,
    pool,
    scope,
    maxReviewTerms: caps.maxReviewTerms,
    maxNewTerms: caps.maxNewTerms,
    excludeUserLookupIds,
  })
}
