import { OverlayContent, OverlayDescription, OverlayHeader, OverlayTitle } from '@/components/ui/responsive-overlay'
import { RefreshButton } from './refresh-button'
import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'

const COUNTDOWN_TIME = 15 // seconds

export const RateLimitingOverlayContent = () => {
  const { t } = useLingui()

  const [countdown, setCountdown] = useState(COUNTDOWN_TIME)
  const isRetryEnabled = countdown === 0

  useEffect(() => {
    if (countdown === 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  return (
    <OverlayContent className='sm:max-w-md'>
      <OverlayHeader>
        <OverlayTitle className='text-center'>{t`Too Many Requests`}</OverlayTitle>
        <OverlayDescription className='text-center'>
          {t`Too many requests. Please use the app in only one tab and device at a time and try again later.`}
        </OverlayDescription>
      </OverlayHeader>
      <div className='flex flex-col gap-4'>
        <div className='flex h-6 items-center justify-center'>
          {!isRetryEnabled && (
            <p className='text-muted-foreground text-sm'>{t`You can try again in ${countdown} seconds`}</p>
          )}
        </div>
        <RefreshButton disabled={!isRetryEnabled} />
      </div>
    </OverlayContent>
  )
}
