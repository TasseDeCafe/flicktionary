import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbPracticeRating = Tables<'practice_ratings'>
export type PracticeRatingValue = Database['public']['Enums']['practice_rating']

const insert = async (params: {
  practiceTextId: string
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  rating: PracticeRatingValue
  wasExplicit: boolean
}): Promise<DbPracticeRating> => {
  const result = (await sql`
    INSERT INTO public.practice_ratings (
      practice_text_id, user_id, target_language, headword, sense, rating, was_explicit
    )
    VALUES (
      ${params.practiceTextId},
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

export interface PracticeRatingsRepositoryInterface {
  insert: (params: {
    practiceTextId: string
    userId: string
    targetLanguage: string
    headword: string
    sense: string
    rating: PracticeRatingValue
    wasExplicit: boolean
  }) => Promise<DbPracticeRating>
  listByPracticeTextId: (practiceTextId: string) => Promise<DbPracticeRating[]>
  getRatedHeadwordSensesForText: (practiceTextId: string) => Promise<Array<{ headword: string; sense: string }>>
}

export const PracticeRatingsRepository = (): PracticeRatingsRepositoryInterface => {
  return {
    insert,
    listByPracticeTextId,
    getRatedHeadwordSensesForText,
  }
}
