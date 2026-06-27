import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useMutation } from '@tanstack/react-query'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { getFlicktionaryApiClient } from '@/services/flicktionary/flicktionary-api-client'
import { CEFR_LEVELS } from '@/services/flicktionary/flicktionary-client'

// Discriminated result of the import round-trip. `needs-cefr` is a typed result
// (NOT a throw) because the picker needs the language, which a thrown Error
// can't carry. Genuine failures still throw and render inline below.
type ImportResult = { kind: 'ok' } | { kind: 'needs-cefr'; targetLanguage: string }

// Popup affordance for importing the current page's article into Flicktionary.
// Delegates to the background handler (which runs Readability in the active tab
// and opens the new reading session); on success the new tab closes the popup,
// so we only render inline feedback for the failure path. When the detected
// language has no CEFR level set, the background returns `needsCefr` and we host
// an inline A1–C2 picker that sets the level and replays the import (mirroring
// the in-video CEFR picker), instead of dead-ending on a toast.
export const FlicktionaryImportSection = () => {
  const { t } = useLingui()
  // Set while the detected language needs a CEFR level; drives the inline picker
  // and is reused as the replay's target language.
  const [pendingCefrLanguage, setPendingCefrLanguage] = useState<string | null>(null)

  const importMutation = useMutation({
    mutationFn: async (isCefrRetry: boolean): Promise<ImportResult> => {
      const response = (await browser.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'flicktionary-import-article', isCefrRetry },
      })) as { success: boolean; error?: string; needsCefr?: boolean; targetLanguage?: string } | undefined
      if (response?.success) {
        return { kind: 'ok' }
      }
      if (response?.needsCefr && response.targetLanguage) {
        return { kind: 'needs-cefr', targetLanguage: response.targetLanguage }
      }
      throw new Error(response?.error ?? t`Could not import this page.`)
    },
    onSuccess: (result) => {
      setPendingCefrLanguage(result.kind === 'needs-cefr' ? result.targetLanguage : null)
    },
    // The inline message below handles the failure path.
    meta: { showErrorToast: false },
  })

  const setCefrMutation = useMutation({
    mutationFn: async (cefrLevel: string) => {
      if (!pendingCefrLanguage) return
      await getFlicktionaryApiClient().userPrefs.setCefrForLanguage({
        targetLanguage: pendingCefrLanguage,
        cefrLevel,
      })
    },
    meta: { showErrorToast: false },
    onSuccess: () => {
      setPendingCefrLanguage(null)
      importMutation.mutate(true)
    },
  })

  const error = pendingCefrLanguage === null ? (importMutation.error?.message ?? null) : null
  const busy = importMutation.isPending || setCefrMutation.isPending
  const pendingLanguageName = pendingCefrLanguage ? getLanguageName(pendingCefrLanguage) : ''

  return (
    <div className='rounded-lg border p-3'>
      {pendingCefrLanguage ? (
        <div className='flex flex-col gap-2'>
          <p className='text-sm'>
            <Trans>Your {pendingLanguageName} level</Trans>
          </p>
          <p className='text-muted-foreground text-xs'>
            <Trans>Set this once to start importing text in this language.</Trans>
          </p>
          <div className='grid grid-cols-3 gap-2'>
            {CEFR_LEVELS.map((level) => (
              <Button
                key={level}
                type='button'
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() => setCefrMutation.mutate(level)}
              >
                {level}
              </Button>
            ))}
          </div>
          {setCefrMutation.isError && (
            <p className='text-destructive text-xs'>
              <Trans>Could not save your level. Please try again.</Trans>
            </p>
          )}
        </div>
      ) : (
        <>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='w-full'
            onClick={() => importMutation.mutate(false)}
            disabled={busy}
          >
            {importMutation.isPending ? <Trans>Importing…</Trans> : <Trans>Import this article</Trans>}
          </Button>
          {error && <p className='text-destructive mt-2 text-xs'>{error}</p>}
        </>
      )}
    </div>
  )
}
