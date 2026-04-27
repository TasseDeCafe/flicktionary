import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables } from '../database.public.types'

export type DbUserTargetLanguagePref = Tables<'user_target_language_prefs'>

const findForLanguage = async (userId: string, targetLanguage: string): Promise<DbUserTargetLanguagePref | null> => {
  try {
    const result = (await sql`
      SELECT * FROM public.user_target_language_prefs
      WHERE user_id = ${userId} AND target_language = ${targetLanguage}
    `) as DbUserTargetLanguagePref[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(
      `userTargetLanguagePrefs.findForLanguage, userId = ${userId}, targetLanguage = ${targetLanguage}`,
      e
    )
    return null
  }
}

const listForUser = async (userId: string): Promise<DbUserTargetLanguagePref[]> => {
  try {
    const result = (await sql`
      SELECT * FROM public.user_target_language_prefs
      WHERE user_id = ${userId}
      ORDER BY target_language ASC
    `) as DbUserTargetLanguagePref[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`userTargetLanguagePrefs.listForUser, userId = ${userId}`, e)
    return []
  }
}

const upsertCefr = async (userId: string, targetLanguage: string, cefrLevel: string): Promise<boolean> => {
  try {
    await sql`
      INSERT INTO public.user_target_language_prefs (user_id, target_language, cefr_level)
      VALUES (${userId}, ${targetLanguage}, ${cefrLevel})
      ON CONFLICT (user_id, target_language) DO UPDATE SET
        cefr_level = EXCLUDED.cefr_level,
        updated_at = NOW()
    `
    return true
  } catch (e) {
    logCustomErrorMessageAndError(
      `userTargetLanguagePrefs.upsertCefr, userId = ${userId}, targetLanguage = ${targetLanguage}`,
      e
    )
    return false
  }
}

export interface UserTargetLanguagePrefsRepositoryInterface {
  findForLanguage: (userId: string, targetLanguage: string) => Promise<DbUserTargetLanguagePref | null>
  listForUser: (userId: string) => Promise<DbUserTargetLanguagePref[]>
  upsertCefr: (userId: string, targetLanguage: string, cefrLevel: string) => Promise<boolean>
}

export const UserTargetLanguagePrefsRepository = (): UserTargetLanguagePrefsRepositoryInterface => {
  return {
    findForLanguage,
    listForUser,
    upsertCefr,
  }
}
