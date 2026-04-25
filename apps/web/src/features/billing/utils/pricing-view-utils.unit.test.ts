import { describe, expect, test } from 'vitest'
import { i18n } from '@lingui/core'
import { getPricingViewConfig } from './pricing-view-utils.ts'
import { NUMBER_OF_DAYS_IN_FREE_TRIAL } from '@template-app/core/constants/pricing-constants.ts'

i18n.load('en', {})
i18n.activate('en')

describe('pricing-view-utils', () => {
  describe('getPlansConfigForPricingView', () => {
    describe('isCreditCardRequiredForAll is false', () => {
      const isCreditCardRequiredForAll = false
      describe('with referral that has no active discounts', () => {
        const hasAllowedReferral = true
        test('a user right after signup who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isCreditCardRequiredForAll,
            isPremiumUser: false,
            hasAllowedReferral,
            currentActivePlan: 'free_trial',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                priceMessage: '€15.75/month',
                billedYearly: 'Billed yearly at €189.00',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
            },
            startButton: {
              shouldBeShown: false,
              text: 'Start',
            },
          })
        })
        test('a user with month plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral,
            currentActivePlan: 'month',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly (Current)',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        test('a user with yearly plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral,
            currentActivePlan: 'year',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly (Current)',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        describe('user subscribed when a discount was still active', () => {
          test('a user with yearly plan who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              isCreditCardRequiredForAll,
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: 113.4,
                hasSubscribedWithADiscount: true,
                currentlyAvailableDiscounts: null,
                currentDiscountInPercentage: 40,
              },
              isPremiumUser: true,
              hasAllowedReferral,
              currentActivePlan: 'year',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly (Current)',
                  value: 'year',
                  billedYearly: 'Billed yearly at €113.40',
                  priceMessage: '€9.45/month',
                  discountMessage: '40% off thanks to your past referral!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€19.00/month',
                  discountMessage: null,
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: 'Manage Subscription',
              },
              startButton: {
                shouldBeShown: true,
                text: 'Start',
              },
            })
          })
          test('a user with yearly plan who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: true,
              clickedPlan: 'year',
              isCreditCardRequiredForAll,
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: 15.2,
                hasSubscribedWithADiscount: true,
                currentlyAvailableDiscounts: null,
                currentDiscountInPercentage: 20,
              },
              isPremiumUser: true,
              hasAllowedReferral,
              currentActivePlan: 'month',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  billedYearly: 'Billed yearly at €189.00',
                  priceMessage: '€15.75/month',
                  discountMessage: null,
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly (Current)',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off thanks to your past referral!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: 'Loading...',
              },
              startButton: {
                shouldBeShown: true,
                text: 'Start',
              },
            })
          })
        })
      })

      describe('with referral that has active discounts', () => {
        const hasReferral = true
        describe('with no duration limits', () => {
          const activeDiscountsWithNoDurationLimits = {
            monthly: {
              discountAsPercentage: 20,
              durationLimit: null,
            },
            yearly: {
              discountAsPercentage: 40,
              durationLimit: null,
            },
          }
          test('a user right after signup who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
                hasSubscribedWithADiscount: false,
                currentlyAvailableDiscounts: activeDiscountsWithNoDurationLimits,
                currentDiscountInPercentage: 0,
              },
              isCreditCardRequiredForAll,
              isPremiumUser: false,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'free_trial',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  priceMessage: '€9.45/month',
                  billedYearly: 'Billed yearly at €113.40',
                  discountMessage: '40% off with your referral forever!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off with your referral forever!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
              },
              startButton: {
                shouldBeShown: false,
                text: 'Start',
              },
            })
          })
        })

        describe('with duration limits of 1 interval', () => {
          test('a user right after signup who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
                hasSubscribedWithADiscount: false,
                currentlyAvailableDiscounts: {
                  monthly: {
                    discountAsPercentage: 20,
                    durationLimit: 1,
                  },
                  yearly: {
                    discountAsPercentage: 40,
                    durationLimit: 1,
                  },
                },
                currentDiscountInPercentage: 0,
              },
              isCreditCardRequiredForAll,
              isPremiumUser: false,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'free_trial',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  priceMessage: '€9.45/month',
                  billedYearly: 'Billed yearly at €113.40',
                  discountMessage: '40% off with your referral for 1 year!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off with your referral for 1 month!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
              },
              startButton: {
                shouldBeShown: false,
                text: 'Start',
              },
            })
          })
        })

        describe('with duration limits of 3 intervals', () => {
          test('a user right after signup who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
                hasSubscribedWithADiscount: false,
                currentlyAvailableDiscounts: {
                  monthly: {
                    discountAsPercentage: 20,
                    durationLimit: 3,
                  },
                  yearly: {
                    discountAsPercentage: 40,
                    durationLimit: 3,
                  },
                },
                currentDiscountInPercentage: 0,
              },
              isCreditCardRequiredForAll,
              isPremiumUser: false,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'free_trial',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  priceMessage: '€9.45/month',
                  billedYearly: 'Billed yearly at €113.40',
                  discountMessage: '40% off with your referral for 3 years!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off with your referral for 3 months!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
              },
              startButton: {
                shouldBeShown: false,
                text: 'Start',
              },
            })
          })
        })
      })

      describe('without referral', () => {
        const hasReferral = false
        test('a user right after signup who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isCreditCardRequiredForAll,
            isPremiumUser: false,
            hasAllowedReferral: hasReferral,
            currentActivePlan: 'free_trial',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                priceMessage: '€15.75/month',
                billedYearly: 'Billed yearly at €189.00',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
              {
                additionalMessage: '',
                discountMessage: null,
                label: 'Free Trial (Current)',
                priceMessage: `Free for ${NUMBER_OF_DAYS_IN_FREE_TRIAL} days`,
                value: 'free_trial',
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'START 7-DAY FREE TRIAL',
            },
            startButton: {
              shouldBeShown: false,
              text: 'Start',
            },
          })
        })
        test('a user with month plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral: hasReferral,
            currentActivePlan: 'month',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly (Current)',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
              {
                additionalMessage: '',
                discountMessage: null,
                label: 'Free Trial (Expired)',
                priceMessage: `Free for ${NUMBER_OF_DAYS_IN_FREE_TRIAL} days`,
                value: 'free_trial',
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        test('a user with yearly plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral: hasReferral,
            currentActivePlan: 'year',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly (Current)',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
              {
                additionalMessage: '',
                discountMessage: null,
                label: 'Free Trial (Expired)',
                priceMessage: `Free for ${NUMBER_OF_DAYS_IN_FREE_TRIAL} days`,
                value: 'free_trial',
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
      })
    })
    describe('isCreditCardRequiredForAll is true', () => {
      const isCreditCardRequiredForAll = true
      describe('with referral that has no active discounts', () => {
        const hasReferral = true
        test('a user right after signup who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isCreditCardRequiredForAll,
            isPremiumUser: false,
            hasAllowedReferral: hasReferral,
            currentActivePlan: 'free_trial',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                priceMessage: '€15.75/month',
                billedYearly: 'Billed yearly at €189.00',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
            },
            startButton: {
              shouldBeShown: false,
              text: 'Start',
            },
          })
        })
        test('a user with month plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral: hasReferral,
            currentActivePlan: 'month',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly (Current)',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        test('a user with yearly plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral: hasReferral,
            currentActivePlan: 'year',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly (Current)',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        describe('user subscribed when a discount was still active', () => {
          test('a user with yearly plan who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              isCreditCardRequiredForAll,
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: 113.4,
                hasSubscribedWithADiscount: true,
                currentlyAvailableDiscounts: null,
                currentDiscountInPercentage: 40,
              },
              isPremiumUser: true,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'year',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly (Current)',
                  value: 'year',
                  billedYearly: 'Billed yearly at €113.40',
                  priceMessage: '€9.45/month',
                  discountMessage: '40% off thanks to your past referral!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€19.00/month',
                  discountMessage: null,
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: 'Manage Subscription',
              },
              startButton: {
                shouldBeShown: true,
                text: 'Start',
              },
            })
          })
          test('a user with yearly plan who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: true,
              clickedPlan: 'year',
              isCreditCardRequiredForAll,
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: 15.2,
                hasSubscribedWithADiscount: true,
                currentlyAvailableDiscounts: null,
                currentDiscountInPercentage: 20,
              },
              isPremiumUser: true,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'month',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  billedYearly: 'Billed yearly at €189.00',
                  priceMessage: '€15.75/month',
                  discountMessage: null,
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly (Current)',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off thanks to your past referral!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: 'Loading...',
              },
              startButton: {
                shouldBeShown: true,
                text: 'Start',
              },
            })
          })
        })
      })

      describe('with referral that has active discounts', () => {
        const hasReferral = true
        describe('with no duration limits', () => {
          const activeDiscountsWithNoDurationLimits = {
            monthly: {
              discountAsPercentage: 20,
              durationLimit: null,
            },
            yearly: {
              discountAsPercentage: 40,
              durationLimit: null,
            },
          }
          test('a user right after signup who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
                hasSubscribedWithADiscount: false,
                currentlyAvailableDiscounts: activeDiscountsWithNoDurationLimits,
                currentDiscountInPercentage: 0,
              },
              isCreditCardRequiredForAll,
              isPremiumUser: false,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'free_trial',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  priceMessage: '€9.45/month',
                  billedYearly: 'Billed yearly at €113.40',
                  discountMessage: '40% off with your referral forever!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off with your referral forever!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
              },
              startButton: {
                shouldBeShown: false,
                text: 'Start',
              },
            })
          })
        })

        describe('with duration limits of 1 interval', () => {
          test('a user right after signup who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
                hasSubscribedWithADiscount: false,
                currentlyAvailableDiscounts: {
                  monthly: {
                    discountAsPercentage: 20,
                    durationLimit: 1,
                  },
                  yearly: {
                    discountAsPercentage: 40,
                    durationLimit: 1,
                  },
                },
                currentDiscountInPercentage: 0,
              },
              isCreditCardRequiredForAll,
              isPremiumUser: false,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'free_trial',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  priceMessage: '€9.45/month',
                  billedYearly: 'Billed yearly at €113.40',
                  discountMessage: '40% off with your referral for 1 year!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off with your referral for 1 month!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
              },
              startButton: {
                shouldBeShown: false,
                text: 'Start',
              },
            })
          })
        })

        describe('with duration limits of 3 intervals', () => {
          test('a user right after signup who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
                hasSubscribedWithADiscount: false,
                currentlyAvailableDiscounts: {
                  monthly: {
                    discountAsPercentage: 20,
                    durationLimit: 3,
                  },
                  yearly: {
                    discountAsPercentage: 40,
                    durationLimit: 3,
                  },
                },
                currentDiscountInPercentage: 0,
              },
              isCreditCardRequiredForAll,
              isPremiumUser: false,
              hasAllowedReferral: hasReferral,
              currentActivePlan: 'free_trial',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  priceMessage: '€9.45/month',
                  billedYearly: 'Billed yearly at €113.40',
                  discountMessage: '40% off with your referral for 3 years!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off with your referral for 3 months!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
              },
              startButton: {
                shouldBeShown: false,
                text: 'Start',
              },
            })
          })
        })
      })

      describe('without referral', () => {
        const hasAllowedReferral = false
        test('a user right after signup who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isCreditCardRequiredForAll,
            isPremiumUser: false,
            hasAllowedReferral,
            currentActivePlan: 'free_trial',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                priceMessage: '€15.75/month',
                billedYearly: 'Billed yearly at €189.00',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: `START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`,
            },
            startButton: {
              shouldBeShown: false,
              text: 'Start',
            },
          })
        })
        test('a user with month plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral,
            currentActivePlan: 'month',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly (Current)',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        test('a user with yearly plan who did not click on anything yet', () => {
          const result = getPricingViewConfig({
            isPendingMutation: false,
            clickedPlan: 'year',
            isCreditCardRequiredForAll,
            pricingDetails: {
              amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
              hasSubscribedWithADiscount: false,
              currentlyAvailableDiscounts: null,
              currentDiscountInPercentage: 0,
            },
            isPremiumUser: true,
            hasAllowedReferral,
            currentActivePlan: 'year',
          })
          expect(result).toEqual({
            plans: [
              {
                label: 'Yearly (Current)',
                value: 'year',
                billedYearly: 'Billed yearly at €189.00',
                priceMessage: '€15.75/month',
                discountMessage: null,
                additionalMessage: 'best value',
              },
              {
                label: 'Monthly',
                value: 'month',
                priceMessage: '€19.00/month',
                discountMessage: null,
              },
            ],
            subscribeButton: {
              isDisabled: false,
              text: 'Manage Subscription',
            },
            startButton: {
              shouldBeShown: true,
              text: 'Start',
            },
          })
        })
        describe('user subscribed when a discount was still active', () => {
          test('a user with yearly plan who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: false,
              clickedPlan: 'year',
              isCreditCardRequiredForAll,
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: 113.4,
                hasSubscribedWithADiscount: true,
                currentlyAvailableDiscounts: null,
                currentDiscountInPercentage: 40,
              },
              isPremiumUser: true,
              hasAllowedReferral,
              currentActivePlan: 'year',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly (Current)',
                  value: 'year',
                  billedYearly: 'Billed yearly at €113.40',
                  priceMessage: '€9.45/month',
                  discountMessage: '40% off thanks to your past referral!',
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly',
                  value: 'month',
                  priceMessage: '€19.00/month',
                  discountMessage: null,
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: 'Manage Subscription',
              },
              startButton: {
                shouldBeShown: true,
                text: 'Start',
              },
            })
          })
          test('a user with yearly plan who did not click on anything yet', () => {
            const result = getPricingViewConfig({
              isPendingMutation: true,
              clickedPlan: 'year',
              isCreditCardRequiredForAll,
              pricingDetails: {
                amountInEurosThatUserIsCurrentlyPayingPerInterval: 15.2,
                hasSubscribedWithADiscount: true,
                currentlyAvailableDiscounts: null,
                currentDiscountInPercentage: 20,
              },
              isPremiumUser: true,
              hasAllowedReferral,
              currentActivePlan: 'month',
            })
            expect(result).toEqual({
              plans: [
                {
                  label: 'Yearly',
                  value: 'year',
                  billedYearly: 'Billed yearly at €189.00',
                  priceMessage: '€15.75/month',
                  discountMessage: null,
                  additionalMessage: 'best value',
                },
                {
                  label: 'Monthly (Current)',
                  value: 'month',
                  priceMessage: '€15.20/month',
                  discountMessage: '20% off thanks to your past referral!',
                },
              ],
              subscribeButton: {
                isDisabled: false,
                text: 'Loading...',
              },
              startButton: {
                shouldBeShown: true,
                text: 'Start',
              },
            })
          })
        })
      })
    })
  })
})
