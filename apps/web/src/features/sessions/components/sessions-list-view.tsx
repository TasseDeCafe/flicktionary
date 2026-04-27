import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useListStudySessions } from '../api/sessions-hooks'
import { SessionCard } from './session-card'

export const SessionsListView = () => {
  const { t } = useLingui()
  const { data, isLoading } = useListStudySessions()

  return (
    <div className='mx-auto max-w-4xl px-4 py-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>{t`Sessions`}</h1>
        <Button asChild>
          <Link to='/sessions/new'>
            <Plus className='mr-1 h-4 w-4' />
            {t`New session`}
          </Link>
        </Button>
      </div>

      <div className='mt-6 flex flex-col gap-2'>
        {isLoading && <p className='text-muted-foreground text-sm'>{t`Loading…`}</p>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <p className='text-muted-foreground text-sm'>{t`No sessions yet. Start one to begin.`}</p>
        )}
        {(data ?? []).map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  )
}
