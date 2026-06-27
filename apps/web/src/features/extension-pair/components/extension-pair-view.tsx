import { useCallback, useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useSearch } from '@tanstack/react-router'
import { Button } from '@flicktionary/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@flicktionary/ui/components/card'
import { useMintExtensionSessionMutation } from '@/features/extension-pair/api/extension-auth-hooks'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { OnboardingView } from '@/features/onboarding/components/onboarding-view'

type Status = 'pairing' | 'sent' | 'no-extension' | 'error'

const EXTENSION_RESPONSE_TIMEOUT_MS = 10_000
const POST_MESSAGE_SOURCE = 'flicktionary-extension-pair'
const EXTENSION_ACK_SOURCE = 'flicktionary-extension-pair-ack'
// Tells the extension pairing is *done* and it can close this tab. Posted
// immediately once paired+onboarded, or after web onboarding completes here.
const FINISHED_SOURCE = 'flicktionary-extension-pair-finished'

export const ExtensionPairView = () => {
  const { t } = useLingui()
  const { nonce } = useSearch({ from: '/_authenticated/extension-pair' })
  const mintSessionMutation = useMintExtensionSessionMutation()
  const mintRef = useRef(mintSessionMutation.mutateAsync)
  mintRef.current = mintSessionMutation.mutateAsync

  const [status, setStatus] = useState<Status>('pairing')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // The pairing page now decides when pairing is done (the extension dropped its
  // auto-close timer). Onboarded → post immediately; not-onboarded → post after
  // web onboarding. Guarded so the once-path can't double-fire across a prefs
  // refetch; the manual fallback uses the raw poster to retry on demand.
  const finishedPostedRef = useRef(false)
  const postFinished = useCallback(() => {
    window.postMessage({ source: FINISHED_SOURCE, nonce }, window.location.origin)
  }, [nonce])
  const postFinishedOnce = useCallback(() => {
    if (finishedPostedRef.current) return
    finishedPostedRef.current = true
    postFinished()
  }, [postFinished])

  // Depends on `nonce` ONLY — no `t`, no one-shot ref. `t` changes identity
  // when UserUiPrefsSync activates the user's locale right after boot; a
  // dependency on it cancelled the in-flight mint mid-pairing while a
  // module-lifetime "already triggered" guard kept the re-run from doing
  // anything, so the page hung on "Pairing..." forever whenever the prefs
  // response beat the mint. Translated fallbacks live at render time instead.
  useEffect(() => {
    let cancelled = false
    let extensionResponded = false
    let timeoutHandle: number | undefined

    const onAck = (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.origin !== window.location.origin) return
      const data = event.data as { source?: string; nonce?: string; ok?: boolean; error?: string } | undefined
      if (!data || data.source !== EXTENSION_ACK_SOURCE) return
      if (data.nonce !== nonce) return
      extensionResponded = true
      if (data.ok === false) {
        setErrorMessage(data.error ?? null)
        setStatus('error')
        return
      }
      setStatus('sent')
    }

    window.addEventListener('message', onAck)

    const run = async () => {
      try {
        const result = await mintRef.current({ nonce })
        if (cancelled) return

        window.postMessage(
          {
            source: POST_MESSAGE_SOURCE,
            tokenHash: result.data.tokenHash,
            email: result.data.email,
            nonce,
          },
          window.location.origin
        )

        timeoutHandle = window.setTimeout(() => {
          if (!extensionResponded && !cancelled) {
            setStatus('no-extension')
          }
        }, EXTENSION_RESPONSE_TIMEOUT_MS)
      } catch (err) {
        if (cancelled) return
        setErrorMessage(err instanceof Error ? err.message : null)
        setStatus('error')
      }
    }

    void run()

    return () => {
      cancelled = true
      window.removeEventListener('message', onAck)
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
    }
  }, [nonce])

  // Read prefs to decide post-pairing routing. NOT added to the mint effect's
  // deps (it is deliberately keyed on `nonce` only — see the comment above);
  // branched in render/derived state instead.
  const prefsQuery = useGetUserPrefs()
  const prefs = prefsQuery.data

  // Onboarded accounts finish the moment pairing acks — keep today's UX (the
  // tab closes immediately, no onboarding shown).
  useEffect(() => {
    if (status === 'sent' && prefs?.isOnboarded) {
      postFinishedOnce()
    }
  }, [status, prefs?.isOnboarded, postFinishedOnce])

  // A not-onboarded account runs web onboarding right here in the pairing tab,
  // so the single onboarding surface (and its gate) can't drift from the
  // extension. Completing it posts the finished signal from the "Get started"
  // button.
  if (status === 'sent' && prefs && !prefs.isOnboarded) {
    return <OnboardingView variant='extensionPair' onFinish={postFinishedOnce} />
  }

  // Manual fallback shown when the tab can no longer auto-close itself: a
  // tabs.create tab can't window.close(), so we re-post the finished signal and
  // tell the user to close the tab if the extension doesn't.
  const closeFallback = (
    <div className='space-y-2'>
      <Button type='button' variant='outline' size='sm' onClick={postFinished}>
        {t`Return to the extension`}
      </Button>
      <p className='text-xs text-stone-500'>{t`If this tab does not close on its own, you can close it now.`}</p>
    </div>
  )

  return (
    <main className='flex flex-1 justify-center overflow-y-auto p-4'>
      <div className='w-full max-w-md'>
        <Card>
          <CardHeader>
            <CardTitle>{t`Pair the Flicktionary extension`}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm text-stone-700'>
            {status === 'pairing' && <p>{t`Pairing your browser extension...`}</p>}
            {status === 'sent' && prefsQuery.isError && (
              <>
                <p>{t`Pairing complete, but we could not load your profile.`}</p>
                <div className='space-y-2'>
                  <Button type='button' variant='outline' size='sm' onClick={() => void prefsQuery.refetch()}>
                    {t`Try again`}
                  </Button>
                  {closeFallback}
                </div>
              </>
            )}
            {status === 'sent' && !prefsQuery.isError && (
              <>
                <p>{t`Pairing complete — closing this tab and returning you to the extension...`}</p>
                {/* If prefs are still loading we don't yet know whether to onboard; the
                    fallback lets the user bail out rather than wait indefinitely. */}
                {(prefs?.isOnboarded || prefsQuery.isLoading) && closeFallback}
              </>
            )}
            {status === 'no-extension' && (
              <>
                <p>{t`We did not hear back from a Flicktionary extension on this device.`}</p>
                <p>{t`Make sure the extension is installed and try again from its popup.`}</p>
              </>
            )}
            {status === 'error' && (
              <>
                <p>{t`Something went wrong while pairing.`}</p>
                {errorMessage && <p className='text-stone-500'>{errorMessage}</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
