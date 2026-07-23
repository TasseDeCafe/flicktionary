import { useState } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// Mobile: horizontally snap-scrolling slides with page dots, bleeding to the
// screen edges like the sessions filter-chip row. Desktop (md+): the same
// children laid out as a side-by-side grid — no scroll, no dots. With a single
// slide the scroller is inert, the dots are omitted on both, and the desktop
// slide is capped near one two-column-grid column and centered — the calendar
// card's fixed-size day circles look scattered at full page width.
export const DashboardCarousel = ({ slides }: { slides: React.ReactNode[] }) => {
  const [active, setActive] = useState(0)

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (el.clientWidth === 0) return
    setActive(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <div>
      <div
        onScroll={handleScroll}
        className={cn(
          '-mx-4 flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden',
          'md:mx-0 md:grid md:snap-none md:gap-4 md:overflow-visible',
          slides.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-1'
        )}
      >
        {slides.map((slide, i) => (
          // Grid items stretch by default, so each slide's card can take
          // md:h-full and the two cards always end at the same edge.
          <div
            key={i}
            className={cn(
              'w-full shrink-0 snap-center px-4 md:w-auto md:px-0',
              slides.length === 1 && 'md:mx-auto md:w-full md:max-w-lg'
            )}
          >
            {slide}
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <div className='mt-3 flex justify-center gap-1.5 md:hidden'>
          {slides.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-[width,background-color]',
                i === active ? 'bg-foreground w-4' : 'bg-muted-foreground/30 w-1.5'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
