import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbPracticeRating = Tables<'practice_ratings'>
export type PracticeRatingValue = Database['public']['Enums']['practice_rating']

const insert = async (params: {
  practiceTextId: string
  userLookupId: string
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  rating: PracticeRatingValue
  wasExplicit: boolean
}): Promise<DbPracticeRating> => {
  const result = (await sql`
    INSERT INTO public.practice_ratings (
      practice_text_id, user_lookup_id, user_id, target_language, headword, sense, rating, was_explicit
    )
    VALUES (
      ${params.practiceTextId},
      ${params.userLookupId},
      ${params.userId},
      ${params.targetLanguage},
      ${params.headword},
      ${params.sense},
      ${params.rating},
      ${params.wasExplicit}
    )
    RETURNING *
  `) as DbPracticeRating[]
  return result[0]!
}

const listByPracticeTextId = async (practiceTextId: string): Promise<DbPracticeRating[]> => {
  return (await sql`
    SELECT *
    FROM public.practice_ratings
    WHERE practice_text_id = ${practiceTextId}
    ORDER BY rated_at ASC
  `) as DbPracticeRating[]
}

const getRatedHeadwordSensesForText = async (
  practiceTextId: string
): Promise<Array<{ headword: string; sense: string }>> => {
  const result = await sql`
    SELECT DISTINCT headword, sense
    FROM public.practice_ratings
    WHERE practice_text_id = ${practiceTextId}
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
  }))
}

// Strict-Again loop: chunks whose latest rating in this session
// was 'again' should resurface inside the same session until the user rates
// them Hard / Good / Easy. We key by user_lookup_id (not headword/sense) so
// a rename in the focus view mid-session doesn't break the linkage.
const getStubbornUserLookupIdsForSession = async (practiceSessionId: string): Promise<string[]> => {
  const result = (await sql`
    WITH latest AS (
      SELECT DISTINCT ON (pr.user_lookup_id)
        pr.user_lookup_id,
        pr.rating
      FROM public.practice_ratings pr
      JOIN public.practice_texts pt ON pt.id = pr.practice_text_id
      WHERE pt.practice_session_id = ${practiceSessionId}
      ORDER BY pr.user_lookup_id, pr.rated_at DESC, pr.id DESC
    )
    SELECT user_lookup_id
    FROM latest
    WHERE rating = 'again'
  `) as Array<{ user_lookup_id: string }>
  return result.map((row) => row.user_lookup_id)
}

export interface PracticeRatingsRepositoryInterface {
  insert: (params: {
    practiceTextId: string
    userLookupId: string
    userId: string
    targetLanguage: string
    headword: string
    sense: string
    rating: PracticeRatingValue
    wasExplicit: boolean
  }) => Promise<DbPracticeRating>
  listByPracticeTextId: (practiceTextId: string) => Promise<DbPracticeRating[]>
  getRatedHeadwordSensesForText: (practiceTextId: string) => Promise<Array<{ headword: string; sense: string }>>
  getStubbornUserLookupIdsForSession: (practiceSessionId: string) => Promise<string[]>
}

export const PracticeRatingsRepository = (): PracticeRatingsRepositoryInterface => {
  return {
    insert,
    listByPracticeTextId,
    getRatedHeadwordSensesForText,
    getStubbornUserLookupIdsForSession,
  }
}
