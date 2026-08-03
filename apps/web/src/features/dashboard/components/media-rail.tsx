import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// Sizing for cards inside a MediaRail: fixed ~230px on mobile (thumbnails stay
// readable), exactly four per view on desktop (gap-3 ⇒ 3 × 0.75rem shared
// across 4 columns).
export const RAIL_CARD_CLASS = 'w-[230px] shrink-0 snap-start md:w-[calc(25%-0.5625rem)]'

type Props = {
  // Keys the chevron measurement: items landing after the skeleton pass (or a
  // viewport resize) can toggle overflow without any scroll event.
  itemCount: number
  // Merged over the scroller's classes. A section that swaps the rail for a
  // wrapping grid on desktop (e.g. `md:grid md:grid-cols-4`) can pass it here
  // and keep the mobile fades — chevrons and fades key off actual horizontal
  // overflow, so a non-scrolling grid never shows them.
  scrollerClassName?: string
  children: ReactNode
}

// A single-row horizontal card rail: swipe on mobile (full-bleed into the page
// padding), hover-revealed chevrons + edge fades on desktop.
export const MediaRail = ({ itemCount, scrollerClassName, children }: Props) => {
  const { t } = useLingui()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateChevrons = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 1)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  // Re-measured whenever the rendered count changes — items landing after the
  // skeleton pass (or a viewport resize) can toggle overflow without any
  // scroll event. An emptied rail keeps its stale measurement; the render
  // gates below hide the affordances instead of an effect resetting state.
  useEffect(() => {
    updateChevrons()
    window.addEventListener('resize', updateChevrons)
    return () => window.removeEventListener('resize', updateChevrons)
  }, [updateChevrons, itemCount])

  const showLeft = itemCount > 0 && canScrollLeft
  const showRight = itemCount > 0 && canScrollRight

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <div className='group relative'>
      {/* Edge fades signal hidden content on whichever side can still scroll;
          on mobile they stretch into the -mx-4 bleed so they sit at the true
          viewport edge. Chevrons float fully inside the rail (above the fades)
          so they never straddle the card/page boundary, and fade in only while
          the rail is hovered (or a chevron is keyboard-focused) — the edge
          fades alone carry the "more content this way" hint on an idle
          dashboard. */}
      {showLeft && (
        <div className='from-background pointer-events-none absolute inset-y-0 -left-4 z-10 w-10 bg-linear-to-r to-transparent md:left-0' />
      )}
      {showRight && (
        <div className='from-background pointer-events-none absolute inset-y-0 -right-4 z-10 w-10 bg-linear-to-l to-transparent md:right-0' />
      )}
      {showLeft && (
        <button
          type='button'
          onClick={() => scrollByPage(-1)}
          aria-label={t`Scroll back`}
          className='bg-background hover:bg-accent active:bg-accent absolute top-1/2 left-2 z-20 hidden -translate-y-1/2 rounded-full border p-1.5 opacity-0 shadow-sm transition-[opacity,background-color] group-hover:opacity-100 focus-visible:opacity-100 md:inline-flex'
        >
          <ChevronLeft className='h-4 w-4' />
        </button>
      )}
      {showRight && (
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
        className={cn(
          '-mx-4 mt-2 flex snap-x scroll-pl-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 md:mx-0 md:scroll-pl-0 md:px-0 [&::-webkit-scrollbar]:hidden',
          scrollerClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}
