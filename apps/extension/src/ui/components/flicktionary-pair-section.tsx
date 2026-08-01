import { useEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@flicktionary/ui/components/button'
import { getFlicktionaryApiClient } from '@/services/flicktionary/flicktionary-api-client'
import {
  clearFlicktionaryAuth,
  FlicktionaryAuthState,
  getFlicktionaryAuth,
  onFlicktionaryAuthChange,
} from '@/services/flicktionary/auth-storage'
import { openFlicktionaryPairingTab } from '@/services/flicktionary/start-pairing'
import { clearFlicktionarySessionCache } from '@/services/flicktionary/youtube-session-cache'

export const FlicktionaryPairSection = () => {
  const [auth, setAuth] = useState<FlicktionaryAuthState | null>(null)
  const [pairing, setPairing] = useState(false)

  useEffect(() => {
    let active = true
    void getFlicktionaryAuth().then((value) => {
      if (active) setAuth(value)
    })
    const unsubscribe = onFlicktionaryAuthChange((value) => {
      setAuth(value)
      setPairing(false)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const handlePair = async () => {
    setPairing(true)
    try {
      await openFlicktionaryPairingTab()
    } catch (error) {
      console.error('Failed to start Flicktionary pairing', error)
      setPairing(false)
    }
  }

  const unpairMutation = useMutation({
    mutationFn: () => getFlicktionaryApiClient().extensionAuth.revokeSession({}),
    // Sign-out must always succeed locally — a failed revoke (expired token,
    // offline) only gets a console.warn, never a toast, and the local auth is
    // cleared regardless (same semantics as the old try/catch).
    meta: { showErrorToast: false },
    onError: (error) => console.warn('Failed to revoke Flicktionary session before unpairing', error),
    // The session cache is account-scoped in effect (session/segment ids), so
    // it goes with the identity — a later sign-in must not inherit it.
    onSettled: () => Promise.all([clearFlicktionaryAuth(), clearFlicktionarySessionCache()]),
  })

  const handleUnpair = () => unpairMutation.mutate()

  return (
    <div className='rounded-lg border p-3'>
      <p className='mb-2 text-sm'>
        <Trans>Flicktionary</Trans>
      </p>
      {auth && !auth.isGuest ? (
        <>
          <p className='text-muted-foreground mb-2 text-xs'>
            <Trans>Signed in as {auth.email}</Trans>
          </p>
          <Button type='button' variant='outline' size='sm' className='text-destructive w-full' onClick={handleUnpair}>
            <Trans>Sign out</Trans>
          </Button>
        </>
      ) : auth?.isGuest ? (
        // A guest session is gloss-only and holds nothing worth revoking, so
        // there's no sign-out here — only the upgrade path (the normal pairing
        // flow, which replaces the guest session with the account's).
        <>
          <p className='text-muted-foreground mb-2 text-xs'>
            <Trans>Using Flicktionary as a guest — translations only.</Trans>
          </p>
          <Button type='button' variant='outline' size='sm' className='w-full' onClick={handlePair} disabled={pairing}>
            {pairing ? <Trans>Signing in…</Trans> : <Trans>Create free account</Trans>}
          </Button>
        </>
      ) : (
        <Button type='button' variant='outline' size='sm' className='w-full' onClick={handlePair} disabled={pairing}>
          {pairing ? <Trans>Signing in…</Trans> : <Trans>Sign in with Flicktionary</Trans>}
        </Button>
      )}
    </div>
  )
}
