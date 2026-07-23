import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { PageContainer } from '@/components/page-container'
import { SeeMoreLink } from '@/components/ui/see-more-link'
import { useListStudySessions, useSessionDifficulties } from '@/features/sessions/api/sessions-hooks'
import { buildSessionListItems } from '@/features/sessions/utils/session-list-items'
import { SessionCard, SessionCardSkeleton } from '@/features/sessions/components/session-card'
import { ShowGroupCard } from '@/features/sessions/components/show-group-card'
import { SessionRemoveDialog } from '@/features/sessions/components/session-remove-dialog'
import { SessionsEmptyState } from '@/features/sessions/components/sessions-empty-state'
import { GettingStartedChecklist } from '@/features/sessions/components/getting-started-checklist'
import { CoverageCard } from '@/features/coverage/components/coverage-card'
import { useQualifyingCoverage } from '@/features/coverage/api/coverage-hooks'
import { ActivityCalendarCard } from './activity-calendar-card'
import { DailyMixBanner } from './daily-mix-banner'
import { DashboardCarousel } from './dashboard-carousel'

// The dashboard previews this many recent rows; the full list lives on /sessions.
const RECENT_COUNT = 4

type RemoveTarget = { id: string; title: string }

export const DashboardView = () => {
  const { t, i18n } = useLingui()
  const { data, isLoading } = useListStudySessions()
  const { qualifying: qualifyingCoverage, isLoading: isCoverageLoading } = useQualifyingCoverage()
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)

  const recentItems = useMemo(
    () => buildSessionListItems(data ?? [], { groupTvShows: true }).slice(0, RECENT_COUNT),
    [data]
  )

  // One batched difficulty read for the visible loose cards. TV episodes get
  // theirs on the show detail screen; the show-group card shows no aggregate.
  const looseSessionIds = useMemo(
    () => recentItems.filter((item) => item.kind === 'session').map((item) => item.session.id),
    [recentItems]
  )
  const { difficulties, isLoading: isDifficultiesLoading } = useSessionDifficulties(looseSessionIds)

  const dateLabel = i18n.date(new Date(), { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <PageContainer width='wide'>
      <div className='text-muted-foreground text-xs font-semibold tracking-widest uppercase'>{dateLabel}</div>
      <h1 className='text-2xl font-bold'>{t`Dashboard`}</h1>

      <GettingStartedChecklist hasSessionsInList={(data?.length ?? 0) > 0} />

      <DailyMixBanner />

      {/* Both cards carry their own top margin, so the carousel needs none.
          The coverage slide exists only while its data might qualify —
          during load the card shows its own skeleton; once resolved, a user
          with no qualifying language (fresh account, or a language without a
          lemma_ranks build) gets no blank slide and no stray page dot. */}
      <DashboardCarousel
        slides={[
          ...(isCoverageLoading || qualifyingCoverage.length > 0 ? [<CoverageCard key='coverage' />] : []),
          <ActivityCalendarCard key='activity' />,
        ]}
      />

      <div className='mt-6 flex items-baseline justify-between'>
        <h2 className='text-base font-semibold'>{t`Recent`}</h2>
        <SeeMoreLink to='/sessions'>{t`All sessions`}</SeeMoreLink>
      </div>
      <div className='mt-2 grid grid-cols-1 gap-3 md:grid-cols-2'>
        {isLoading && <SkeletonList count={4} renderItem={() => <SessionCardSkeleton />} />}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <div className='md:col-span-2'>
            <SessionsEmptyState />
          </div>
        )}
        {recentItems.map((item) =>
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
  )
}
