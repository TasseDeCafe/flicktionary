'use client'

import { useEffect, use } from 'react'
import { redirect } from 'next/navigation'
import { localStorageWrapper } from '@/lib/storage/local-storage'
import { ALLOWED_REFERRALS } from '@template-app/core/constants/referral-constants'

const PartnerRedirect = ({ params }: { params: Promise<{ partnerId: string }> }) => {
  const { partnerId } = use(params)

  useEffect(() => {
    const url = new URL(window.location.href)
    const urlParams = new URLSearchParams(url.search)

    if (partnerId) {
      const referralFromLocalStorage = localStorageWrapper.getReferral()
      if (!referralFromLocalStorage && ALLOWED_REFERRALS.includes(partnerId)) {
        localStorageWrapper.setReferral(partnerId)
      }
    }

    if (!urlParams.has('utm_campaign')) {
      urlParams.set('utm_campaign', partnerId)
    }

    redirect(`/?${urlParams.toString()}`)
  }, [partnerId])

  return (
    <div className='flex h-full w-full items-center justify-center text-center text-2xl'>
      <span>Redirecting...</span>
    </div>
  )
}

export default PartnerRedirect
