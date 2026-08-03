import { useLingui } from '@lingui/react/macro'
import { SeeMoreLink } from '@/components/ui/see-more-link'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { ExploreMediaCard } from '@/features/explore/components/explore-card'
import { MediaCardSkeleton } from '@/features/sessions/components/media-card'
import { MediaRail, RAIL_CARD_CLASS } from './media-rail'
import { useDashboardExploreEntries } from './use-dashboard-explore-entries'

// The latest shared content that isn't already surfaced by the Featured rail.
// On mobile this section's "Explore all" is the only way into /explore (no
// bottom-nav tab — deliberate), so it sits on both breakpoints.
export const FromCommunitySection = () => {
  const { t } = useLingui()
  const { community, isLoading } = useDashboardExploreEntries()

  if (!isLoading && community.length === 0) return null

  return (
    <div className='mt-6'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-base font-semibold'>{t`From the community`}</h2>
        <SeeMoreLink to='/explore'>{t`Explore all`}</SeeMoreLink>
      </div>
      <MediaRail itemCount={community.length}>
        {isLoading && <SkeletonList count={4} renderItem={() => <MediaCardSkeleton className={RAIL_CARD_CLASS} />} />}
        {community.map((entry) => (
          <ExploreMediaCard key={entry.id} entry={entry} className={RAIL_CARD_CLASS} />
        ))}
      </MediaRail>
    </div>
  )
}
