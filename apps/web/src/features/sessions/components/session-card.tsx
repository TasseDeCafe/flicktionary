import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { MoreVertical } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Card, CardContent } from '@flicktionary/ui/components/card'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { SessionDifficulty } from '../api/sessions-hooks'
import { POSTER_PLACEHOLDERS } from './poster-placeholders'
import { SessionActionsOverlay } from './session-actions-overlay'
import { SessionDifficultyStat } from './session-difficulty-stat'

// Mirrors SessionCard: poster box + title / meta lines, same Card chrome, so
// the list doesn't reflow when sessions land.
export const SessionCardSkeleton = () => (
  <Card className='py-0'>
    <CardContent className='flex items-center gap-3 p-3 pr-12'>
      <Skeleton className='h-14 w-10 shrink-0 rounded' />
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <Skeleton className='h-5 w-2/3' />
        <Skeleton className='h-3 w-40' />
      </div>
    </CardContent>
  </Card>
)

type SessionRow = {
  id: string
  textTrackId: string
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

export const SessionCard = ({ session, onRemove, difficulty, difficultyLoading }: Props) => {
  const { t, i18n } = useLingui()
  const [actionsOpen, setActionsOpen] = useState(false)
  const title = session.contentSourceTitle ?? t`Untitled`
  const placeholder = session.contentSourceType ? POSTER_PLACEHOLDERS[session.contentSourceType] : undefined
  // No CEFR here: the session's stored level is the USER's level, which reads
  // as the content's difficulty in this position — the difficulty stat is the
  // honest signal.
  const metaParts = [session.contentSourceYear ?? null, session.targetLanguage.toUpperCase()].filter(
    (v): v is string | number => v !== null && v !== ''
  )

  // Relative for the freshest sessions, then a compact date — the list is
  // recency-sorted, so a full timestamp earns no extra line.
  const created = new Date(session.createdAt)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(now) - startOfDay(created)) / 86_400_000)
  const dateLabel =
    dayDiff === 0
      ? t`Today`
      : dayDiff === 1
        ? t`Yesterday`
        : i18n.date(created, {
            month: 'short',
            day: 'numeric',
            year: created.getFullYear() === now.getFullYear() ? undefined : 'numeric',
          })

  return (
    <Card className='hover:bg-accent active:bg-accent relative py-0 transition-colors'>
      <Link to='/sessions/$sessionId' params={{ sessionId: session.id }} className='block'>
        <CardContent className='flex items-center gap-3 p-3 pr-12'>
          {session.contentSourcePosterUrl ? (
            <img
              src={session.contentSourcePosterUrl}
              alt={title}
              className='h-14 w-10 shrink-0 rounded object-cover'
              loading='lazy'
            />
          ) : placeholder ? (
            <div className={`flex h-14 w-10 shrink-0 items-center justify-center rounded ${placeholder.className}`}>
              <placeholder.Icon className='h-5 w-5' />
            </div>
          ) : (
            <div className='bg-muted h-14 w-10 shrink-0 rounded' />
          )}
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base font-semibold'>{title}</div>
            <div className='text-muted-foreground truncate text-xs'>
              {metaParts.join(' · ')}
              <SessionDifficultyStat difficulty={difficulty} isLoading={difficultyLoading} prefix=' · ' />
            </div>
          </div>
          <span className='text-muted-foreground shrink-0 text-sm'>{dateLabel}</span>
        </CardContent>
      </Link>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t`More options`}
        // The card behind turns bg-accent on hover, which would swallow the
        // ghost variant's identical hover fill — an alpha foreground fill
        // stays visible over any surface, in both themes.
        className='text-muted-foreground hover:text-foreground hover:bg-foreground/10 active:bg-foreground/15 absolute top-1/2 right-2 h-8 w-8 -translate-y-1/2'
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setActionsOpen(true)
        }}
      >
        <MoreVertical className='h-4 w-4' />
      </Button>
      <SessionActionsOverlay
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        sessionTitle={title}
        textTrackId={session.textTrackId}
        onRequestRemove={() => {
          setActionsOpen(false)
          onRemove(session)
        }}
      />
    </Card>
  )
}
