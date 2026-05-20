import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbUserTargetLanguagePref = Tables<'user_target_language_prefs'>

const findForLanguage = async (userId: string, targetLanguage: string): Promise<DbUserTargetLanguagePref | null> => {
  const result = (await sql`
    SELECT * FROM public.user_target_language_prefs
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `) as DbUserTargetLanguagePref[]
  return result[0] ?? null
}

const listForUser = async (userId: string): Promise<DbUserTargetLanguagePref[]> => {
  return (await sql`
    SELECT * FROM public.user_target_language_prefs
    WHERE user_id = ${userId}
    ORDER BY target_language ASC
  `) as DbUserTargetLanguagePref[]
}

const upsertCefr = async (userId: string, targetLanguage: string, cefrLevel: string): Promise<void> => {
  await sql`
    INSERT INTO public.user_target_language_prefs (user_id, target_language, cefr_level)
    VALUES (${userId}, ${targetLanguage}, ${cefrLevel})
    ON CONFLICT (user_id, target_language) DO UPDATE SET
      cefr_level = EXCLUDED.cefr_level,
      updated_at = NOW()
  `
}

const getShowTranslationsEnabled = async (userId: string, targetLanguage: string): Promise<boolean> => {
  const result = (await sql`
    SELECT show_translations_enabled
    FROM public.user_target_language_prefs
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `) as { show_translations_enabled: boolean }[]
  return result[0]?.show_translations_enabled ?? true
}

const setShowTranslationsEnabled = async (
  userId: string,
  targetLanguage: string,
  enabled: boolean
): Promise<boolean> => {
  const result = await sql`
    UPDATE public.user_target_language_prefs
    SET show_translations_enabled = ${enabled},
        updated_at = NOW()
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `
  return result.count === 1
}

export interface UserTargetLanguagePrefsRepositoryInterface {
  findForLanguage: (userId: string, targetLanguage: string) => Promise<DbUserTargetLanguagePref | null>
  listForUser: (userId: string) => Promise<DbUserTargetLanguagePref[]>
  upsertCefr: (userId: string, targetLanguage: string, cefrLevel: string) => Promise<void>
  getShowTranslationsEnabled: (userId: string, targetLanguage: string) => Promise<boolean>
  setShowTranslationsEnabled: (userId: string, targetLanguage: string, enabled: boolean) => Promise<boolean>
}

export const UserTargetLanguagePrefsRepository = (): UserTargetLanguagePrefsRepositoryInterface => {
  return {
    findForLanguage,
    listForUser,
    upsertCefr,
    getShowTranslationsEnabled,
    setShowTranslationsEnabled,
  }
}
