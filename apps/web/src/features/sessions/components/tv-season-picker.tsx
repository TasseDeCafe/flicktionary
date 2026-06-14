import { useLingui } from '@lingui/react/macro'
import { Layers } from 'lucide-react'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { useTmdbTvSeasons } from '../api/sessions-hooks'

export type TvSeasonPick = {
  seasonNumber: number
  name: string
}

type Props = {
  tmdbShowId: number
  onPick: (season: TvSeasonPick) => void
}

export const TvSeasonPicker = ({ tmdbShowId, onPick }: Props) => {
  const { t } = useLingui()
  const { data, isFetching } = useTmdbTvSeasons(tmdbShowId)

  return (
    <div className='flex flex-col gap-2'>
      {isFetching && <p className='text-muted-foreground text-sm'>{t`Loading seasons…`}</p>}
      {(data ?? []).map((season) => {
        const episodeCount = season.episodeCount
        return (
          <OptionCard
            key={season.seasonNumber}
            variant='navigation'
            icon={
              season.posterUrl ? (
                <img src={season.posterUrl} alt={season.name} className='h-full w-full object-cover' loading='lazy' />
              ) : (
                <Layers />
              )
            }
            title={season.name}
            description={t`${episodeCount} episodes`}
            onSelect={() => onPick({ seasonNumber: season.seasonNumber, name: season.name })}
          />
        )
      })}
      {!isFetching && (data?.length ?? 0) === 0 && (
        <p className='text-muted-foreground text-sm'>{t`No seasons found.`}</p>
      )}
    </div>
  )
}
