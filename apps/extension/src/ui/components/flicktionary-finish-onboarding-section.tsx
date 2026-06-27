import { useEffect } from 'react'
import { Trans } from '@lingui/react/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@flicktionary/ui/components/button'
import { onFlicktionaryAuthChange } from '@/services/flicktionary/auth-storage'
import { getUiPrefsSnapshot } from '@/services/flicktionary/ui-prefs-sync'

interface Props {
  onOpenApp: () => void
}

// A paired user who never completed web onboarding has `is_onboarded = false`
// and is walled by the web gate. Rather than collect native language in a second,
// parallel popup picker (which drifts the moment web onboarding grows past it),
// we send them to web onboarding — the single onboarding surface. Keyed on
// `!isOnboarded`, NOT `nativeLanguage === null`: the drift case includes users
// who already set native language via the old inline picker while is_onboarded
// stayed false, and keying on native language alone would never show them this.
export const FlicktionaryFinishOnboardingSection = ({ onOpenApp }: Props) => {
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

  const prefs = prefsQuery.data
  const needsOnboarding = prefs != null && !prefs.isOnboarded

  if (!needsOnboarding) {
    return null
  }

  return (
    <div className='rounded-lg border p-3'>
      <p className='mb-2 text-sm'>
        <Trans>Finish setup</Trans>
      </p>
      <p className='text-muted-foreground mb-2 text-xs'>
        <Trans>Complete a quick setup on flicktionary.app to start saving words.</Trans>
      </p>
      <Button type='button' variant='outline' size='sm' className='w-full' onClick={onOpenApp}>
        <Trans>Finish setup</Trans>
      </Button>
    </div>
  )
}
