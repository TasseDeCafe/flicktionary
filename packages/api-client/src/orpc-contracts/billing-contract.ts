import { oc } from '@orpc/contract'
import { z } from 'zod'

// Common error schemas
const errorResponseSchema = z.object({
  errors: z.array(
    z.object({
      message: z.string(),
      code: z.string().optional(),
    })
  ),
})

const stripeSubscriptionStatusSchema = z
  .enum(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete_expired', 'incomplete', 'paused'])
  .nullable()
const planTypeSchema = z.enum(['month', 'year', 'free_trial']).nullable()
// these translate to web, ios, android apps respectively
// test_store is only used in dev
const billingPlatformSchema = z.enum(['stripe', 'app_store', 'play_store', 'test_store']).nullable()

const userPricingDetailsSchema = z.object({
  amountInEurosThatUserIsCurrentlyPayingPerInterval: z.number().nullable(),
  hasSubscribedWithADiscount: z.boolean(),
  currentlyAvailableDiscounts: z
    .object({
      monthly: z.object({
        discountAsPercentage: z.number(),
        durationLimit: z.number().nullable(),
      }),
      yearly: z.object({
        discountAsPercentage: z.number(),
        durationLimit: z.number().nullable(),
      }),
    })
    .nullable(),
  currentDiscountInPercentage: z.number(),
})

const subscriptionDetailsSchema = z.object({
  status: stripeSubscriptionStatusSchema,
  lastActivePlan: planTypeSchema,
  currentActivePlan: planTypeSchema,
  userPricingDetails: userPricingDetailsSchema,
})

const revenueCatDetailsSchema = z.object({
  managementUrl: z.string().nullable(),
})

const getSubscriptionInfoResponseSchema = z.union([
  z.object({
    stripeDetails: subscriptionDetailsSchema,
    revenueCatDetails: revenueCatDetailsSchema,
    isSpecialUserWithFullAccess: z.literal(false),
    isPremiumUser: z.boolean(),
    billingPlatform: billingPlatformSchema,
  }),
  z.object({
    stripeDetails: z.null(),
    revenueCatDetails: z.null(),
    isPremiumUser: z.literal(true),
    billingPlatform: z.null(),
    isSpecialUserWithFullAccess: z.literal(true),
  }),
])

export const billingContract = {
  getSubscriptionDetails: oc
    .route({
      method: 'GET',
      path: '/billing/subscription-details',
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: {
        status: 404,
        data: errorResponseSchema,
      },
    })
    .output(
      z.object({
        data: getSubscriptionInfoResponseSchema,
      })
    ),
} as const

// Export types
export type GetSubscriptionInfoResponse = z.infer<typeof getSubscriptionInfoResponseSchema>
export type UserStripePricingDetails = z.infer<typeof userPricingDetailsSchema>
export type PlanType = z.infer<typeof planTypeSchema>
export type SupportedBillingPlatform = z.infer<typeof billingPlatformSchema>
