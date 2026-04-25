export const STRIPE_MONTHLY_PRICE_IN_EUR: number = 19
export const STRIPE_YEARLY_PRICE_IN_EUR: number = 189
// if this is set to lower than 7 days make sure to disable the "send a reminder email 7 days before trial ends" at
// https://dashboard.stripe.com/settings/billing/automatic
export const NUMBER_OF_DAYS_IN_FREE_TRIAL: number = 7
export const REFUND_PERIOD_IN_DAYS: number = 14

export const PLAN_INTERVALS = ['month', 'year'] as const
export type PlanInterval = (typeof PLAN_INTERVALS)[number]
