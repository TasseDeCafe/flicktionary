import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
}

export const TmdbSearch = ({ onPick }: Props) => {
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
        autoFocus
      />
      {isFetching && <p className='text-muted-foreground text-sm'>{t`Searching…`}</p>}
      <ul className='divide-y rounded-md border'>
        {(data ?? []).slice(0, 10).map((movie) => (
          <li key={movie.tmdbId} className='flex items-center gap-3 p-3'>
            {movie.posterUrl ? (
              <img
                src={movie.posterUrl}
                alt={movie.title}
                className='h-20 w-14 shrink-0 rounded object-cover'
                loading='lazy'
              />
            ) : (
              <div className='bg-muted h-20 w-14 shrink-0 rounded' />
            )}
            <div className='flex-1'>
              <div className='font-medium'>{movie.title}</div>
              {movie.originalTitle !== movie.title && (
                <div className='text-muted-foreground text-sm'>{movie.originalTitle}</div>
              )}
              <div className='text-muted-foreground text-xs'>{movie.year ?? t`Unknown year`}</div>
              {movie.overview && <p className='mt-1 line-clamp-2 text-sm'>{movie.overview}</p>}
            </div>
            <Button
              size='sm'
              onClick={() =>
                onPick({
                  tmdbId: movie.tmdbId,
                  title: movie.title,
                  originalTitle: movie.originalTitle,
                  year: movie.year,
                  posterUrl: movie.posterUrl,
                })
              }
            >
              {t`Pick`}
            </Button>
          </li>
        ))}
        {!isFetching && trimmed.length > 1 && (data?.length ?? 0) === 0 && (
          <li className='text-muted-foreground p-3 text-sm'>{t`No matches.`}</li>
        )}
      </ul>
    </div>
  )
}
