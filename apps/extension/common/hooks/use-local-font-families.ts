import { useCallback, useEffect, useState } from 'react'

// Local Font Access API (Chromium-only), not yet in lib.dom.
declare const queryLocalFonts: (() => Promise<{ family: string }[]>) | undefined

const localFontsAvailable = typeof queryLocalFonts === 'function'

export const useLocalFontFamilies = () => {
  const [localFontFamilies, setLocalFontFamilies] = useState<string[]>([])
  const [localFontsPermission, setLocalFontsPermission] = useState<PermissionState>()
  const updateLocalFontsPermission = useCallback(() => {
    if (localFontsAvailable) {
      navigator.permissions
        .query({ name: 'local-fonts' as PermissionName })
        .then((result) => setLocalFontsPermission(result.state))
    }
  }, [])

  const updateLocalFonts = useCallback(() => {
    // typeof (rather than the localFontsAvailable boolean) so browsers without the
    // global don't throw a ReferenceError, and so TS narrows away `undefined`.
    if (typeof queryLocalFonts === 'function') {
      queryLocalFonts()
        .then((fonts) => {
          const families: { [family: string]: boolean } = {}

          for (const f of fonts) {
            families[f.family] = true
          }

          setLocalFontFamilies(Object.keys(families))
        })
        .catch(console.error)
    }
  }, [])

  useEffect(() => {
    updateLocalFontsPermission()
  }, [updateLocalFontsPermission])

  useEffect(() => {
    updateLocalFonts()
  }, [updateLocalFonts])

  return {
    updateLocalFontsPermission,
    updateLocalFonts,
    localFontsAvailable,
    localFontsPermission,
    localFontFamilies,
  }
}
