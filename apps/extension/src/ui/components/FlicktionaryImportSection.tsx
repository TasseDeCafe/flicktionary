import { Trans, useLingui } from '@lingui/react/macro'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@flicktionary/ui/components/button'

// Popup affordance for importing the current page's article into Flicktionary.
// Delegates to the background handler (which runs Readability in the active tab
// and opens the new reading session); on success the new tab closes the popup,
// so we only render inline feedback for the failure path.
export const FlicktionaryImportSection = () => {
  const { t } = useLingui()

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = (await browser.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'flicktionary-import-article' },
      })) as { success: boolean; error?: string } | undefined
      if (!response?.success) {
        throw new Error(response?.error ?? t`Could not import this page.`)
      }
    },
    // The inline message below handles the failure path.
    meta: { showErrorToast: false },
  })

  const error = importMutation.error?.message ?? null

  return (
    <div className='rounded-lg border p-3'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='w-full'
        onClick={() => importMutation.mutate()}
        disabled={importMutation.isPending}
      >
        {importMutation.isPending ? <Trans>Importing…</Trans> : <Trans>Import this article</Trans>}
      </Button>
      {error && <p className='text-destructive mt-2 text-xs'>{error}</p>}
    </div>
  )
}
