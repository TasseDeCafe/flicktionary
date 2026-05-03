import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

type SessionRow = {
  id: string
  targetLanguage: string
  cefrLevel: string
  status: string
  createdAt: string
  contentSourceTitle: string | null
  contentSourceType: ContentSourceType | null
  contentSourcePosterUrl: string | null
  contentSourceYear: number | null
}

type Props = {
  session: SessionRow
}

export const SessionCard = ({ session }: Props) => {
  const { t } = useLingui()
  const title = session.contentSourceTitle ?? t`Untitled`
  const isText = session.contentSourceType === 'text'
  const metaParts = [session.contentSourceYear ?? null, session.targetLanguage.toUpperCase(), session.cefrLevel].filter(
    (v): v is string | number => v !== null && v !== ''
  )

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
          ) : isText ? (
            <div className='flex h-20 w-14 shrink-0 items-center justify-center rounded bg-yellow-100 text-yellow-900'>
              <FileText className='h-6 w-6' />
            </div>
          ) : (
            <div className='bg-muted h-20 w-14 shrink-0 rounded' />
          )}
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base font-semibold'>{title}</div>
            <div className='text-muted-foreground text-xs'>{metaParts.join(' · ')}</div>
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
