import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { MoreVertical } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { SessionDifficulty } from '../api/sessions-hooks'
import { useRelativeDateLabel } from '../hooks/use-relative-date-label'
import { MediaCard, MediaListItem, MediaThumb, sessionMediaImageUrl } from './media-card'
import { SessionActionsOverlay } from './session-actions-overlay'
import { SessionDifficultyStat } from './session-difficulty-stat'

export type SessionRow = {
  id: string
  textTrackId: string
  targetLanguage: string
  createdAt: string
  contentSourceTitle: string | null
  contentSourceType: ContentSourceType | null
  contentSourceBackdropUrl: string | null
  contentSourceStillUrl: string | null
  youtubeVideoId: string | null
  contentSourceYear: number | null
}

type Props = {
  session: SessionRow
  onRemove: (session: SessionRow) => void
  difficulty?: SessionDifficulty
  difficultyLoading?: boolean
}

// The pieces both session shapes share: title, media, the meta line, the date
// label, and the ⋮ menu (button + overlay, rendered outside the card's Link).
const useSessionCardParts = ({ session, onRemove, difficulty, difficultyLoading }: Props) => {
  const { t } = useLingui()
  const [actionsOpen, setActionsOpen] = useState(false)
  const relativeDate = useRelativeDateLabel()
  const title = session.contentSourceTitle ?? t`Untitled`
  // No CEFR here: the session's stored level is the USER's level, which reads
  // as the content's difficulty in this position — the difficulty stat is the
  // honest signal.
  const metaParts = [session.contentSourceYear ?? null, session.targetLanguage.toUpperCase()].filter(
    (v): v is string | number => v !== null && v !== ''
  )
  return {
    title,
    dateLabel: relativeDate(session.createdAt),
    linkProps: { to: '/sessions/$sessionId', params: { sessionId: session.id } } as const,
    media: <MediaThumb imageUrl={sessionMediaImageUrl(session)} title={title} type={session.contentSourceType} />,
    meta: (
      <>
        {metaParts.join(' · ')}
        <SessionDifficultyStat difficulty={difficulty} isLoading={difficultyLoading} prefix=' · ' />
      </>
    ),
    action: (
      <>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t`More options`}
          // The card behind turns bg-accent on hover, which would swallow the
          // ghost variant's identical hover fill — an alpha foreground fill
          // stays visible over any surface, in both themes.
          className='text-muted-foreground hover:text-foreground hover:bg-foreground/10 active:bg-foreground/15 h-8 w-8'
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
      </>
    ),
  }
}

// List shape for /sessions: stacked media card on mobile, thumb-left row on
// desktop.
export const SessionListItem = (props: Props) => {
  const { title, dateLabel, linkProps, media, meta, action } = useSessionCardParts(props)
  return (
    <MediaListItem
      linkProps={linkProps}
      media={media}
      title={title}
      meta={meta}
      dateLabel={dateLabel}
      action={action}
    />
  )
}

// Vertical card for the dashboard's grid and rails — the date joins the meta
// line so the ⋮ keeps a clean corner.
export const SessionMediaCard = (props: Props & { className?: string }) => {
  const { title, dateLabel, linkProps, media, meta, action } = useSessionCardParts(props)
  return (
    <MediaCard
      linkProps={linkProps}
      media={media}
      title={title}
      meta={
        <>
          {meta} · {dateLabel}
        </>
      }
      action={action}
      className={props.className}
    />
  )
}
