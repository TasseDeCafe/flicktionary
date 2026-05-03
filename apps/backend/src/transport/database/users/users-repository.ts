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
  }
): Promise<void> => {
  await sql`
    INSERT INTO public.users (
      id,
      referral,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content
    )
    VALUES (
      ${id},
      ${referral},
      ${utmParams.utmSource},
      ${utmParams.utmMedium},
      ${utmParams.utmCampaign},
      ${utmParams.utmTerm},
      ${utmParams.utmContent}
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
    }
  ) => Promise<void>
  findUserByUserId: (id: string) => Promise<DbUser | null>
  findUserByStripeCustomerId: (stripeCustomerId: string) => Promise<DbUser | null>
  updateUserStripeCustomerId: (userId: string, stripeCustomerId: string) => Promise<boolean>
  updateStripeCustomerId: (userId: string, stripeCustomerId: string | null) => Promise<boolean>
  retrieveAllUsersCreatedLessThanNDaysAgo: (days: number) => Promise<string[]>
  getNativeLanguage: (userId: string) => Promise<string | null>
  setNativeLanguage: (userId: string, nativeLanguage: string) => Promise<boolean>
  getTapToTranslateEnabled: (userId: string) => Promise<boolean>
  setTapToTranslateEnabled: (userId: string, enabled: boolean) => Promise<boolean>
  getLlmHighlightsEnabled: (userId: string) => Promise<boolean>
  setLlmHighlightsEnabled: (userId: string, enabled: boolean) => Promise<boolean>
}

export const UsersRepository = (): UsersRepositoryInterface => {
  return {
    insertUser,
    findUserByUserId,
    findUserByStripeCustomerId,
    updateUserStripeCustomerId,
    updateStripeCustomerId,
    retrieveAllUsersCreatedLessThanNDaysAgo,
    getNativeLanguage,
    setNativeLanguage,
    getTapToTranslateEnabled,
    setTapToTranslateEnabled,
    getLlmHighlightsEnabled,
    setLlmHighlightsEnabled,
  }
}
