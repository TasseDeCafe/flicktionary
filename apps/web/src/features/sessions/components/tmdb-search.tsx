import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Film } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { OptionCard } from '@/components/ui/option-card'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import { useSearchTmdb } from '../api/sessions-hooks'

export type TmdbMoviePick = {
  tmdbId: number
  title: string
  originalTitle: string
  year: number | null
  posterUrl: string | null
}

type Props = {
  onPick: (movie: TmdbMoviePick) => void
  disabled?: boolean
}

export const TmdbSearch = ({ onPick, disabled }: Props) => {
  const { t } = useLingui()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 350)
  const trimmed = debouncedQuery.trim()
  const { data, isFetching } = useSearchTmdb(trimmed, trimmed.length > 1)

  return (
    <div className='flex flex-col gap-3'>
      <Input
        type='search'
        placeholder={t`Search a movie title…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        autoFocus
      />
      {isFetching && <p className='text-muted-foreground text-sm'>{t`Searching…`}</p>}
      <div className='flex flex-col gap-2'>
        {(data ?? []).slice(0, 10).map((movie) => {
          const yearLabel = movie.year != null ? String(movie.year) : t`Unknown year`
          const description = movie.originalTitle !== movie.title ? `${yearLabel} · ${movie.originalTitle}` : yearLabel
          return (
            <OptionCard
              key={movie.tmdbId}
              variant='navigation'
              icon={
                movie.posterUrl ? (
                  <img src={movie.posterUrl} alt={movie.title} className='h-full w-full object-cover' loading='lazy' />
                ) : (
                  <Film />
                )
              }
              title={movie.title}
              description={description}
              disabled={disabled}
              onSelect={() =>
                onPick({
                  tmdbId: movie.tmdbId,
                  title: movie.title,
                  originalTitle: movie.originalTitle,
                  year: movie.year,
                  posterUrl: movie.posterUrl,
                })
              }
            />
          )
        })}
        {!isFetching && trimmed.length > 1 && (data?.length ?? 0) === 0 && (
          <p className='text-muted-foreground text-sm'>{t`No matches.`}</p>
        )}
      </div>
    </div>
  )
}
