import { useLayoutEffect, useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Props = {
  scrollEl: HTMLElement | null
  // Searching renders a filtered list, whose scroll range says nothing about
  // the text — the track stays (no layout shift) but the fill goes away.
  hidden: boolean
  // With the header slid away the bar is the topmost element, which on an iOS
  // Home Screen install sits in the blurred band under the status bar — drop
  // it below that band.
  headerHidden: boolean
  // Tapping the text-free strip above the bar brings the chrome back.
  onReveal: () => void
}

// Where the viewport is in the text, from the scroll position rather than the
// saved reading pointer, so it follows rereads too. The fill is written
// straight to the DOM on scroll: re-rendering the reader per scroll event
// would stutter.
export const ReadingProgressBar = ({ scrollEl, hidden, headerHidden, onReveal }: Props) => {
  const { t } = useLingui()
  const fillRef = useRef<HTMLDivElement>(null)

  // Layout effect so the first fill lands before paint (no full-width flash).
  useLayoutEffect(() => {
    const fill = fillRef.current
    if (!scrollEl || !fill) return
    let frame = 0
    const update = () => {
      frame = 0
      const range = scrollEl.scrollHeight - scrollEl.clientHeight
      const progress = range > 0 ? Math.min(1, Math.max(0, scrollEl.scrollTop / range)) : 1
      fill.style.transform = `scaleX(${progress})`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    // Segments, cards and the close-out mount after the fact and change the
    // scroll range without any scroll event.
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(scrollEl)
    if (scrollEl.firstElementChild) resizeObserver.observe(scrollEl.firstElementChild)
    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      resizeObserver.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [scrollEl, hidden])

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'bg-muted h-[3px] shrink-0 transition-[margin] duration-200 ease-out motion-reduce:transition-none',
          headerHidden && 'ios-standalone:mt-4'
        )}
      >
        {!hidden && <div ref={fillRef} className='bg-primary/60 h-full origin-left' />}
      </div>
      {/* On an iOS Home Screen install, hiding the header leaves a text-free
          strip on top (the status-bar blur padding + this bar's margin) —
          the Kindle "tap the top" target. Absolute against ModalScreen's
          `relative` root (no positioned ancestor in between, and the content
          wrapper's overflow clip doesn't apply to it), so it also covers the
          root's padding. Its height mirrors the padding + `mt-4` + the bar. */}
      {headerHidden && (
        <button
          type='button'
          aria-label={t`Show controls`}
          onClick={onReveal}
          className='ios-standalone:block absolute inset-x-0 top-0 z-20 hidden h-[calc(var(--spacing-status-blur)+1rem+3px)]'
        />
      )}
    </>
  )
}
