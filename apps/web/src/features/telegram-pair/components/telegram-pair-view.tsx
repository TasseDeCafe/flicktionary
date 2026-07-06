import { useCallback, useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useSearch } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@flicktionary/ui/components/card'
import {
  useClaimTelegramPairMutation,
  useCompleteTelegramPendingMutation,
} from '@/features/telegram-pair/api/telegram-pair-hooks'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { OnboardingView } from '@/features/onboarding/components/onboarding-view'

type Status = 'pairing' | 'paired' | 'error'

export const TelegramPairView = () => {
  const { t } = useLingui()
  const { nonce } = useSearch({ from: '/_authenticated/telegram-pair' })
  const claimMutation = useClaimTelegramPairMutation()
  const claimRef = useRef(claimMutation.mutateAsync)
  claimRef.current = claimMutation.mutateAsync
  const completePendingMutation = useCompleteTelegramPendingMutation()
  const completePendingRef = useRef(completePendingMutation.mutate)
  completePendingRef.current = completePendingMutation.mutate

  const [status, setStatus] = useState<Status>('pairing')
  const [onboardingDone, setOnboardingDone] = useState(false)

  // The stashed import must only resume once, and only after onboarding has
  // set the native language — the guarded once-path covers both arrival
  // orders (prefs landing before/after the claim resolves).
  const completePostedRef = useRef(false)
  const completePendingOnce = useCallback(() => {
    if (completePostedRef.current) return
    completePostedRef.current = true
    completePendingRef.current({})
  }, [])

  // Depends on `nonce` ONLY — same lesson as extension-pair-view: `t` changes
  // identity when UserUiPrefsSync activates the user's locale right after
  // boot, and an effect keyed on it would cancel the in-flight claim.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        await claimRef.current({ nonce })
        if (cancelled) return
        setStatus('paired')
      } catch {
        if (cancelled) return
        setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [nonce])

  const prefsQuery = useGetUserPrefs()
  const prefs = prefsQuery.data

  // Already-onboarded accounts resume the import the moment pairing lands;
  // fresh signups resume from OnboardingView's finish callback instead.
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- converges two async arrivals (the claim flipping `status` and the prefs query landing); either can complete last, so there is no single event site to move this into
    if (status === 'paired' && prefs?.isOnboarded) {
      completePendingOnce()
    }
  }, [status, prefs?.isOnboarded, completePendingOnce])

  // A not-onboarded account runs web onboarding right here in the pairing tab
  // (same single-onboarding-surface rule as the extension pairing flow). The
  // import resumes only when onboarding finishes — before that the user has
  // no native language and the import would bounce.
  if (status === 'paired' && prefs && !prefs.isOnboarded && !onboardingDone) {
    return (
      <OnboardingView
        variant='telegramPair'
        onFinish={() => {
          completePendingOnce()
          setOnboardingDone(true)
        }}
      />
    )
  }

  return (
    <main className='flex flex-1 justify-center overflow-y-auto p-4'>
      <div className='w-full max-w-md'>
        <Card>
          <CardHeader>
            <CardTitle>{t`Connect Telegram`}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm text-stone-700'>
            {status === 'pairing' && <p>{t`Connecting your Telegram chat...`}</p>}
            {status === 'paired' && (
              <>
                <p>{t`Telegram connected!`}</p>
                <p>{t`Head back to your Telegram chat — if you sent a text, your reading link is on its way.`}</p>
              </>
            )}
            {status === 'error' && (
              <>
                <p>{t`This connection link has already been used or has expired.`}</p>
                <p>{t`Send the bot another message to get a fresh link.`}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
