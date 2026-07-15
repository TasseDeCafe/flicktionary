import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { Link, useNavigate } from '@tanstack/react-router'
import { Clapperboard, FileText, Puzzle } from 'lucide-react'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { useListStudySessions } from '../api/sessions-hooks'
import { deriveTvShows } from '../utils/derive-tv-shows'
import { SessionCard, SessionCardSkeleton } from './session-card'
import { ShowGroupCard } from './show-group-card'
import { SessionRemoveDialog } from './session-remove-dialog'
import { GettingStartedChecklist } from './getting-started-checklist'

type Filter = 'all' | 'movie' | 'tv' | 'text' | 'article' | 'youtube' | 'streaming' | 'lesson'

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

  // TV sessions collapse into one expandable group per show; every other source
  // type stays an individual row. Groups and rows interleave by recency so an
  // active show bubbles up alongside recent movies/texts. The TV filter shows
  // only groups; non-TV filters never produce a group.
  const items = useMemo(() => {
    const groups = filter === 'all' || filter === 'tv' ? deriveTvShows(filtered) : []
    const loose = filtered.filter((s) => s.contentSourceType !== 'tv')
    const merged = [
      ...groups.map((group) => ({
        kind: 'group' as const,
        key: `show-${group.tmdbShowId}`,
        sortKey: group.latestCreatedAt,
        group,
      })),
      ...loose.map((session) => ({ kind: 'session' as const, key: session.id, sortKey: session.createdAt, session })),
    ]
    merged.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    return merged
  }, [filtered, filter])

  return (
    <div className='mx-auto max-w-4xl px-4 py-6'>
      <h1 className='text-2xl font-bold'>{t`Sessions`}</h1>

      <GettingStartedChecklist hasSessionsInList={(data?.length ?? 0) > 0} />

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

      <div className='mt-4 flex flex-col gap-2'>
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
    </div>
  )
}

// First-run replacement for the bare "no sessions" line: says what a session
// is and mirrors the primary "+ New" actions so the empty screen is itself an
// entry point. The extension row deep-links into the guide since watching on
// YouTube/streaming starts outside the app.
const SessionsEmptyState = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  return (
    <div className='bg-card rounded-xl border p-4'>
      <h2 className='font-semibold'>{t`Start your first session`}</h2>
      <p className='text-muted-foreground mt-1 text-sm'>
        {t`A session is anything you study from: a movie or show with subtitles, a YouTube video, an article, or a pasted text. Terms you save while watching or reading become your vocabulary.`}
      </p>
      <div className='mt-3 flex flex-col gap-1'>
        <OverlayActionRow
          icon={Clapperboard}
          label={t`Start a movie or TV session`}
          description={t`Find a movie or show and load its subtitles`}
          onClick={() => void navigate({ to: '/sessions/new' })}
        />
        <OverlayActionRow
          icon={FileText}
          label={t`Practice with a text`}
          description={t`Paste an article, comment, or post`}
          onClick={() => void navigate({ to: '/sessions/new-text' })}
        />
        <OverlayActionRow
          icon={Puzzle}
          label={t`Watch with the browser extension`}
          description={t`YouTube and streaming sites, with instant subtitle lookups`}
          onClick={() => void navigate({ to: '/user-guide', hash: 'extension' })}
        />
      </div>
      <Link to='/user-guide' hash='sessions' className='mt-3 inline-block text-sm font-medium underline'>
        {t`Read more in the guide`}
      </Link>
    </div>
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
