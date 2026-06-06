import { useEffect } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SUPPORTED_LANGUAGES } from '@flicktionary/core/constants/supported-languages'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@flicktionary/ui/components/select'
import { getFlicktionaryApiClient } from '@/services/flicktionary/flicktionary-api-client'
import { onFlicktionaryAuthChange } from '@/services/flicktionary/auth-storage'
import { getUiPrefsSnapshot, invalidateUiPrefsSnapshot } from '@/services/flicktionary/ui-prefs-sync'

// Just-in-time native-language picker: a user who paired the extension without
// ever completing web onboarding has `native_language = NULL`, and glosses fail
// with a raw BAD_REQUEST. Shown while paired && nativeLanguage is NULL; picking
// a language calls setNativeLanguage and the section hides. Deliberately keyed
// on nativeLanguage === null, NOT isOnboarded — web onboarding remains the full
// flow, this only unblocks glosses.
export const FlicktionaryFinishSetupSection = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  // getUiPrefsSnapshot resolves null when unpaired and swallows fetch failures
  // (returning null), so this query never errors.
  const prefsQuery = useQuery({
    queryKey: ['uiPrefs'],
    queryFn: getUiPrefsSnapshot,
  })

  // Re-evaluate when pairing/unpairing happens while the popup is open (the
  // snapshot memo is invalidated by the same auth-change event).
  useEffect(
    () =>
      onFlicktionaryAuthChange(() => {
        void queryClient.invalidateQueries({ queryKey: ['uiPrefs'] })
      }),
    [queryClient]
  )

  const saveMutation = useMutation({
    mutationFn: (code: string) => getFlicktionaryApiClient().userPrefs.setNativeLanguage({ nativeLanguage: code }),
    // The inline "Could not save" message below handles the failure path.
    meta: { showErrorToast: false },
    onError: (error) => console.warn('Failed to set native language', error),
    onSuccess: (_data, code) => {
      // Patch the cached prefs so the section hides immediately (the old code
      // flipped its local flag synchronously), then invalidate both layers.
      queryClient.setQueryData(['uiPrefs'], (old: Awaited<ReturnType<typeof getUiPrefsSnapshot>>) =>
        old ? { ...old, nativeLanguage: code } : old
      )
      invalidateUiPrefsSnapshot()
      void queryClient.invalidateQueries({ queryKey: ['uiPrefs'] })
    },
  })

  const prefs = prefsQuery.data
  const needsNativeLanguage = prefs != null && prefs.nativeLanguage === null

  if (!needsNativeLanguage) {
    return null
  }

  return (
    <div className='rounded-lg border p-3'>
      <p className='mb-2 text-sm'>
        <Trans>Finish setup</Trans>
      </p>
      <p className='text-muted-foreground mb-2 text-xs'>
        <Trans>Choose your native language to enable lookups.</Trans>
      </p>
      <Select disabled={saveMutation.isPending} onValueChange={(code) => saveMutation.mutate(code)}>
        <SelectTrigger className='w-full' aria-label={t`Native language`}>
          <SelectValue placeholder={t`Native language`} />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saveMutation.isError && (
        <p className='text-destructive mt-2 text-xs'>
          <Trans>Could not save. Please try again.</Trans>
        </p>
      )}
    </div>
  )
}
