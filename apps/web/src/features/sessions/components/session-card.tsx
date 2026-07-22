import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Clapperboard, FileText, GraduationCap, MonitorPlay, Newspaper, Trash2, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Card, CardContent } from '@flicktionary/ui/components/card'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { SessionDifficulty } from '../api/sessions-hooks'
import { SessionDifficultyStat } from './session-difficulty-stat'

// Mirrors SessionCard: poster box + title / meta / timestamp lines, same Card
// chrome, so the list doesn't reflow when sessions land.
export const SessionCardSkeleton = () => (
  <Card>
    <CardContent className='flex items-center gap-4 p-4 pr-14'>
      <Skeleton className='h-20 w-14 shrink-0 rounded' />
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <Skeleton className='h-5 w-2/3' />
        <Skeleton className='h-3 w-24' />
        <Skeleton className='h-3 w-40' />
      </div>
    </CardContent>
  </Card>
)

type SessionRow = {
  id: string
  targetLanguage: string
  createdAt: string
  contentSourceTitle: string | null
  contentSourceType: ContentSourceType | null
  contentSourcePosterUrl: string | null
  contentSourceYear: number | null
}

type Props = {
  session: SessionRow
  onRemove: (session: SessionRow) => void
  difficulty?: SessionDifficulty
  difficultyLoading?: boolean
}

// Poster fallback per source type: an icon on a hue that identifies the type
// at a glance. Types without an entry (movie without a poster) fall back to a
// plain muted box.
const POSTER_PLACEHOLDERS: Partial<Record<ContentSourceType, { Icon: LucideIcon; className: string }>> = {
  text: { Icon: FileText, className: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300' },
  tv: { Icon: Tv, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' },
  article: { Icon: Newspaper, className: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300' },
  youtube: { Icon: MonitorPlay, className: 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300' },
  streaming: {
    Icon: Clapperboard,
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  },
  lesson: {
    Icon: GraduationCap,
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  },
}

export const SessionCard = ({ session, onRemove, difficulty, difficultyLoading }: Props) => {
  const { t } = useLingui()
  const title = session.contentSourceTitle ?? t`Untitled`
  const placeholder = session.contentSourceType ? POSTER_PLACEHOLDERS[session.contentSourceType] : undefined
  // No CEFR here: the session's stored level is the USER's level, which reads
  // as the content's difficulty in this position — the difficulty stat is the
  // honest signal.
  const metaParts = [session.contentSourceYear ?? null, session.targetLanguage.toUpperCase()].filter(
    (v): v is string | number => v !== null && v !== ''
  )

  return (
    <Card className='hover:bg-accent active:bg-accent relative transition-colors'>
      <Link to='/sessions/$sessionId' params={{ sessionId: session.id }} className='block'>
        <CardContent className='flex items-center gap-4 p-4 pr-14'>
          {session.contentSourcePosterUrl ? (
            <img
              src={session.contentSourcePosterUrl}
              alt={title}
              className='h-20 w-14 shrink-0 rounded object-cover'
              loading='lazy'
            />
          ) : placeholder ? (
            <div className={`flex h-20 w-14 shrink-0 items-center justify-center rounded ${placeholder.className}`}>
              <placeholder.Icon className='h-6 w-6' />
            </div>
          ) : (
            <div className='bg-muted h-20 w-14 shrink-0 rounded' />
          )}
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base font-semibold'>{title}</div>
            <div className='text-muted-foreground text-xs'>
              {metaParts.join(' · ')}
              <SessionDifficultyStat difficulty={difficulty} isLoading={difficultyLoading} prefix=' · ' />
            </div>
            <div className='text-muted-foreground text-xs'>{new Date(session.createdAt).toLocaleString()}</div>
          </div>
        </CardContent>
      </Link>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t`Remove session`}
        className='text-muted-foreground hover:text-destructive absolute top-2 right-2 h-8 w-8'
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onRemove(session)
        }}
      >
        <Trash2 className='h-4 w-4' />
      </Button>
    </Card>
  )
}
