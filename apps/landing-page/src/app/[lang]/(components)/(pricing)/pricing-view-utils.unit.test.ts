import { describe, expect, test } from 'vitest'
import {
  getMonthlyDiscountString,
  getMonthlyPrice,
  getYearlyDiscountString,
  getYearlyPrice,
} from './pricing-view-utils'
import { Discounts } from '@template-app/core/constants/discount-types'

describe('pricing-view-utils', () => {
  const referralDiscountLabel = '{discount}% off with your referral forever!'
  const referralDiscountMonthLabel = '{discount}% off with your referral for 1 month!'
  const referralDiscountMonthsLabel = '{discount}% off with your referral for {duration} months!'
  const referralDiscountYearLabel = '{discount}% off with your referral for 1 year!'
  const referralDiscountYearsLabel = '{discount}% off with your referral for {duration} years!'

  describe('getMonthlyPrice', () => {
    const activeDiscounts: Discounts = {
      areActive: true,
      monthly: {
        discountAsPercentage: 20,
        stripeCouponId: 'test_monthly',
        commissionLimit: null,
        durationLimit: null,
      },
      yearly: {
        discountAsPercentage: 40,
        stripeCouponId: 'test_yearly',
        commissionLimit: null,
        durationLimit: null,
      },
    }

    const inactiveDiscounts: Discounts = {
      areActive: false,
      monthly: {
        discountAsPercentage: 20,
        stripeCouponId: 'test_monthly',
        commissionLimit: null,
        durationLimit: null,
      },
      yearly: {
        discountAsPercentage: 40,
        stripeCouponId: 'test_yearly',
        commissionLimit: null,
        durationLimit: null,
      },
    }

    test('returns full price when no active discounts in EUR', () => {
      expect(getMonthlyPrice(inactiveDiscounts)).toBe(19)
    })

    test('returns discounted price when active discounts in EUR', () => {
      expect(getMonthlyPrice(activeDiscounts)).toBe(15.2)
    })
  })

  describe('getYearlyPrice', () => {
    const activeDiscounts: Discounts = {
      areActive: true,
      monthly: {
        discountAsPercentage: 20,
        stripeCouponId: 'test_monthly',
        commissionLimit: null,
        durationLimit: null,
      },
      yearly: {
        discountAsPercentage: 40,
        stripeCouponId: 'test_yearly',
        commissionLimit: null,
        durationLimit: null,
      },
    }

    const inactiveDiscounts: Discounts = {
      areActive: false,
      monthly: {
        discountAsPercentage: 20,
        stripeCouponId: 'test_monthly',
        commissionLimit: null,
        durationLimit: null,
      },
      yearly: {
        discountAsPercentage: 40,
        stripeCouponId: 'test_yearly',
        commissionLimit: null,
        durationLimit: null,
      },
    }

    test('returns full price when no active discounts in EUR', () => {
      expect(getYearlyPrice(inactiveDiscounts)).toBe(189)
    })

    test('returns discounted price when active discounts in EUR', () => {
      expect(getYearlyPrice(activeDiscounts)).toBe(113.4)
    })
  })

  describe('getMonthlyDiscountString', () => {
    test('20% off with your referral for 1 month!', () => {
      expect(
        getMonthlyDiscountString(20, 1, referralDiscountLabel, referralDiscountMonthLabel, referralDiscountMonthsLabel)
      ).toEqual('20% off with your referral for 1 month!')
    })

    test('20% off with your referral for 3 months!', () => {
      expect(
        getMonthlyDiscountString(20, 3, referralDiscountLabel, referralDiscountMonthLabel, referralDiscountMonthsLabel)
      ).toEqual('20% off with your referral for 3 months!')
    })

    test('20% off with your referral forever!', () => {
      expect(
        getMonthlyDiscountString(
          20,
          null,
          referralDiscountLabel,
          referralDiscountMonthLabel,
          referralDiscountMonthsLabel
        )
      ).toEqual('20% off with your referral forever!')
    })
  })

  describe('getYearlyDiscountString', () => {
    test('20% off with your referral for 1 year!', () => {
      expect(
        getYearlyDiscountString(20, 1, referralDiscountLabel, referralDiscountYearLabel, referralDiscountYearsLabel)
      ).toEqual('20% off with your referral for 1 year!')
    })

    test('40% off with your referral for 2 years!', () => {
      expect(
        getYearlyDiscountString(40, 2, referralDiscountLabel, referralDiscountYearLabel, referralDiscountYearsLabel)
      ).toEqual('40% off with your referral for 2 years!')
    })

    test('15% off with your referral forever!', () => {
      expect(
        getYearlyDiscountString(15, null, referralDiscountLabel, referralDiscountYearLabel, referralDiscountYearsLabel)
      ).toEqual('15% off with your referral forever!')
    })
  })
})
