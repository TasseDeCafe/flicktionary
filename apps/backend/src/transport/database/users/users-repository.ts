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
}

export const UsersRepository = (): UsersRepositoryInterface => {
  return {
    insertUser,
    findUserByUserId,
    findUserByStripeCustomerId,
    updateUserStripeCustomerId,
    updateStripeCustomerId,
    retrieveAllUsersCreatedLessThanNDaysAgo,
  }
}
