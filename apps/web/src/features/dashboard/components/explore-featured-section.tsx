import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SeeMoreLink } from '@/components/ui/see-more-link'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { useGetUserPrefs, useListStudySessions } from '@/features/sessions/api/sessions-hooks'
import { useSharedContentList } from '@/features/explore/api/explore-hooks'
import { ExploreRailCard, ExploreRailCardSkeleton } from '@/features/explore/components/explore-card'

// How many featured entries the dashboard rail holds; the full catalog lives
// on /explore.
const FEATURED_COUNT = 12

// Featured shared content for everyone, not just new users: a single-row rail
// (swipe on mobile, chevrons on desktop) so it stays discoverable without
// competing with the Recent grid for vertical space. Entries already in the
// user's library are hidden, and once the user has any target language
// (sessions or a saved preference) the rail narrows to those languages — the
// full multi-language catalog with filter chips stays on /explore.
export const ExploreFeaturedSection = () => {
  const { t } = useLingui()
  const { data: sessions, isLoading: isSessionsLoading } = useListStudySessions()
  const { data: prefs } = useGetUserPrefs()
  const { data: entries, isLoading: isEntriesLoading } = useSharedContentList()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const visible = useMemo(() => {
    const featured = (entries ?? []).filter((entry) => entry.featured && !entry.inLibrary)
    const targetLanguages = new Set((sessions ?? []).map((session) => session.targetLanguage))
    if (prefs?.lastTargetLanguage) targetLanguages.add(prefs.lastTargetLanguage)
    const matching =
      targetLanguages.size > 0 ? featured.filter((entry) => targetLanguages.has(entry.language)) : featured
    return matching.slice(0, FEATURED_COUNT)
  }, [entries, sessions, prefs?.lastTargetLanguage])

  const updateChevrons = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 1)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  const visibleCount = visible.length
  useEffect(() => {
    // Entries landing after the skeleton pass (or a viewport resize) can
    // toggle overflow without any scroll event, so the measurement is keyed
    // on the rendered count too.
    if (visibleCount === 0) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    updateChevrons()
    window.addEventListener('resize', updateChevrons)
    return () => window.removeEventListener('resize', updateChevrons)
  }, [updateChevrons, visibleCount])

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  const isLoading = isSessionsLoading || isEntriesLoading

  // Render nothing once the queries prove the rail is empty (no featured
  // entries in the user's languages, or everything already added) — a
  // flash-in/flash-out section is worse than a late one.
  if (!isLoading && visibleCount === 0) return null

  return (
    <div className='mt-6'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-base font-semibold'>{t`Featured content`}</h2>
        <SeeMoreLink to='/explore'>{t`Explore all`}</SeeMoreLink>
      </div>
      <div className='group relative'>
        {/* Edge fades signal hidden content on whichever side can still
            scroll; on mobile they stretch into the -mx-4 bleed so they sit at
            the true viewport edge. Chevrons float fully inside the rail
            (above the fades) so they never straddle the card/page boundary,
            and fade in only while the rail is hovered (or a chevron is
            keyboard-focused) — the edge fades alone carry the "more content
            this way" hint on an idle dashboard. */}
        {canScrollLeft && (
          <div className='from-background pointer-events-none absolute inset-y-0 -left-4 z-10 w-10 bg-linear-to-r to-transparent md:left-0' />
        )}
        {canScrollRight && (
          <div className='from-background pointer-events-none absolute inset-y-0 -right-4 z-10 w-10 bg-linear-to-l to-transparent md:right-0' />
        )}
        {canScrollLeft && (
          <button
            type='button'
            onClick={() => scrollByPage(-1)}
            aria-label={t`Scroll back`}
            className='bg-background hover:bg-accent active:bg-accent absolute top-1/2 left-2 z-20 hidden -translate-y-1/2 rounded-full border p-1.5 opacity-0 shadow-sm transition-[opacity,background-color] group-hover:opacity-100 focus-visible:opacity-100 md:inline-flex'
          >
            <ChevronLeft className='h-4 w-4' />
          </button>
        )}
        {canScrollRight && (
          <button
            type='button'
            onClick={() => scrollByPage(1)}
            aria-label={t`Scroll forward`}
            className='bg-background hover:bg-accent active:bg-accent absolute top-1/2 right-2 z-20 hidden -translate-y-1/2 rounded-full border p-1.5 opacity-0 shadow-sm transition-[opacity,background-color] group-hover:opacity-100 focus-visible:opacity-100 md:inline-flex'
          >
            <ChevronRight className='h-4 w-4' />
          </button>
        )}
        <div
          ref={scrollerRef}
          onScroll={updateChevrons}
          className='-mx-4 mt-2 flex snap-x scroll-pl-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 md:mx-0 md:scroll-pl-0 md:px-0 [&::-webkit-scrollbar]:hidden'
        >
          {isLoading && <SkeletonList count={4} renderItem={() => <ExploreRailCardSkeleton />} />}
          {visible.map((entry) => (
            <ExploreRailCard key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  )
}
