import { describe, expect, test } from 'vitest'
import { setupI18n } from '@lingui/core'
import { coverageLanguageNameMessages, getLocalizedCoverageLanguageName } from './coverage-language-names'

describe('getLocalizedCoverageLanguageName', () => {
  test('uses the active interface-language catalog and preserves unknown-code fallback', () => {
    const russianId = coverageLanguageNameMessages.ru.id
    const i18n = setupI18n({ locale: 'fr', messages: { fr: { [russianId]: ['Russe'] } } })
    expect(getLocalizedCoverageLanguageName(i18n, 'ru')).toBe('Russe')
    expect(getLocalizedCoverageLanguageName(i18n, 'zz')).toBe('ZZ')
  })
})
