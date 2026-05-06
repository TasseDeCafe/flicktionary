import type { PracticeTextsRepositoryInterface } from '../../transport/database/practice-texts/practice-texts-repository'
import type { PracticeRatingsRepositoryInterface } from '../../transport/database/practice-ratings/practice-ratings-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { applyRating, type AppRating } from './fsrs'

export type RateChunkDependencies = {
  practiceTextsRepository: PracticeTextsRepositoryInterface
  practiceRatingsRepository: PracticeRatingsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

export type RateChunkResult =
  | { ok: true }
  | { ok: false; reason: 'text_not_found' | 'chunk_not_in_text' | 'lookup_not_found' }

// Validates that the chunk being rated actually appears in this practice_text's
// annotations (so the user can't game the SRS by rating arbitrary chunks),
// applies the FSRS update, and writes both the new SRS state and the rating
// audit record.
export const rateChunk = async (
  practiceTextId: string,
  userId: string,
  headword: string,
  sense: string,
  rating: AppRating,
  wasExplicit: boolean,
  deps: RateChunkDependencies
): Promise<RateChunkResult> => {
  const found = await deps.practiceTextsRepository.findByIdForUser(practiceTextId, userId)
  if (!found) return { ok: false, reason: 'text_not_found' }

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

  const result = applyRating(lookup, rating, new Date())
  await deps.userLookupsRepository.applyFsrsResult({
    userLookupId: lookup.id,
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
    rating,
    wasExplicit,
  })

  return { ok: true }
}
