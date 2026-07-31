import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { createSearchMatcher } from '@flicktionary/core/utils/search-match'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { SearchInput } from '@flicktionary/ui/components/search-input'

type Props = {
  value: string | null
  onChange: (code: SupportedLanguageCode) => void
  showSearch?: boolean
  excludeCodes?: readonly string[]
  // Code to pin at the top of the list (e.g. the user's last target language).
  // The pinned language is still hidden when it doesn't match the search query.
  pinnedCode?: string | null
}

export const LanguageOptionList = ({ value, onChange, showSearch = true, excludeCodes, pinnedCode }: Props) => {
  const { t } = useLingui()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    // Accent-insensitive with typo tolerance, so "espanol" or "portugues"
    // finds Español/Português without the diacritics.
    const matcher = createSearchMatcher(query)
    const matches = SUPPORTED_LANGUAGES.filter((lang) => {
      if (excludeCodes?.includes(lang.code)) return false
      return matcher.matches(lang.code) || matcher.matches(lang.name) || matcher.matches(lang.nativeName)
    })
    if (!pinnedCode) return matches
    const pinnedIndex = matches.findIndex((lang) => lang.code === pinnedCode)
    if (pinnedIndex <= 0) return matches
    const pinned = matches[pinnedIndex]!
    return [pinned, ...matches.slice(0, pinnedIndex), ...matches.slice(pinnedIndex + 1)]
  }, [query, excludeCodes, pinnedCode])

  return (
    <div className='flex flex-col'>
      {showSearch && (
        // Wrapper is the sticky element (not the input itself) so its opaque
        // bg covers the full width including the gap below it — otherwise the
        // next card scrolls through the transparent gap and peeks out.
        // `-mx-3 px-3` extends the bg into the parent's padding so a selected
        // card's `ring-2` (rendered 2px outside its border) doesn't peek
        // around the sides of the bar.
        <div className='bg-background sticky top-0 z-10 -mx-3 px-3 pb-2'>
          <SearchInput value={query} onChange={setQuery} placeholder={t`Search languages…`} />
        </div>
      )}
      <div role='radiogroup' aria-label={t`Language`} className='flex flex-col gap-2'>
        {filtered.length === 0 && <p className='text-muted-foreground p-3 text-sm'>{t`No languages found.`}</p>}
        {filtered.map((lang) => (
          <OptionCard
            key={lang.code}
            title={lang.name}
            description={`${lang.nativeName} · ${lang.code.toUpperCase()}`}
            selected={value === lang.code}
            onSelect={() => onChange(lang.code)}
          />
        ))}
      </div>
    </div>
  )
}
