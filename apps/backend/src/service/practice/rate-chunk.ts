import type { PracticeTextsRepositoryInterface } from '../../transport/database/practice-texts/practice-texts-repository'
import type { PracticeRatingsRepositoryInterface } from '../../transport/database/practice-ratings/practice-ratings-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { beginTx } from '../../transport/database/postgres-client'
import { applyRating, type AppRating } from './fsrs'

export type RateChunkDependencies = {
  practiceTextsRepository: PracticeTextsRepositoryInterface
  practiceRatingsRepository: PracticeRatingsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

export type RateChunkResult =
  | { ok: true }
  | { ok: false; reason: 'text_not_found' | 'chunk_not_in_text' | 'lookup_not_found' | 'text_already_finalized' }

export const withPracticeTextMutationLock = async <T>(practiceTextId: string, work: () => Promise<T>): Promise<T> => {
  const result = await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${practiceTextId}))
    `
    return await work()
  })
  return result as T
}

// Rate a chunk inside a practice_text. Validates ownership, the chunk's
// presence in annotations, and (CC-C) that the text is still in
// 'ready'/'reading' — explicit ratings landing after finalize are rejected so
// they can't bump FSRS twice.
//
// `options.bypassStatusGuard` exists for the implicit-rating loop in
// finalizePracticeText, which has already taken ownership of the finalize
// transition (status is 'done' by the time it runs).
export const rateChunk = async (
  practiceTextId: string,
  userId: string,
  headword: string,
  sense: string,
  rating: AppRating,
  wasExplicit: boolean,
  deps: RateChunkDependencies,
  options?: { bypassStatusGuard?: boolean }
): Promise<RateChunkResult> => {
  if (!options?.bypassStatusGuard) {
    return await withPracticeTextMutationLock(practiceTextId, () =>
      rateChunkUnlocked(practiceTextId, userId, headword, sense, rating, wasExplicit, deps, options)
    )
  }
  return await rateChunkUnlocked(practiceTextId, userId, headword, sense, rating, wasExplicit, deps, options)
}

const rateChunkUnlocked = async (
  practiceTextId: string,
  userId: string,
  headword: string,
  sense: string,
  rating: AppRating,
  wasExplicit: boolean,
  deps: RateChunkDependencies,
  options?: { bypassStatusGuard?: boolean }
): Promise<RateChunkResult> => {
  const found = await deps.practiceTextsRepository.findByIdForUser(practiceTextId, userId)
  if (!found) return { ok: false, reason: 'text_not_found' }

  if (!options?.bypassStatusGuard) {
    const status = found.practiceText.status
    if (status !== 'ready' && status !== 'reading') {
      return { ok: false, reason: 'text_already_finalized' }
    }
  }

  const annotations = Array.isArray(found.practiceText.annotations)
    ? (found.practiceText.annotations as Array<Record<string, unknown>>)
    : []
  const matches = annotations.some((ann) => ann.headword === headword && (ann.sense ?? '') === sense)
  if (!matches) return { ok: false, reason: 'chunk_not_in_text' }

  const lookup = await deps.userLookupsRepository.findByKey({
    userId,
    targetLanguage: found.targetLanguage,
    headword,
    sense,
  })
  if (!lookup) return { ok: false, reason: 'lookup_not_found' }

  const pool = found.pool
  const result = applyRating(lookup, rating, new Date(), pool)
  await deps.userLookupsRepository.applyFsrsResultForPool({
    userLookupId: lookup.id,
    pool,
    state: result.state,
    due: result.due,
    stability: result.stability,
    difficulty: result.difficulty,
    lastReview: result.lastReview,
    reps: result.reps,
    lapses: result.lapses,
  })
  await deps.practiceRatingsRepository.insert({
    practiceTextId,
    userLookupId: lookup.id,
    userId,
    targetLanguage: found.targetLanguage,
    headword,
    sense,
    pool,
    rating,
    wasExplicit,
  })

  return { ok: true }
}
