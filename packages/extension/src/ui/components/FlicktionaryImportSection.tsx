import { useState } from 'react'
import Paper from '@mui/material/Paper'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Typography from '@mui/material/Typography'
import { Trans, useLingui } from '@lingui/react/macro'

// Popup affordance for importing the current page's article into Flicktionary.
// Delegates to the background handler (which runs Readability in the active tab
// and opens the new reading session); on success the new tab closes the popup,
// so we only render inline feedback for the failure path.
export const FlicktionaryImportSection = () => {
  const { t } = useLingui()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleImport = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = (await browser.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'flicktionary-import-article' },
      })) as { success: boolean; error?: string } | undefined
      if (!response?.success) {
        setError(response?.error ?? t`Could not import this page.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t`Could not import this page.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant='outlined' sx={{ p: 1.5 }}>
      <ButtonGroup fullWidth size='small' variant='outlined'>
        <Button onClick={handleImport} disabled={busy}>
          {busy ? <Trans>Importing…</Trans> : <Trans>Import this article</Trans>}
        </Button>
      </ButtonGroup>
      {error && (
        <Typography variant='caption' color='error' sx={{ display: 'block', mt: 1 }}>
          {error}
        </Typography>
      )}
    </Paper>
  )
}
