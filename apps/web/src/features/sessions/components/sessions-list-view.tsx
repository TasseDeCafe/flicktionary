import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useListStudySessions } from '../api/sessions-hooks'
import { SessionCard } from './session-card'
import { SessionRemoveDialog } from './session-remove-dialog'

type Filter = 'all' | 'movie' | 'text' | 'youtube'

type RemoveTarget = { id: string; title: string }

export const SessionsListView = () => {
  const { t } = useLingui()
  const { data, isLoading } = useListStudySessions()
  const [filter, setFilter] = useState<Filter>('all')
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)

  const filtered = useMemo(() => {
    const all = data ?? []
    if (filter === 'all') return all
    return all.filter((s) => s.contentSourceType === filter)
  }, [data, filter])

  const counts = useMemo(() => {
    const all = data ?? []
    return {
      all: all.length,
      movie: all.filter((s) => s.contentSourceType === 'movie').length,
      text: all.filter((s) => s.contentSourceType === 'text').length,
      youtube: all.filter((s) => s.contentSourceType === 'youtube').length,
    }
  }, [data])

  return (
    <div className='mx-auto max-w-4xl px-4 py-6'>
      <h1 className='text-2xl font-bold'>{t`Sessions`}</h1>

      {(data?.length ?? 0) > 0 && (
        <div className='mt-4 flex gap-2'>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            {t`All`} ({counts.all})
          </FilterChip>
          <FilterChip active={filter === 'movie'} onClick={() => setFilter('movie')}>
            {t`Movies`} ({counts.movie})
          </FilterChip>
          <FilterChip active={filter === 'text'} onClick={() => setFilter('text')}>
            {t`Texts`} ({counts.text})
          </FilterChip>
          <FilterChip active={filter === 'youtube'} onClick={() => setFilter('youtube')}>
            {t`YouTube`} ({counts.youtube})
          </FilterChip>
        </div>
      )}

      <div className='mt-4 flex flex-col gap-2'>
        {isLoading && <p className='text-muted-foreground text-sm'>{t`Loading…`}</p>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <p className='text-muted-foreground text-sm'>{t`No sessions yet. Start one to begin.`}</p>
        )}
        {!isLoading && (data?.length ?? 0) > 0 && filtered.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t`No sessions in this filter.`}</p>
        )}
        {filtered.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onRemove={(s) => setRemoveTarget({ id: s.id, title: s.contentSourceTitle ?? t`Untitled` })}
          />
        ))}
      </div>

      <SessionRemoveDialog
        open={removeTarget !== null}
        sessionId={removeTarget?.id ?? null}
        sessionTitle={removeTarget?.title ?? ''}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null)
        }}
      />
    </div>
  )
}

const FilterChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type='button'
    onClick={onClick}
    className={`rounded-full px-3 py-1 text-sm transition-colors ${
      active ? 'bg-yellow-400 font-medium text-yellow-950' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`}
  >
    {children}
  </button>
)
