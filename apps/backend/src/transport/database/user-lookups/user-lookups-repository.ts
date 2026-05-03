import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbUserLookup = Tables<'user_lookups'>

export type HeadwordSense = {
  headword: string
  sense: string
}

const listHeadwordSensesForLanguage = async (userId: string, targetLanguage: string): Promise<HeadwordSense[]> => {
  const result = await sql`
    SELECT headword, sense FROM public.user_lookups
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
  }))
}

const upsertOnExport = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  firstCardId: string | null
}): Promise<void> => {
  await sql`
    INSERT INTO public.user_lookups (user_id, target_language, headword, sense, first_card_id, exported_at, count)
    VALUES (
      ${params.userId},
      ${params.targetLanguage},
      ${params.headword},
      ${params.sense},
      ${params.firstCardId},
      NOW(),
      1
    )
    ON CONFLICT (user_id, target_language, headword, sense) DO UPDATE SET
      count = public.user_lookups.count + 1,
      exported_at = COALESCE(public.user_lookups.exported_at, EXCLUDED.exported_at)
  `
}

export interface UserLookupsRepositoryInterface {
  listHeadwordSensesForLanguage: (userId: string, targetLanguage: string) => Promise<HeadwordSense[]>
  upsertOnExport: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
    firstCardId: string | null
  }) => Promise<void>
}

export const UserLookupsRepository = (): UserLookupsRepositoryInterface => {
  return {
    listHeadwordSensesForLanguage,
    upsertOnExport,
  }
}
