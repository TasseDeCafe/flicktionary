import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Card, CardContent } from '@/components/ui/card'

type SessionRow = {
  id: string
  targetLanguage: string
  cefrLevel: string
  status: string
  createdAt: string
  contentSourceTitle: string | null
  contentSourcePosterUrl: string | null
  contentSourceYear: number | null
}

type Props = {
  session: SessionRow
}

export const SessionCard = ({ session }: Props) => {
  const { t } = useLingui()
  const title = session.contentSourceTitle ?? t`Untitled`
  return (
    <Link to='/sessions/$sessionId' params={{ sessionId: session.id }} className='block'>
      <Card className='transition-colors hover:border-yellow-300'>
        <CardContent className='flex items-center gap-4 p-4'>
          {session.contentSourcePosterUrl ? (
            <img
              src={session.contentSourcePosterUrl}
              alt={title}
              className='h-20 w-14 shrink-0 rounded object-cover'
              loading='lazy'
            />
          ) : (
            <div className='bg-muted h-20 w-14 shrink-0 rounded' />
          )}
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base font-semibold'>{title}</div>
            <div className='text-muted-foreground text-xs'>
              {session.contentSourceYear ?? '—'} · {session.targetLanguage.toUpperCase()} · {session.cefrLevel}
            </div>
            <div className='text-muted-foreground text-xs'>{new Date(session.createdAt).toLocaleString()}</div>
          </div>
          <span className='text-muted-foreground shrink-0 text-xs uppercase'>
            {t`Status`}: {session.status}
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}
