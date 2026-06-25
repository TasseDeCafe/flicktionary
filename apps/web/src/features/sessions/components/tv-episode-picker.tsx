import { useLingui } from '@lingui/react/macro'
import { Clapperboard } from 'lucide-react'
import { OptionCard, OptionCardSkeleton } from '@flicktionary/ui/components/option-card'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { useTmdbTvEpisodes } from '../api/sessions-hooks'

export type TvEpisodePick = {
  episodeNumber: number
  name: string
}

type Props = {
  tmdbShowId: number
  seasonNumber: number
  onPick: (episode: TvEpisodePick) => void
  disabled?: boolean
  // Episode numbers already added for this show+season. Marked "Added"; the
  // first episode NOT in this set is highlighted as the likely next one.
  addedEpisodeNumbers?: Set<number>
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export const TvEpisodePicker = ({ tmdbShowId, seasonNumber, onPick, disabled, addedEpisodeNumbers }: Props) => {
  const { t } = useLingui()
  const { data, isFetching } = useTmdbTvEpisodes(tmdbShowId, seasonNumber)

  const nextEpisodeNumber = (data ?? []).find((e) => !addedEpisodeNumbers?.has(e.episodeNumber))?.episodeNumber

  return (
    <div className='flex flex-col gap-2'>
      {isFetching && (data?.length ?? 0) === 0 && <SkeletonList count={6} renderItem={() => <OptionCardSkeleton />} />}
      {(data ?? []).map((episode) => {
        const code = `S${pad2(seasonNumber)}E${pad2(episode.episodeNumber)}`
        const isAdded = addedEpisodeNumbers?.has(episode.episodeNumber) ?? false
        const isNext = !isAdded && episode.episodeNumber === nextEpisodeNumber
        return (
          <OptionCard
            key={episode.episodeNumber}
            variant='navigation'
            selected={isNext}
            badge={isAdded ? t`Added` : isNext ? t`Next` : undefined}
            icon={
              episode.stillUrl ? (
                <img src={episode.stillUrl} alt={episode.name} className='h-full w-full object-cover' loading='lazy' />
              ) : (
                <Clapperboard />
              )
            }
            title={`${code} · ${episode.name}`}
            disabled={disabled}
            onSelect={() => onPick({ episodeNumber: episode.episodeNumber, name: episode.name })}
          />
        )
      })}
      {!isFetching && (data?.length ?? 0) === 0 && (
        <p className='text-muted-foreground text-sm'>{t`No episodes found.`}</p>
      )}
    </div>
  )
}
