import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface VocabularyLanguageSwitcherProps {
  languages: string[]
  value: string | null
  onChange: (lang: string) => void
}

export const VocabularyLanguageSwitcher = ({ languages, value, onChange }: VocabularyLanguageSwitcherProps) => {
  if (languages.length <= 1) return null
  return (
    <div className='flex flex-wrap gap-2'>
      {languages.map((lang) => {
        const isActive = lang === value
        return (
          <button
            key={lang}
            type='button'
            onClick={() => onChange(lang)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold tracking-wider uppercase transition-colors',
              isActive
                ? 'border-yellow-500 bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300'
                : 'border-border bg-card text-muted-foreground hover:bg-accent active:bg-accent'
            )}
          >
            {lang}
          </button>
        )
      })}
    </div>
  )
}
