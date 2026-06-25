import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Tv } from 'lucide-react'
import { OptionCard, OptionCardSkeleton } from '@flicktionary/ui/components/option-card'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { SearchInput } from '@flicktionary/ui/components/search-input'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import { useListStudySessions, useSearchTmdbTv } from '../api/sessions-hooks'
import { deriveTvShows } from '../utils/derive-tv-shows'

export type TmdbTvShowPick = {
  tmdbId: number
  title: string
  originalTitle: string
  year: number | null
  posterUrl: string | null
}

type Props = {
  onPick: (show: TmdbTvShowPick) => void
  disabled?: boolean
}

export const TmdbTvSearch = ({ onPick, disabled }: Props) => {
  const { t } = useLingui()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 350)
  const trimmed = debouncedQuery.trim()
  const { data, isFetching } = useSearchTmdbTv(trimmed, trimmed.length > 1)
  const { data: sessions } = useListStudySessions()

  // Shows the user has already added, most-recent first — a one-tap path back
  // into a show they're watching, shown only when not actively searching.
  const recentShows = trimmed.length > 1 ? [] : deriveTvShows(sessions ?? []).slice(0, 6)

  return (
    <div className='flex flex-col gap-3'>
      <SearchInput value={query} onChange={setQuery} placeholder={t`Search TV shows…`} disabled={disabled} autoFocus />
      {recentShows.length > 0 && (
        <div className='flex flex-col gap-2'>
          <p className='text-muted-foreground text-xs font-medium'>{t`Recently added`}</p>
          {recentShows.map((show) => (
            <OptionCard
              key={show.tmdbShowId}
              variant='navigation'
              icon={
                show.posterUrl ? (
                  <img
                    src={show.posterUrl}
                    alt={show.showTitle}
                    className='h-full w-full object-cover'
                    loading='lazy'
                  />
                ) : (
                  <Tv />
                )
              }
              title={show.showTitle}
              disabled={disabled}
              onSelect={() =>
                onPick({
                  tmdbId: show.tmdbShowId,
                  title: show.showTitle,
                  originalTitle: show.originalTitle ?? show.showTitle,
                  year: show.year,
                  posterUrl: show.posterUrl,
                })
              }
            />
          ))}
        </div>
      )}
      <div className='flex flex-col gap-2'>
        {/* Skeletons only when there's nothing to show yet — a type-ahead
            refetch keeps the previous results visible instead of flashing. */}
        {isFetching && (data?.length ?? 0) === 0 && (
          <SkeletonList count={5} renderItem={() => <OptionCardSkeleton />} />
        )}
        {(data ?? []).slice(0, 10).map((show) => {
          const yearLabel = show.year != null ? String(show.year) : t`Unknown year`
          const description = show.originalTitle !== show.title ? `${yearLabel} · ${show.originalTitle}` : yearLabel
          return (
            <OptionCard
              key={show.tmdbId}
              variant='navigation'
              icon={
                show.posterUrl ? (
                  <img src={show.posterUrl} alt={show.title} className='h-full w-full object-cover' loading='lazy' />
                ) : (
                  <Tv />
                )
              }
              title={show.title}
              description={description}
              disabled={disabled}
              onSelect={() =>
                onPick({
                  tmdbId: show.tmdbId,
                  title: show.title,
                  originalTitle: show.originalTitle,
                  year: show.year,
                  posterUrl: show.posterUrl,
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
