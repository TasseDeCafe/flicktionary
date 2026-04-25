'use client'

import React, { useEffect, useState } from 'react'
import { Circle } from 'lucide-react'
import { ButtonLeadingToWebapp } from '@/app/[lang]/(components)/(leading-to-apps)/button-leading-to-webapp'
import { getConfig } from '@/config/environment-config'
import { localStorageWrapper } from '@/lib/storage/local-storage'
import { ALLOWED_REFERRALS, getDiscountsForReferral } from '@template-app/core/constants/referral-constants'
import {
  getCanSubscribeWithReferralDiscount,
  getMonthlyDiscountString,
  getMonthlyPrice,
  getYearlyDiscountString,
  getYearlyPrice,
} from '@/app/[lang]/(components)/(pricing)/pricing-view-utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Discounts } from '@template-app/core/constants/discount-types'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'

export type PlanType = 'free_trial' | 'month' | 'year'

import { ReactNode } from 'react'

type PlanOption = {
  label: ReactNode
  value: PlanType
  priceMessage: ReactNode
  discountMessage: ReactNode | null
  additionalMessage?: ReactNode
  billedYearly?: ReactNode
}

const LeftPartOfButton = ({ option, isChosen }: { option: PlanOption; isChosen: boolean }) => {
  const desktopVersion = (
    <div className='hidden items-center md:flex'>
      <div className='mr-2'>
        {isChosen ? (
          <Circle className='h-5 w-5 fill-indigo-600 text-indigo-600' />
        ) : (
          <Circle className='h-5 w-5 text-gray-400' />
        )}
      </div>
      <div>
        <span>{option.label}</span>
        {option.additionalMessage && (
          <span className='ml-2 rounded-full bg-indigo-100 px-2 py-1 text-sm font-medium whitespace-nowrap text-indigo-800'>
            {option.additionalMessage}
          </span>
        )}
      </div>
    </div>
  )

  const mobileVersion = (
    <div className='flex flex-col items-start gap-y-2 md:hidden'>
      <div className='flex items-center'>
        <div className='mr-2'>
          {isChosen ? (
            <Circle className='h-5 w-5 fill-indigo-600 text-indigo-600' />
          ) : (
            <Circle className='h-5 w-5 text-gray-400' />
          )}
        </div>
        <span>{option.label}</span>
      </div>
      {option.additionalMessage && (
        <span className='rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium whitespace-nowrap text-indigo-800'>
          {option.additionalMessage}
        </span>
      )}
    </div>
  )

  return (
    <>
      {desktopVersion}
      {mobileVersion}
    </>
  )
}

export const PricingSection = () => {
  const { i18n } = useLingui()
  const [planType, setPlanType] = useState<PlanType>('year')
  const [referral, setReferral] = useState<string>('')

  useEffect(() => {
    setReferral(localStorageWrapper.getReferral())
  }, [])

  const discounts: Discounts = getDiscountsForReferral(referral)

  const monthlyDiscountPercentage = discounts.monthly.discountAsPercentage
  const monthlyDurationLimit = discounts.monthly.durationLimit
  const yearlyDiscountPercentage = discounts.yearly.discountAsPercentage
  const yearlyDurationLimit = discounts.yearly.durationLimit
  const hasAllowedReferral = ALLOWED_REFERRALS.includes(referral)
  const canSubscribeWithReferralDiscount = getCanSubscribeWithReferralDiscount(referral, discounts)

  const monthlyPrice = getMonthlyPrice(discounts)
  const yearlyPrice = getYearlyPrice(discounts)

  const planOptions: PlanOption[] = []

  const yearlyPricePerMonth = (yearlyPrice / 12).toFixed(2)
  const yearlyPriceFormatted = yearlyPrice.toFixed(2)
  const monthlyPriceFormatted = monthlyPrice.toFixed(2)

  planOptions.push(
    {
      label: <Trans>Yearly</Trans>,
      value: 'year',
      priceMessage: i18n._(msg`€${yearlyPricePerMonth}/month`),
      discountMessage: canSubscribeWithReferralDiscount
        ? getYearlyDiscountString(
            yearlyDiscountPercentage,
            yearlyDurationLimit,
            i18n._(msg`${yearlyDiscountPercentage}% off with your referral!`),
            i18n._(msg`${yearlyDiscountPercentage}% off for 1 year with your referral!`),
            yearlyDurationLimit
              ? i18n._(msg`${yearlyDiscountPercentage}% off for ${yearlyDurationLimit} years with your referral!`)
              : ''
          )
        : null,
      additionalMessage: <Trans>Best Value</Trans>,
      billedYearly: i18n._(msg`Billed yearly: €${yearlyPriceFormatted}`),
    },
    {
      label: <Trans>Monthly</Trans>,
      value: 'month',
      priceMessage: i18n._(msg`€${monthlyPriceFormatted}/month`),
      discountMessage: canSubscribeWithReferralDiscount
        ? getMonthlyDiscountString(
            monthlyDiscountPercentage,
            monthlyDurationLimit,
            i18n._(msg`${monthlyDiscountPercentage}% off with your referral!`),
            i18n._(msg`${monthlyDiscountPercentage}% off for 1 month with your referral!`),
            monthlyDurationLimit
              ? i18n._(msg`${monthlyDiscountPercentage}% off for ${monthlyDurationLimit} months with your referral!`)
              : ''
          )
        : null,
    }
  )

  if (!hasAllowedReferral && !getConfig().featureFlags.isCreditCardRequiredForAll()) {
    planOptions.push({
      label: <Trans>Free Trial</Trans>,
      value: 'free_trial',
      discountMessage: null,
      priceMessage: <Trans>7 days free</Trans>,
      additionalMessage: <Trans>No Card Required</Trans>,
    })
  }

  const handlePlanOptionClick = (newPlanType: PlanType) => {
    setPlanType(newPlanType)
  }

  const getButtonText = () => {
    if (canSubscribeWithReferralDiscount) {
      return <Trans>Start Free Trial</Trans>
    } else {
      return <Trans>Subscribe Now</Trans>
    }
  }

  return (
    <>
      <Card className='max-w-2xl overflow-hidden rounded-3xl bg-white p-0'>
        <div className='px-6 py-4 md:py-8'>
          <h1 className='w-full text-center text-3xl font-bold text-stone-800'>
            <Trans>Choose Your Plan</Trans>
          </h1>
        </div>
        <div className='px-2 pb-2 md:px-6 md:pb-6'>
          <div className='mb-6 flex flex-col gap-y-4'>
            {planOptions.map((option) => {
              return (
                <Button
                  key={option.value}
                  onClick={() => handlePlanOptionClick(option.value as PlanType)}
                  className={cn('flex h-auto min-h-20 justify-between rounded-lg border px-2 py-4 md:px-4', {
                    'border-indigo-600 bg-indigo-50': planType === option.value,
                    'border-gray-200': planType === option.value,
                  })}
                  shouldHaveHoverAndActiveStyles={planType !== option.value}
                >
                  <LeftPartOfButton option={option} isChosen={planType === option.value} />
                  <div className='text-right'>
                    <div className='font-semibold'>{option.priceMessage}</div>
                    {option.discountMessage && <div className='text-sm text-green-600'>{option.discountMessage}</div>}
                    {option.billedYearly && <div className='text-sm text-gray-500'>{option.billedYearly}</div>}
                  </div>
                </Button>
              )
            })}
          </div>
          <div className='flex w-full flex-col gap-y-4'>
            <ButtonLeadingToWebapp
              analyticsClickName='subscribe_button_in_pricing_section'
              buttonText={getButtonText()}
              className='font-boldtext-lg h-12 w-full bg-amber-500 font-bold text-white'
              planInterval={planType}
            />
          </div>
        </div>
      </Card>
    </>
  )
}
