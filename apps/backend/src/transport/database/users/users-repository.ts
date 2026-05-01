import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError, logWithSentry } from '../../third-party/sentry/error-monitoring'
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
): Promise<boolean> => {
  try {
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
    return true
  } catch (e) {
    logCustomErrorMessageAndError(`insertUser, userId = ${id}`, e)
    return false
  }
}
const findUserByUserId = async (id: string): Promise<DbUser | null> => {
  try {
    const result: DbUser[] = await sql`SELECT * FROM public.users WHERE id = ${id}`
    return result[0]
  } catch (e) {
    logCustomErrorMessageAndError(`findUser, userId = ${id}`, e)
    return null
  }
}

const findUserByStripeCustomerId = async (stripeCustomerId: string): Promise<DbUser | null> => {
  try {
    const result = (await sql`SELECT * FROM public.users WHERE stripe_customer_id = ${stripeCustomerId}`) as DbUser[]
    if (result.length === 0) {
      return null
    }
    return result[0]
  } catch (e) {
    logCustomErrorMessageAndError(`findUserByStripeCustomerId, stripeCustomerId = ${stripeCustomerId}`, e)
    return null
  }
}

const updateUserStripeCustomerId = async (userId: string, stripeCustomerId: string): Promise<boolean> => {
  try {
    await sql`
    UPDATE public.users
    SET stripe_customer_id = ${stripeCustomerId}
    WHERE id = ${userId}
  `
    return true
  } catch (e) {
    logCustomErrorMessageAndError(
      `updateUserStripeCustomerId, userId = ${userId}, stripeCustomerId = ${stripeCustomerId}`,
      e
    )
    return false
  }
}

const updateStripeCustomerId = async (userId: string, stripeCustomerId: string | null): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.users
      SET stripe_customer_id = ${stripeCustomerId}
      WHERE id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logWithSentry({
      message: 'error updating stripe customer id',
      params: {
        userId,
        stripeCustomerId,
      },
      error: e,
    })
    return false
  }
}

const retrieveAllUsersCreatedLessThanNDaysAgo = async (days: number): Promise<string[]> => {
  try {
    const result = await sql`
      SELECT id
      FROM public.users
      WHERE created_at > NOW() - make_interval(days => ${days})
    `
    return result.map((row) => row.id)
  } catch (error) {
    logWithSentry({ message: 'Error retrieving recent users', params: { days }, error })
    return []
  }
}

const getNativeLanguage = async (userId: string): Promise<string | null> => {
  try {
    const result = (await sql`
      SELECT native_language FROM public.users WHERE id = ${userId}
    `) as { native_language: string | null }[]
    return result[0]?.native_language ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`getNativeLanguage, userId = ${userId}`, e)
    return null
  }
}

const setNativeLanguage = async (userId: string, nativeLanguage: string): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.users SET native_language = ${nativeLanguage} WHERE id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`setNativeLanguage, userId = ${userId}`, e)
    return false
  }
}

const getTapToTranslateEnabled = async (userId: string): Promise<boolean> => {
  try {
    const result = (await sql`
      SELECT tap_to_translate_enabled FROM public.users WHERE id = ${userId}
    `) as { tap_to_translate_enabled: boolean }[]
    return result[0]?.tap_to_translate_enabled ?? false
  } catch (e) {
    logCustomErrorMessageAndError(`getTapToTranslateEnabled, userId = ${userId}`, e)
    return false
  }
}

const setTapToTranslateEnabled = async (userId: string, enabled: boolean): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.users SET tap_to_translate_enabled = ${enabled} WHERE id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`setTapToTranslateEnabled, userId = ${userId}`, e)
    return false
  }
}

const getLlmHighlightsEnabled = async (userId: string): Promise<boolean> => {
  try {
    const result = (await sql`
      SELECT llm_highlights_enabled FROM public.users WHERE id = ${userId}
    `) as { llm_highlights_enabled: boolean }[]
    // Default true: existing users keep the prior behavior.
    return result[0]?.llm_highlights_enabled ?? true
  } catch (e) {
    logCustomErrorMessageAndError(`getLlmHighlightsEnabled, userId = ${userId}`, e)
    return true
  }
}

const setLlmHighlightsEnabled = async (userId: string, enabled: boolean): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.users SET llm_highlights_enabled = ${enabled} WHERE id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`setLlmHighlightsEnabled, userId = ${userId}`, e)
    return false
  }
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
  ) => Promise<boolean>
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
