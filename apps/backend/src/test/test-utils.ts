import { SupabaseClaims } from '../middleware/token-authentication-middleware'
import { sql } from '../transport/database/postgres-client'
import { getSupabase } from '../transport/database/supabase'
import { signSupabaseToken } from '../utils/jwt-verification-utils'
import { Express } from 'express'
import path from 'path'
import request from 'supertest'
import { AppDependencies, buildApp } from '../app'
import { MockStripeApi, StripeApi } from '../transport/third-party/stripe/stripe-api'
import { MockResendApi } from '../transport/third-party/resend/resend-api'
import { MockRevenuecatApi } from '../transport/third-party/revenuecat/revenuecat-api'
import { NUMBER_OF_DAYS_IN_FREE_TRIAL, PlanInterval } from '@flicktionary/core/constants/pricing-constants'
import { __simulateStripeSubscriptionCreatedEvent } from './stripe/stripe-test-utils'
import { DbInterval } from '../transport/database/stripe-subscriptions/stripe-subscriptions-repository'

/**
 * Creates a test app with sensible mock defaults.
 * Override specific dependencies as needed.
 */
export const buildTestApp = (overrides: Partial<AppDependencies> = {}): Express =>
  buildApp({
    stripeApi: MockStripeApi,
    resendApi: MockResendApi,
    revenuecatApi: MockRevenuecatApi,
    ...overrides,
  })

// Path to the signing key used by the test Supabase instance
// you can regenerate this key with supabase gen signing-key
export const SIGNING_KEY_PATH = path.join(__dirname, '../../supabase/supabase-test/supabase/signing_key.json')

const __getSupabaseTokenWithIdAndEmail = async (id: string, email: string): Promise<string> => {
  const supabaseClaims: SupabaseClaims = {
    sub: id,
    user_metadata: {
      name: 'John',
      full_name: 'Doe',
      email: email,
      avatar_url: 'https://www.example.com/john-doe.png',
    },
  }
  return await signSupabaseToken(supabaseClaims, SIGNING_KEY_PATH)
}

// Anonymous (guest) tokens carry is_anonymous and empty metadata, mirroring
// what Supabase mints on signInAnonymously(). An auth.users row must exist
// because public.users.id has a foreign key to it (signInAnonymously creates
// one in production); the admin API can't create email-less users, so the row
// gets a throwaway unique email that the anonymous-shaped JWT never carries.
// The admin API also can't flag the row anonymous, so the column is set
// directly — checks that read auth.users.is_anonymous (the guest source
// quota) must see what signInAnonymously would have written. Flagging the row
// also makes the fixture sweepable: deleteStaleAnonymousUsers deletes
// is_anonymous rows past the retention window, so on the shared never-reset
// test DB these fixtures are reaped once they age past it (the sweep's
// integration test tolerates that — no live test references them by then).
export const __getAnonymousSupabaseToken = async (): Promise<{ id: string; token: string }> => {
  const { data, error } = await getSupabase().auth.admin.createUser({
    email: __generateUniqueEmail(),
    password: 'password',
  })
  if (error) {
    throw new Error('Failed to create user in supabase: ' + error.message)
  }
  const id = data?.user?.id || ''
  await sql`UPDATE auth.users SET is_anonymous = true WHERE id = ${id}`
  const token = await signSupabaseToken({ sub: id, is_anonymous: true, user_metadata: {} }, SIGNING_KEY_PATH)
  return { id, token }
}

export type IdAndToken = {
  id: string
  token: string
  email: string
}

interface StripeCallCounts {
  createCustomerWithMetadataCallCount: number
  listSubscriptionsCallCount: number
  retrieveSubscriptionCallCount: number
}

export type InitialState = {
  id: string
  token: string
  testApp: Express
  stripeCallsCounters: StripeCallCounts
}

// Every test gets its own user (and email) by default: tests never share rows,
// so no global truncation is needed between tests and test files can run in
// parallel against the same database.
export const __createUserInSupabaseAndGetHisIdAndToken = async (email?: string): Promise<IdAndToken> => {
  const userEmail: string = email || __generateUniqueEmail()
  const { data, error } = await getSupabase().auth.admin.createUser({
    email: userEmail,
    password: 'password',
    user_metadata: { name: 'Yoda' },
  })
  if (error) {
    throw new Error('Failed to create user in supabase: ' + error.message)
  }
  const id = data?.user?.id || ''
  const supabaseToken = await __getSupabaseTokenWithIdAndEmail(id, userEmail)
  return {
    id,
    token: supabaseToken,
    email: userEmail,
  }
}

export const __generateUniqueId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

export const __generateUniqueEmail = (): string => `${__generateUniqueId('user')}@example.com`

// Telegram chat ids are int64s; a random 13-digit id can't collide with other
// tests, parallel files, or rows left behind by previous runs.
export const __generateUniqueTelegramChatId = (): number =>
  1_000_000_000_000 + Math.floor(Math.random() * 8_000_000_000_000)

export const buildAuthorizationHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
})

export type CreateOrGetUserParams = {
  testApp: Express
  token: string
  referral: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
}

export const __createOrGetUserWithOurApi = async ({
  testApp,
  token,
  referral,
  utmSource = null,
  utmMedium = null,
  utmCampaign = null,
  utmTerm = null,
  utmContent = null,
}: CreateOrGetUserParams): Promise<request.Response> => {
  return await request(testApp)
    .put('/api/v1/users/me')
    .set(buildAuthorizationHeaders(token))
    .send({ referral, utmSource, utmMedium, utmCampaign, utmTerm, utmContent })
}

export const __callCheckoutEndpoint = async (testApp: Express, token: string): Promise<request.Response> => {
  return await request(testApp)
    .post('/api/v1/payment/create-checkout-session')
    .set(buildAuthorizationHeaders(token))
    .send({
      successPathAndHash: 'someCheckoutSessionSuccessPathAndHash',
      cancelPathAndHash: 'someCheckoutSessionCancelPathAndHash',
      planInterval: 'month',
    })
}

export const __createCheckoutSessionWithOurApi = async (
  testApp: Express,
  token: string,
  successPathAndHash: string = 'some_return_path_and_hash',
  cancelPathAndHash: string = 'some_cancel_path_and_hash',
  planInterval: PlanInterval = 'month'
): Promise<request.Response> => {
  return await request(testApp)
    .post('/api/v1/payment/create-checkout-session')
    .set(buildAuthorizationHeaders(token))
    .send({
      successPathAndHash: successPathAndHash,
      cancelPathAndHash: cancelPathAndHash,
      planInterval: planInterval,
    })
}

export const __createUserRightAfterSignup = async ({
  appDependencies = {},
}: { appDependencies?: AppDependencies } = {}): Promise<InitialState> => {
  const { token, id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

  const testApp = buildApp(appDependencies)

  await __createOrGetUserWithOurApi({
    testApp,
    token,
    referral: null,
  })

  return {
    token,
    id: userId,
    testApp,
    stripeCallsCounters: {
      createCustomerWithMetadataCallCount: 0,
      listSubscriptionsCallCount: 0,
      retrieveSubscriptionCallCount: 0,
    },
  }
}

export const __createDefaultInitialStateAfterIntroducingCreditCardAndOnboardingWithoutVoiceId = async ({
  appDependencies = {},
  email = __generateUniqueEmail(),
  // Both ids land in globally-unique DB columns (users.stripe_customer_id and
  // stripe_subscriptions.stripe_subscription_id), so fixed defaults would make
  // concurrent tests and repeated runs collide.
  stripeCustomerId = __generateUniqueId('cus'),
  stripeSubscriptionId = __generateUniqueId('sub'),
  referral = null,
}: {
  appDependencies?: AppDependencies
  email?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  referral?: string | null
}) => {
  const { token, id: userId } = await __createUserInSupabaseAndGetHisIdAndToken(email)
  const stripeCallsCounters: StripeCallCounts = {
    createCustomerWithMetadataCallCount: 0,
    listSubscriptionsCallCount: 0,
    retrieveSubscriptionCallCount: 0,
  }

  const partialStripeMock: Partial<StripeApi> = {
    // used by the checkout endpoint
    createCustomerWithMetadata: async () => {
      stripeCallsCounters.createCustomerWithMetadataCallCount++
      return stripeCustomerId
    },
    // used by subscription sync
    listAllSubscriptions: async () => {
      stripeCallsCounters.listSubscriptionsCallCount++
      return [
        {
          id: 'sub_1R1DZQLbp4V2G8e2tQpITnDk',
          status: 'trialing',
          trial_end: 1679798400,
          created: 1679798400,
        },
      ]
    },
    retrieveSubscription: async () => {
      stripeCallsCounters.retrieveSubscriptionCallCount++
      return {
        id: stripeSubscriptionId,
        status: 'trialing',
        current_period_end: Math.floor(Date.now() / 1000) + 3600 * 24 * NUMBER_OF_DAYS_IN_FREE_TRIAL,
        cancel_at_period_end: true,
        trial_end: Math.floor(Date.now() / 1000) + 3600 * 24 * NUMBER_OF_DAYS_IN_FREE_TRIAL,
        items: {
          data: [
            {
              price: {
                product: 'free_trial_product_id',
              },
              plan: {
                interval: 'month' as DbInterval,
                interval_count: 1,
                amount: 1900,
                currency: 'eur',
              },
            },
          ],
        },
        metadata: {
          user_id: userId,
        },
      }
    },
  }

  const mergedAppDependencies = {
    ...appDependencies,
    stripeApi: {
      ...MockStripeApi,
      ...(appDependencies.stripeApi ?? {}),
      ...partialStripeMock,
    },
  }

  const testApp = buildApp(mergedAppDependencies)
  await __createOrGetUserWithOurApi({
    testApp,
    token,
    referral,
  })
  // before this call, our user still does not have a stripe customer id
  await __callCheckoutEndpoint(testApp, token)
  await __simulateStripeSubscriptionCreatedEvent({ testApp, stripeCustomerId, userId })
  return { token, id: userId, testApp, stripeCallsCounters }
}
export const __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding = async ({
  appDependencies = {},
  email,
  stripeCustomerId,
  stripeSubscriptionId,
  referral = null,
}: {
  appDependencies?: AppDependencies
  email?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  referral?: string | null
}): Promise<InitialState> => {
  const {
    token,
    id: userId,
    testApp,
    stripeCallsCounters,
  } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboardingWithoutVoiceId({
    appDependencies,
    email,
    stripeCustomerId,
    stripeSubscriptionId,
    referral,
  })
  return { token, id: userId, testApp, stripeCallsCounters }
}

// todo revenuecat
// add:
// create default initial state before introducing payment details
// create default initial state after introducing revenuecat payment details
