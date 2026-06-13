import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useSearch } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@flicktionary/ui/components/card'
import { useMintExtensionSessionMutation } from '@/features/extension-pair/api/extension-auth-hooks'

type Status = 'pairing' | 'sent' | 'no-extension' | 'error'

const EXTENSION_RESPONSE_TIMEOUT_MS = 10_000
const POST_MESSAGE_SOURCE = 'flicktionary-extension-pair'
const EXTENSION_ACK_SOURCE = 'flicktionary-extension-pair-ack'

export const ExtensionPairView = () => {
  const { t } = useLingui()
  const { nonce } = useSearch({ from: '/_authenticated/extension-pair' })
  const mintSessionMutation = useMintExtensionSessionMutation()
  const mintRef = useRef(mintSessionMutation.mutateAsync)
  mintRef.current = mintSessionMutation.mutateAsync

  const [status, setStatus] = useState<Status>('pairing')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  return (
    <main className='flex flex-1 justify-center overflow-y-auto p-4'>
      <div className='w-full max-w-md'>
        <Card>
          <CardHeader>
            <CardTitle>{t`Pair the Flicktionary extension`}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm text-stone-700'>
            {status === 'pairing' && <p>{t`Pairing your browser extension...`}</p>}
            {status === 'sent' && <p>{t`Pairing complete — closing this tab and returning you to the extension...`}</p>}
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
