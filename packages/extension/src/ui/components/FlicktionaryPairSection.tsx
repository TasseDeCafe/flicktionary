import { useEffect, useState } from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ButtonGroup from '@mui/material/ButtonGroup'
import Button from '@mui/material/Button'
import { Plural, Trans } from '@lingui/react/macro'
import { getFlicktionaryApiClient } from '@/services/flicktionary/flicktionary-api-client'
import {
  clearFlicktionaryAuth,
  FlicktionaryAuthState,
  getFlicktionaryAuth,
  onFlicktionaryAuthChange,
} from '@/services/flicktionary/auth-storage'
import { openFlicktionaryPairingTab } from '@/services/flicktionary/start-pairing'
import {
  getFlicktionarySessionHighlightCount,
  onFlicktionarySessionHighlightCountChange,
} from '@/services/flicktionary/session-highlight-counter'

export const FlicktionaryPairSection = () => {
  const [auth, setAuth] = useState<FlicktionaryAuthState | null>(null)
  const [pairing, setPairing] = useState(false)
  const [highlightCount, setHighlightCount] = useState(0)

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

  useEffect(() => {
    let active = true
    void getFlicktionarySessionHighlightCount().then((value) => {
      if (active) setHighlightCount(value)
    })
    const unsubscribe = onFlicktionarySessionHighlightCountChange((value) => {
      setHighlightCount(value)
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
    <Paper variant='outlined' sx={{ p: 1.5 }}>
      <Typography variant='body2' sx={{ mb: 1 }}>
        <Trans>Flicktionary</Trans>
      </Typography>
      {auth ? (
        <>
          <Typography variant='caption' sx={{ display: 'block', mb: 1 }}>
            <Trans>Signed in as {auth.email}</Trans>
            {' · '}
            <Plural value={highlightCount} one='# highlight this session' other='# highlights this session' />
          </Typography>
          <ButtonGroup fullWidth size='small' variant='outlined'>
            <Button color='error' onClick={handleUnpair}>
              <Trans>Sign out</Trans>
            </Button>
          </ButtonGroup>
        </>
      ) : (
        <ButtonGroup fullWidth size='small' variant='outlined'>
          <Button onClick={handlePair} disabled={pairing}>
            {pairing ? <Trans>Signing in…</Trans> : <Trans>Sign in with Flicktionary</Trans>}
          </Button>
        </ButtonGroup>
      )}
    </Paper>
  )
}
