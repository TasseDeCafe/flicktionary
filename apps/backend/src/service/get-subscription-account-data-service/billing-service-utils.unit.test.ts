import { describe, expect, test } from 'vitest'
import { calculateStripePricingDetails } from './billing-service-utils'
import { referralToDiscount } from '@template-app/core/constants/referral-constants'
import { Discounts } from '@template-app/core/constants/discount-types'

describe('calculatePricingDetails', () => {
  const tiengosActiveDiscountsAsMap: Record<string, Discounts> = {
    tiengos: {
      areActive: true,
      monthly: {
        discountAsPercentage: 20,
        stripeCouponId: 'sound_like_a_russian_monthly',
        commissionLimit: null,
        durationLimit: null,
      },
      yearly: {
        discountAsPercentage: 40,
        stripeCouponId: 'tiengos_yearly',
        commissionLimit: null,
        durationLimit: null,
      },
    },
  }
  const tiengosInactiveDiscountsAsMap: Record<string, Discounts> = {
    tiengos: {
      areActive: false,
      monthly: {
        discountAsPercentage: 20,
        stripeCouponId: 'tiengos_monthly',
        commissionLimit: null,
        durationLimit: null,
      },
      yearly: {
        discountAsPercentage: 40,
        stripeCouponId: 'tiengos_yearly',
        commissionLimit: null,
        durationLimit: null,
      },
    },
  }

  describe('discounts connected to real campaigns', () => {
    test('languageboost', () => {
      const pricingDetails = calculateStripePricingDetails('languageboost', referralToDiscount, null, null)
      expect(pricingDetails).toEqual({
        amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
        currentDiscountInPercentage: 0,
        hasSubscribedWithADiscount: false,
        currentlyAvailableDiscounts: null,
      })
    })
    test('tiengos', () => {
      const pricingDetails = calculateStripePricingDetails('tiengos', referralToDiscount, null, null)
      expect(pricingDetails).toEqual({
        amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
        currentDiscountInPercentage: 0,
        hasSubscribedWithADiscount: false,
        currentlyAvailableDiscounts: {
          monthly: {
            discountAsPercentage: 20,
            durationLimit: 3,
          },
          yearly: {
            discountAsPercentage: 40,
            durationLimit: 1,
          },
        },
      })
    })
  })

  describe('when discounts are still active', () => {
    describe('when user has no referral', () => {
      test('a user who is not subscribed', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosActiveDiscountsAsMap, null, null)
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
      test('a user who is subscribed to free_trial', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosActiveDiscountsAsMap, null, 'free_trial')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
      test('a user who is subscribed monthly', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosActiveDiscountsAsMap, 19, 'month')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: 19,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
      test('a user who is subscribed yearly', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosActiveDiscountsAsMap, 189, 'year')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: 189,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
    })

    describe('when user has a referral', () => {
      test('a user who is not subscribed', () => {
        const pricingDetails = calculateStripePricingDetails('tiengos', tiengosActiveDiscountsAsMap, null, null)
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: {
            monthly: {
              discountAsPercentage: 20,
              durationLimit: null,
            },
            yearly: {
              discountAsPercentage: 40,
              durationLimit: null,
            },
          },
        })
      })

      test('a user who is subscribed to free_trial', () => {
        const pricingDetails = calculateStripePricingDetails('tiengos', tiengosActiveDiscountsAsMap, null, 'free_trial')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: {
            monthly: {
              discountAsPercentage: 20,
              durationLimit: null,
            },
            yearly: {
              discountAsPercentage: 40,
              durationLimit: null,
            },
          },
        })
      })

      describe('a user who subscribed without a discount', () => {
        test('a user who is subscribed monthly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosActiveDiscountsAsMap, 19, 'month')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 19,
            currentDiscountInPercentage: 0,
            hasSubscribedWithADiscount: false,
            currentlyAvailableDiscounts: {
              monthly: {
                discountAsPercentage: 20,
                durationLimit: null,
              },
              yearly: {
                discountAsPercentage: 40,
                durationLimit: null,
              },
            },
          })
        })
        test('a user who is subscribed yearly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosActiveDiscountsAsMap, 189, 'year')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 189,
            currentDiscountInPercentage: 0,
            hasSubscribedWithADiscount: false,
            currentlyAvailableDiscounts: {
              monthly: {
                discountAsPercentage: 20,
                durationLimit: null,
              },
              yearly: {
                discountAsPercentage: 40,
                durationLimit: null,
              },
            },
          })
        })
      })

      describe('a user who subscribed with a discount', () => {
        test('a user who is subscribed monthly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosActiveDiscountsAsMap, 15.2, 'month')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 15.2,
            currentDiscountInPercentage: 20,
            hasSubscribedWithADiscount: true,
            currentlyAvailableDiscounts: {
              monthly: {
                discountAsPercentage: 20,
                durationLimit: null,
              },
              yearly: {
                discountAsPercentage: 40,
                durationLimit: null,
              },
            },
          })
        })
        test('a user who is subscribed yearly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosActiveDiscountsAsMap, 113.4, 'year')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 113.4,
            currentDiscountInPercentage: 40,
            hasSubscribedWithADiscount: true,
            currentlyAvailableDiscounts: {
              monthly: {
                discountAsPercentage: 20,
                durationLimit: null,
              },
              yearly: {
                discountAsPercentage: 40,
                durationLimit: null,
              },
            },
          })
        })
      })
    })
  })

  // discounts might not be active because the campaign has not started yet or already finished
  describe('when discounts are not active', () => {
    describe('when user has no referral', () => {
      test('a user who is not subscribed', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosInactiveDiscountsAsMap, null, null)
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
      test('a user who is subscribed to free_trial', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosInactiveDiscountsAsMap, null, 'free_trial')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
      test('a user who is subscribed monthly', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosInactiveDiscountsAsMap, 19, 'month')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: 19,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
      test('a user who is subscribed yearly', () => {
        const pricingDetails = calculateStripePricingDetails(null, tiengosInactiveDiscountsAsMap, 189, 'year')
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: 189,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })
    })

    describe('when user has a referral', () => {
      test('a user who is not subscribed', () => {
        const pricingDetails = calculateStripePricingDetails('tiengos', tiengosInactiveDiscountsAsMap, null, null)
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })

      test('a user who is subscribed to free_trial', () => {
        const pricingDetails = calculateStripePricingDetails(
          'tiengos',
          tiengosInactiveDiscountsAsMap,
          null,
          'free_trial'
        )
        expect(pricingDetails).toEqual({
          amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
          currentDiscountInPercentage: 0,
          hasSubscribedWithADiscount: false,
          currentlyAvailableDiscounts: null,
        })
      })

      describe('a user who subscribed without a discount', () => {
        test('a user who is subscribed monthly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosInactiveDiscountsAsMap, 19, 'month')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 19,
            currentDiscountInPercentage: 0,
            hasSubscribedWithADiscount: false,
            currentlyAvailableDiscounts: null,
          })
        })
        test('a user who is subscribed yearly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosInactiveDiscountsAsMap, 189, 'year')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 189,
            currentDiscountInPercentage: 0,
            hasSubscribedWithADiscount: false,
            currentlyAvailableDiscounts: null,
          })
        })
      })

      describe('a user who subscribed with a discount', () => {
        test('a user who is subscribed monthly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosInactiveDiscountsAsMap, 15.2, 'month')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 15.2,
            currentDiscountInPercentage: 20,
            hasSubscribedWithADiscount: true,
            currentlyAvailableDiscounts: null,
          })
        })
        test('a user who is subscribed yearly', () => {
          const pricingDetails = calculateStripePricingDetails('tiengos', tiengosInactiveDiscountsAsMap, 113.4, 'year')
          expect(pricingDetails).toEqual({
            amountInEurosThatUserIsCurrentlyPayingPerInterval: 113.4,
            currentDiscountInPercentage: 40,
            hasSubscribedWithADiscount: true,
            currentlyAvailableDiscounts: null,
          })
        })
      })
    })
  })
})
