import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables } from '../database.public.types'

export type DbUserLookup = Tables<'user_lookups'>

const listHeadwordsForLanguage = async (userId: string, targetLanguage: string): Promise<string[]> => {
  try {
    const result = await sql`
      SELECT headword FROM public.user_lookups
      WHERE user_id = ${userId} AND target_language = ${targetLanguage}
    `
    return result.map((row) => row.headword as string)
  } catch (e) {
    logCustomErrorMessageAndError(
      `userLookups.listHeadwordsForLanguage, userId = ${userId}, targetLanguage = ${targetLanguage}`,
      e
    )
    return []
  }
}

const upsertOnExport = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  firstCardId: string | null
}): Promise<boolean> => {
  try {
    await sql`
      INSERT INTO public.user_lookups (user_id, target_language, headword, first_card_id, exported_at, count)
      VALUES (
        ${params.userId},
        ${params.targetLanguage},
        ${params.headword},
        ${params.firstCardId},
        NOW(),
        1
      )
      ON CONFLICT (user_id, target_language, headword) DO UPDATE SET
        count = public.user_lookups.count + 1,
        exported_at = COALESCE(public.user_lookups.exported_at, EXCLUDED.exported_at)
    `
    return true
  } catch (e) {
    logCustomErrorMessageAndError(
      `userLookups.upsertOnExport, userId = ${params.userId}, headword = ${params.headword}`,
      e
    )
    return false
  }
}

export interface UserLookupsRepositoryInterface {
  listHeadwordsForLanguage: (userId: string, targetLanguage: string) => Promise<string[]>
  upsertOnExport: (params: {
    userId: string
    targetLanguage: string
    headword: string
    firstCardId: string | null
  }) => Promise<boolean>
}

export const UserLookupsRepository = (): UserLookupsRepositoryInterface => {
  return {
    listHeadwordsForLanguage,
    upsertOnExport,
  }
}
