import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbUserTargetLanguagePref = Tables<'user_target_language_prefs'>

export const DEFAULT_PRACTICE_MAX_NEW_TERMS = 20
export const DEFAULT_PRACTICE_MAX_REVIEW_TERMS = 100
export const HARD_MAX_PRACTICE_NEW_TERMS = 100
export const HARD_MAX_PRACTICE_REVIEW_TERMS = 300

// The language-level new-introduction cap and recognition review cap, set
// together by the existing UI and clamped as a pair.
export type PracticeSessionLimits = {
  maxNewTerms: number
  maxReviewTerms: number
}

// Full per-pool practice limits for a language. `maxReviewTermsProduction` is
// the production review cap: NULL = uncapped (hard ceiling), preserving the
// existing uncapped production-review behavior until the UI sets it. Both
// citation pools share maxNewTerms; only their review caps differ.
export type PracticeLimits = PracticeSessionLimits & {
  maxReviewTermsProduction: number | null
}

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

const getPracticeLimitsForLanguage = async (userId: string, targetLanguage: string): Promise<PracticeLimits> => {
  const result = (await sql`
    SELECT practice_max_new_terms, practice_max_review_terms, practice_max_review_terms_production
    FROM public.user_target_language_prefs
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `) as {
    practice_max_new_terms: number
    practice_max_review_terms: number
    practice_max_review_terms_production: number | null
  }[]
  return {
    maxNewTerms: result[0]?.practice_max_new_terms ?? DEFAULT_PRACTICE_MAX_NEW_TERMS,
    maxReviewTerms: result[0]?.practice_max_review_terms ?? DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
    // NULL stays NULL = uncapped (hard ceiling). No default numeric cap for
    // production — that would silently start capping production review.
    maxReviewTermsProduction: result[0]?.practice_max_review_terms_production ?? null,
  }
}

const setPracticeLimitsForLanguage = async (
  userId: string,
  targetLanguage: string,
  limits: PracticeSessionLimits & { maxReviewTermsProduction: number | null }
): Promise<boolean> => {
  const result = await sql`
    UPDATE public.user_target_language_prefs
    SET practice_max_new_terms = ${limits.maxNewTerms},
        practice_max_review_terms = ${limits.maxReviewTerms},
        practice_max_review_terms_production = ${limits.maxReviewTermsProduction},
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
  getPracticeLimitsForLanguage: (userId: string, targetLanguage: string) => Promise<PracticeLimits>
  setPracticeLimitsForLanguage: (
    userId: string,
    targetLanguage: string,
    limits: PracticeSessionLimits & { maxReviewTermsProduction: number | null }
  ) => Promise<boolean>
}

export const UserTargetLanguagePrefsRepository = (): UserTargetLanguagePrefsRepositoryInterface => {
  return {
    findForLanguage,
    listForUser,
    upsertCefr,
    getShowTranslationsEnabled,
    setShowTranslationsEnabled,
    getPracticeLimitsForLanguage,
    setPracticeLimitsForLanguage,
  }
}
