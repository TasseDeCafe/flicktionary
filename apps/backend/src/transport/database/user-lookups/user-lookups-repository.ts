import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables } from '../database.public.types'

export type DbUserLookup = Tables<'user_lookups'>

export type HeadwordSense = {
  headword: string
  sense: string
}

const listHeadwordSensesForLanguage = async (userId: string, targetLanguage: string): Promise<HeadwordSense[]> => {
  try {
    const result = await sql`
      SELECT headword, sense FROM public.user_lookups
      WHERE user_id = ${userId} AND target_language = ${targetLanguage}
    `
    return result.map((row) => ({
      headword: row.headword as string,
      sense: (row.sense as string) ?? '',
    }))
  } catch (e) {
    logCustomErrorMessageAndError(
      `userLookups.listHeadwordSensesForLanguage, userId = ${userId}, targetLanguage = ${targetLanguage}`,
      e
    )
    return []
  }
}

const upsertOnExport = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  firstCardId: string | null
}): Promise<boolean> => {
  try {
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
  listHeadwordSensesForLanguage: (userId: string, targetLanguage: string) => Promise<HeadwordSense[]>
  upsertOnExport: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
    firstCardId: string | null
  }) => Promise<boolean>
}

export const UserLookupsRepository = (): UserLookupsRepositoryInterface => {
  return {
    listHeadwordSensesForLanguage,
    upsertOnExport,
  }
}
