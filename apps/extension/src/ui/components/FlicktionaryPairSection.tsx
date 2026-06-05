import { useEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { getFlicktionaryApiClient } from '@/services/flicktionary/flicktionary-api-client'
import {
  clearFlicktionaryAuth,
  FlicktionaryAuthState,
  getFlicktionaryAuth,
  onFlicktionaryAuthChange,
} from '@/services/flicktionary/auth-storage'
import { openFlicktionaryPairingTab } from '@/services/flicktionary/start-pairing'

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

  const handleUnpair = async () => {
    try {
      await getFlicktionaryApiClient().extensionAuth.revokeSession({})
    } catch (error) {
      console.warn('Failed to revoke Flicktionary session before unpairing', error)
    }
    await clearFlicktionaryAuth()
  }

  return (
    <div className='rounded-lg border p-3'>
      <p className='mb-2 text-sm'>
        <Trans>Flicktionary</Trans>
      </p>
      {auth ? (
        <>
          <p className='text-muted-foreground mb-2 text-xs'>
            <Trans>Signed in as {auth.email}</Trans>
          </p>
          <Button type='button' variant='outline' size='sm' className='text-destructive w-full' onClick={handleUnpair}>
            <Trans>Sign out</Trans>
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
