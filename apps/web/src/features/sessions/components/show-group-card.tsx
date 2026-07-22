import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronRight, Tv } from 'lucide-react'
import { Card, CardContent } from '@flicktionary/ui/components/card'
import type { TvShowGroup } from '../utils/derive-tv-shows'

type Props = {
  group: TvShowGroup
}

// One row per TV show in the Sessions list. Tapping opens the show detail screen
// (episode list + Add episode); a mobile-friendly drill-in rather than an
// inline expand.
export const ShowGroupCard = ({ group }: Props) => {
  const { t } = useLingui()
  const count = group.episodes.length

  return (
    <Card className='hover:bg-accent active:bg-accent py-0 transition-colors'>
      <Link to='/sessions/show/$tmdbShowId' params={{ tmdbShowId: String(group.tmdbShowId) }} className='block'>
        <CardContent className='flex items-center gap-3 p-3'>
          {group.posterUrl ? (
            <img
              src={group.posterUrl}
              alt={group.showTitle}
              className='h-14 w-10 shrink-0 rounded object-cover'
              loading='lazy'
            />
          ) : (
            <div className='flex h-14 w-10 shrink-0 items-center justify-center rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'>
              <Tv className='h-5 w-5' />
            </div>
          )}
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base font-semibold'>{group.showTitle}</div>
            <div className='text-muted-foreground text-xs'>
              {group.language.toUpperCase()}
              {' · '}
              {count === 1 ? t`1 episode` : t`${count} episodes`}
            </div>
          </div>
          <ChevronRight className='text-muted-foreground h-5 w-5 shrink-0' aria-hidden='true' />
        </CardContent>
      </Link>
    </Card>
  )
}
