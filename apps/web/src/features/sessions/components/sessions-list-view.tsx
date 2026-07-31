import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { PageContainer } from '@/components/page-container'
import { FilterChip } from '@/components/filter-chip'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { SearchInput } from '@flicktionary/ui/components/search-input'
import { useListStudySessions, useSessionDifficulties } from '../api/sessions-hooks'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import { createSearchMatcher } from '@flicktionary/core/utils/search-match'
import { buildSessionListItems } from '../utils/session-list-items'
import { SessionCard, SessionCardSkeleton } from './session-card'
import { ShowGroupCard } from './show-group-card'
import { SessionRemoveDialog } from './session-remove-dialog'
import { SessionsEmptyState } from './sessions-empty-state'
import { SessionsFilterControl, type SessionsSort } from './sessions-filter-control'
import { OverflowTabHeader } from '@/features/navigation/components/overflow-tab-header'

type TypeFilter = 'all' | 'movie' | 'tv' | 'text' | 'article' | 'youtube' | 'streaming' | 'lesson'

type RemoveTarget = { id: string; title: string }

export const SessionsListView = () => {
  const { t } = useLingui()
  const { data, isLoading } = useListStudySessions()
  const search = useSearch({ from: '/_authenticated/_app/sessions/' })
  const navigate = useNavigate()
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)

  // Filter/sort state lives in the URL (see the route's search schema); search
  // text is transient local state, debounced before it narrows the list.
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 250)
  const filter: TypeFilter = search.type ?? 'all'
  const sort: SessionsSort = search.sort ?? 'newest'

  const availableLanguages = useMemo(() => [...new Set((data ?? []).map((s) => s.targetLanguage))].sort(), [data])
  // A stale ?lang= (language no longer in the list) degrades to "all" instead
  // of rendering an unexplained empty list.
  const lang = search.lang !== undefined && availableLanguages.includes(search.lang) ? search.lang : undefined

  // Defaults are dropped when writing back so the URL stays clean.
  const applySearch = (next: { type: TypeFilter; lang: string | undefined; sort: SessionsSort }) =>
    void navigate({
      to: '/sessions',
      search: {
        ...(next.type !== 'all' ? { type: next.type } : {}),
        ...(next.lang !== undefined ? { lang: next.lang } : {}),
        ...(next.sort !== 'newest' ? { sort: next.sort } : {}),
      },
    })
  const setFilter = (type: TypeFilter) => applySearch({ type, lang, sort })

  const filtered = useMemo(() => {
    const all = data ?? []
    const matcher = createSearchMatcher(debouncedSearch)
    return all.filter((s) => {
      if (filter !== 'all' && s.contentSourceType !== filter) return false
      if (lang !== undefined && s.targetLanguage !== lang) return false
      if (!matcher.matches(s.contentSourceTitle ?? '')) return false
      return true
    })
  }, [data, filter, lang, debouncedSearch])

  const items = useMemo(() => {
    const merged = buildSessionListItems(filtered, { groupTvShows: filter === 'all' || filter === 'tv' })
    // The util sorts newest-first; oldest-first is its exact reverse.
    return sort === 'oldest' ? [...merged].reverse() : merged
  }, [filtered, filter, sort])

  // One batched difficulty read keyed by the FULL session list, not the
  // filtered view — filter/search changes then hit the same cached chunks
  // instead of minting new query keys and recomputing server-side. The
  // extra ids are cheap: the backend collapses sessions sharing a track
  // (TV seasons) into one computation, and cards that don't render the
  // stat simply ignore their entry.
  const sessionIds = useMemo(() => (data ?? []).map((s) => s.id), [data])
  const { difficulties, isLoading: isDifficultiesLoading } = useSessionDifficulties(sessionIds)

  const sessionCount = filtered.length

  return (
    <>
      <OverflowTabHeader backTo='/dashboard' title={t`Sessions`} />
      <PageContainer width='wide'>
        <h1 className='hidden text-2xl font-bold md:block'>{t`Sessions`}</h1>

        {(data?.length ?? 0) > 0 && (
          <div className='mt-4 flex items-center gap-2'>
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder={t`Search sessions…`}
              className='flex-1'
            />
            <SessionsFilterControl
              filters={{ sort, lang }}
              languages={availableLanguages}
              onChange={(next) => applySearch({ type: filter, lang: next.lang, sort: next.sort })}
            />
          </div>
        )}

        {isLoading && <FilterChipsSkeleton />}

        {/* Horizontally scrollable on narrow viewports: the chips never wrap or shrink,
          and the row bleeds to the screen edges (-mx-4 px-4) so it scrolls cleanly past
          the page padding. Scrollbar hidden for a native feel. */}
        {(data?.length ?? 0) > 0 && (
          <div className='-mx-4 mt-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden'>
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              {t`All`}
            </FilterChip>
            <FilterChip active={filter === 'movie'} onClick={() => setFilter('movie')}>
              {t`Movies`}
            </FilterChip>
            <FilterChip active={filter === 'tv'} onClick={() => setFilter('tv')}>
              {t`TV`}
            </FilterChip>
            <FilterChip active={filter === 'text'} onClick={() => setFilter('text')}>
              {t`Texts`}
            </FilterChip>
            <FilterChip active={filter === 'article'} onClick={() => setFilter('article')}>
              {t`Articles`}
            </FilterChip>
            <FilterChip active={filter === 'youtube'} onClick={() => setFilter('youtube')}>
              {t`YouTube`}
            </FilterChip>
            <FilterChip active={filter === 'streaming'} onClick={() => setFilter('streaming')}>
              {t`Streaming`}
            </FilterChip>
            <FilterChip active={filter === 'lesson'} onClick={() => setFilter('lesson')}>
              {t`Lessons`}
            </FilterChip>
          </div>
        )}

        {!isLoading && (data?.length ?? 0) > 0 && (
          <div className='text-muted-foreground mt-3 text-xs tabular-nums'>{t`${sessionCount} sessions`}</div>
        )}

        <div className='mt-3 flex flex-col gap-2'>
          {isLoading && <SkeletonList count={4} renderItem={() => <SessionCardSkeleton />} />}
          {!isLoading && (data?.length ?? 0) === 0 && <SessionsEmptyState />}
          {!isLoading && (data?.length ?? 0) > 0 && filtered.length === 0 && (
            <p className='text-muted-foreground text-sm'>{t`No sessions in this filter.`}</p>
          )}
          {items.map((item) =>
            item.kind === 'group' ? (
              <ShowGroupCard key={item.key} group={item.group} />
            ) : (
              <SessionCard
                key={item.key}
                session={item.session}
                difficulty={difficulties[item.session.id]}
                difficultyLoading={isDifficultiesLoading}
                onRemove={(s) => setRemoveTarget({ id: s.id, title: s.contentSourceTitle ?? t`Untitled` })}
              />
            )
          )}
        </div>

        <SessionRemoveDialog
          open={removeTarget !== null}
          sessionId={removeTarget?.id ?? null}
          sessionTitle={removeTarget?.title ?? ''}
          onOpenChange={(next) => {
            if (!next) setRemoveTarget(null)
          }}
        />
      </PageContainer>
    </>
  )
}

// Varied widths so the placeholder reads as the labelled filter chips rather
// than identical pills, in the same scrollable row as the real chips.
const FILTER_CHIP_SKELETON_WIDTHS = ['w-10', 'w-16', 'w-10', 'w-14', 'w-16', 'w-18', 'w-20', 'w-16']
const FilterChipsSkeleton = () => (
  <div className='-mx-4 mt-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden'>
    {FILTER_CHIP_SKELETON_WIDTHS.map((width, i) => (
      <Skeleton key={i} className={`h-7 shrink-0 rounded-full ${width}`} />
    ))}
  </div>
)
