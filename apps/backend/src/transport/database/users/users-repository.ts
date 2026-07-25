import type { IpaDialects } from '@flicktionary/core/utils/pick-ipa'
import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbUser = Tables<'users'>

const insertUser = async (
  id: string,
  referral: string | null,
  utmParams: {
    utmSource: string | null
    utmMedium: string | null
    utmCampaign: string | null
    utmTerm: string | null
    utmContent: string | null
  },
  seed?: { nativeLanguage: string; isOnboarded: boolean }
): Promise<void> => {
  await sql`
    INSERT INTO public.users (
      id,
      referral,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      native_language,
      is_onboarded
    )
    VALUES (
      ${id},
      ${referral},
      ${utmParams.utmSource},
      ${utmParams.utmMedium},
      ${utmParams.utmCampaign},
      ${utmParams.utmTerm},
      ${utmParams.utmContent},
      ${seed?.nativeLanguage ?? null},
      ${seed?.isOnboarded ?? false}
    )
    ON CONFLICT (id) DO NOTHING
  `
}

const findUserByUserId = async (id: string): Promise<DbUser | null> => {
  const result: DbUser[] = await sql`SELECT * FROM public.users WHERE id = ${id}`
  return result[0] ?? null
}

const findUserByStripeCustomerId = async (stripeCustomerId: string): Promise<DbUser | null> => {
  const result = (await sql`SELECT * FROM public.users WHERE stripe_customer_id = ${stripeCustomerId}`) as DbUser[]
  return result[0] ?? null
}

// Telegram chat ids are BIGINT; postgres.js returns int8 as strings, so the
// TS layer passes them around as strings and lets Postgres coerce on write.
const findUserIdByTelegramChatId = async (chatId: string): Promise<string | null> => {
  const result = (await sql`
    SELECT id FROM public.users WHERE telegram_chat_id = ${chatId}
  `) as { id: string }[]
  return result[0]?.id ?? null
}

const getTelegramChatId = async (userId: string): Promise<string | null> => {
  const result = (await sql`
    SELECT telegram_chat_id::text AS telegram_chat_id FROM public.users WHERE id = ${userId}
  `) as { telegram_chat_id: string | null }[]
  return result[0]?.telegram_chat_id ?? null
}

const clearTelegramChatId = async (userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users SET telegram_chat_id = NULL WHERE id = ${userId}
  `
  return result.count === 1
}

const updateUserStripeCustomerId = async (userId: string, stripeCustomerId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users
    SET stripe_customer_id = ${stripeCustomerId}
    WHERE id = ${userId}
  `
  return result.count === 1
}

const updateStripeCustomerId = async (userId: string, stripeCustomerId: string | null): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users
    SET stripe_customer_id = ${stripeCustomerId}
    WHERE id = ${userId}
  `
  return result.count === 1
}

const retrieveAllUsersCreatedLessThanNDaysAgo = async (days: number): Promise<string[]> => {
  const result = await sql`
    SELECT id
    FROM public.users
    WHERE created_at > NOW() - make_interval(days => ${days})
  `
  return result.map((row) => row.id)
}

const getNativeLanguage = async (userId: string): Promise<string | null> => {
  const result = (await sql`
    SELECT native_language FROM public.users WHERE id = ${userId}
  `) as { native_language: string | null }[]
  return result[0]?.native_language ?? null
}

const setNativeLanguage = async (userId: string, nativeLanguage: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users SET native_language = ${nativeLanguage} WHERE id = ${userId}
  `
  return result.count === 1
}

const getLastTargetLanguage = async (userId: string): Promise<string | null> => {
  const result = (await sql`
    SELECT last_target_language FROM public.users WHERE id = ${userId}
  `) as { last_target_language: string | null }[]
  return result[0]?.last_target_language ?? null
}

const setLastTargetLanguage = async (userId: string, targetLanguage: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users
    SET last_target_language = ${targetLanguage}
    WHERE id = ${userId}
  `
  return result.count === 1
}

const getIsOnboarded = async (userId: string): Promise<boolean> => {
  const result = (await sql`
    SELECT is_onboarded FROM public.users WHERE id = ${userId}
  `) as { is_onboarded: boolean }[]
  return result[0]?.is_onboarded ?? false
}

const completeOnboarding = async (userId: string, nativeLanguage: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users
    SET native_language = ${nativeLanguage},
        is_onboarded = TRUE
    WHERE id = ${userId}
  `
  return result.count === 1
}

const getTapToTranslateEnabled = async (userId: string): Promise<boolean> => {
  const result = (await sql`
    SELECT tap_to_translate_enabled FROM public.users WHERE id = ${userId}
  `) as { tap_to_translate_enabled: boolean }[]
  return result[0]?.tap_to_translate_enabled ?? false
}

const setTapToTranslateEnabled = async (userId: string, enabled: boolean): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users SET tap_to_translate_enabled = ${enabled} WHERE id = ${userId}
  `
  return result.count === 1
}

const getLlmHighlightsEnabled = async (userId: string): Promise<boolean> => {
  const result = (await sql`
    SELECT llm_highlights_enabled FROM public.users WHERE id = ${userId}
  `) as { llm_highlights_enabled: boolean }[]
  // Default true: existing users keep the prior behavior.
  return result[0]?.llm_highlights_enabled ?? true
}

const setLlmHighlightsEnabled = async (userId: string, enabled: boolean): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users SET llm_highlights_enabled = ${enabled} WHERE id = ${userId}
  `
  return result.count === 1
}

// One row read for all three dialect-split languages; unexpected stored
// values coerce to each language's default so callers always get a valid
// bucket key.
const getIpaDialects = async (userId: string): Promise<IpaDialects> => {
  const result = (await sql`
    SELECT english_ipa_dialect, spanish_ipa_dialect, portuguese_ipa_dialect
    FROM public.users WHERE id = ${userId}
  `) as {
    english_ipa_dialect: string | null
    spanish_ipa_dialect: string | null
    portuguese_ipa_dialect: string | null
  }[]
  const row = result[0]
  return {
    en: row?.english_ipa_dialect === 'rp' ? 'rp' : 'ga',
    es: row?.spanish_ipa_dialect === 'cas' ? 'cas' : 'lam',
    pt: row?.portuguese_ipa_dialect === 'eu' ? 'eu' : 'br',
  }
}

const setIpaDialect = async (userId: string, targetLanguage: 'en' | 'es' | 'pt', dialect: string): Promise<boolean> => {
  const column =
    targetLanguage === 'en'
      ? sql`english_ipa_dialect`
      : targetLanguage === 'es'
        ? sql`spanish_ipa_dialect`
        : sql`portuguese_ipa_dialect`
  const result = await sql`
    UPDATE public.users SET ${column} = ${dialect} WHERE id = ${userId}
  `
  return result.count === 1
}

const getUiTheme = async (userId: string): Promise<'light' | 'dark' | 'system' | null> => {
  const result = (await sql`
    SELECT ui_theme FROM public.users WHERE id = ${userId}
  `) as { ui_theme: string | null }[]
  const value = result[0]?.ui_theme
  // NULL means "never explicitly set" — return as-is, no default coercion.
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

const setUiTheme = async (userId: string, uiTheme: 'light' | 'dark' | 'system' | null): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users SET ui_theme = ${uiTheme} WHERE id = ${userId}
  `
  return result.count === 1
}

const getUiLanguage = async (userId: string): Promise<string | null> => {
  const result = (await sql`
    SELECT ui_language FROM public.users WHERE id = ${userId}
  `) as { ui_language: string | null }[]
  return result[0]?.ui_language ?? null
}

const setUiLanguage = async (userId: string, uiLanguage: string | null): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users SET ui_language = ${uiLanguage} WHERE id = ${userId}
  `
  return result.count === 1
}

const getAccountFlags = async (userId: string): Promise<string[]> => {
  const result = (await sql`
    SELECT account_flags FROM public.users WHERE id = ${userId}
  `) as { account_flags: string[] }[]
  return result[0]?.account_flags ?? []
}

// Idempotent: re-adding a present flag leaves the array untouched but still
// matches the row, so count === 1 distinguishes "user exists" from "no user".
const addAccountFlag = async (userId: string, flag: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.users
    SET account_flags = CASE
      WHEN ${flag} = ANY(account_flags) THEN account_flags
      ELSE array_append(account_flags, ${flag})
    END
    WHERE id = ${userId}
  `
  return result.count === 1
}

export interface UsersRepositoryInterface {
  insertUser: (
    id: string,
    referral: string | null,
    utmParams: {
      utmSource: string | null
      utmMedium: string | null
      utmCampaign: string | null
      utmTerm: string | null
      utmContent: string | null
    },
    seed?: { nativeLanguage: string; isOnboarded: boolean }
  ) => Promise<void>
  findUserByUserId: (id: string) => Promise<DbUser | null>
  findUserByStripeCustomerId: (stripeCustomerId: string) => Promise<DbUser | null>
  findUserIdByTelegramChatId: (chatId: string) => Promise<string | null>
  getTelegramChatId: (userId: string) => Promise<string | null>
  clearTelegramChatId: (userId: string) => Promise<boolean>
  updateUserStripeCustomerId: (userId: string, stripeCustomerId: string) => Promise<boolean>
  updateStripeCustomerId: (userId: string, stripeCustomerId: string | null) => Promise<boolean>
  retrieveAllUsersCreatedLessThanNDaysAgo: (days: number) => Promise<string[]>
  getNativeLanguage: (userId: string) => Promise<string | null>
  setNativeLanguage: (userId: string, nativeLanguage: string) => Promise<boolean>
  getIsOnboarded: (userId: string) => Promise<boolean>
  completeOnboarding: (userId: string, nativeLanguage: string) => Promise<boolean>
  getLastTargetLanguage: (userId: string) => Promise<string | null>
  setLastTargetLanguage: (userId: string, targetLanguage: string) => Promise<boolean>
  getTapToTranslateEnabled: (userId: string) => Promise<boolean>
  setTapToTranslateEnabled: (userId: string, enabled: boolean) => Promise<boolean>
  getLlmHighlightsEnabled: (userId: string) => Promise<boolean>
  setLlmHighlightsEnabled: (userId: string, enabled: boolean) => Promise<boolean>
  getIpaDialects: (userId: string) => Promise<IpaDialects>
  setIpaDialect: (userId: string, targetLanguage: 'en' | 'es' | 'pt', dialect: string) => Promise<boolean>
  getUiTheme: (userId: string) => Promise<'light' | 'dark' | 'system' | null>
  setUiTheme: (userId: string, uiTheme: 'light' | 'dark' | 'system' | null) => Promise<boolean>
  getUiLanguage: (userId: string) => Promise<string | null>
  setUiLanguage: (userId: string, uiLanguage: string | null) => Promise<boolean>
  getAccountFlags: (userId: string) => Promise<string[]>
  addAccountFlag: (userId: string, flag: string) => Promise<boolean>
}

export const UsersRepository = (): UsersRepositoryInterface => {
  return {
    insertUser,
    findUserByUserId,
    findUserByStripeCustomerId,
    findUserIdByTelegramChatId,
    getTelegramChatId,
    clearTelegramChatId,
    updateUserStripeCustomerId,
    updateStripeCustomerId,
    retrieveAllUsersCreatedLessThanNDaysAgo,
    getNativeLanguage,
    setNativeLanguage,
    getIsOnboarded,
    completeOnboarding,
    getLastTargetLanguage,
    setLastTargetLanguage,
    getTapToTranslateEnabled,
    setTapToTranslateEnabled,
    getLlmHighlightsEnabled,
    setLlmHighlightsEnabled,
    getIpaDialects,
    setIpaDialect,
    getUiTheme,
    setUiTheme,
    getUiLanguage,
    setUiLanguage,
    getAccountFlags,
    addAccountFlag,
  }
}
