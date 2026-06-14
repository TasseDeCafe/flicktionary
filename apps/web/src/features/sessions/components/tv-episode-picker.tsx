import { useLingui } from '@lingui/react/macro'
import { Clapperboard } from 'lucide-react'
import { OptionCard } from '@flicktionary/ui/components/option-card'
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
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export const TvEpisodePicker = ({ tmdbShowId, seasonNumber, onPick, disabled }: Props) => {
  const { t } = useLingui()
  const { data, isFetching } = useTmdbTvEpisodes(tmdbShowId, seasonNumber)

  return (
    <div className='flex flex-col gap-2'>
      {isFetching && <p className='text-muted-foreground text-sm'>{t`Loading episodes…`}</p>}
      {(data ?? []).map((episode) => {
        const code = `S${pad2(seasonNumber)}E${pad2(episode.episodeNumber)}`
        return (
          <OptionCard
            key={episode.episodeNumber}
            variant='navigation'
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
