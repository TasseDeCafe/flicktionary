import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useListStudySessions } from '../api/sessions-hooks'
import { SessionCard } from './session-card'
import { SessionRemoveDialog } from './session-remove-dialog'

type Filter = 'all' | 'movie' | 'text' | 'article' | 'youtube' | 'streaming'

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
      article: all.filter((s) => s.contentSourceType === 'article').length,
      youtube: all.filter((s) => s.contentSourceType === 'youtube').length,
      streaming: all.filter((s) => s.contentSourceType === 'streaming').length,
    }
  }, [data])

  return (
    <div className='mx-auto max-w-4xl px-4 py-6'>
      <h1 className='text-2xl font-bold'>{t`Sessions`}</h1>

      {/* Horizontally scrollable on narrow viewports: the chips never wrap or shrink,
          and the row bleeds to the screen edges (-mx-4 px-4) so it scrolls cleanly past
          the page padding. Scrollbar hidden for a native feel. */}
      {(data?.length ?? 0) > 0 && (
        <div className='-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            {t`All`} ({counts.all})
          </FilterChip>
          <FilterChip active={filter === 'movie'} onClick={() => setFilter('movie')}>
            {t`Movies`} ({counts.movie})
          </FilterChip>
          <FilterChip active={filter === 'text'} onClick={() => setFilter('text')}>
            {t`Texts`} ({counts.text})
          </FilterChip>
          <FilterChip active={filter === 'article'} onClick={() => setFilter('article')}>
            {t`Articles`} ({counts.article})
          </FilterChip>
          <FilterChip active={filter === 'youtube'} onClick={() => setFilter('youtube')}>
            {t`YouTube`} ({counts.youtube})
          </FilterChip>
          <FilterChip active={filter === 'streaming'} onClick={() => setFilter('streaming')}>
            {t`Streaming`} ({counts.streaming})
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
    className={`shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors ${
      active ? 'bg-yellow-400 font-medium text-yellow-950' : 'bg-muted text-foreground hover:bg-accent'
    }`}
  >
    {children}
  </button>
)
