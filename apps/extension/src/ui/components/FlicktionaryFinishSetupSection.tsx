import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
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
  const [needsNativeLanguage, setNeedsNativeLanguage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    const check = () => {
      void getUiPrefsSnapshot().then((prefs) => {
        if (active) setNeedsNativeLanguage(prefs !== null && prefs.nativeLanguage === null)
      })
    }
    check()
    // Re-evaluate when pairing/unpairing happens while the popup is open (the
    // snapshot memo is invalidated by the same auth-change event).
    const unsubscribe = onFlicktionaryAuthChange(() => check())
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (!needsNativeLanguage) {
    return null
  }

  const handlePick = async (code: string) => {
    setSaving(true)
    setError(false)
    try {
      await getFlicktionaryApiClient().userPrefs.setNativeLanguage({ nativeLanguage: code })
      invalidateUiPrefsSnapshot()
      setNeedsNativeLanguage(false)
    } catch (err) {
      console.warn('Failed to set native language', err)
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='rounded-lg border p-3'>
      <p className='mb-2 text-sm'>
        <Trans>Finish setup</Trans>
      </p>
      <p className='text-muted-foreground mb-2 text-xs'>
        <Trans>Choose your native language to enable lookups.</Trans>
      </p>
      <Select disabled={saving} onValueChange={handlePick}>
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
      {error && (
        <p className='text-destructive mt-2 text-xs'>
          <Trans>Could not save. Please try again.</Trans>
        </p>
      )}
    </div>
  )
}
