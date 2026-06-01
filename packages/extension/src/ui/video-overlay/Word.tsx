import { memo } from 'react'

export interface WordProps {
  word: string
  sentence: string
  selected: boolean
  // When selected, round only the OUTER corners of the selection run (start =
  // left, end = right) so a multi-word run reads as one continuous block with no
  // per-word notches — without reparenting the word (which would remount it and
  // detach the gloss anchor).
  roundStart?: boolean
  roundEnd?: boolean
  // The pointer entered this word's box. `element` is the live span, used as the
  // floating-ui anchor and for the post-debounce "pointer still here" check.
  onEnter: (element: HTMLElement) => void
  onLeave: () => void
  onContextMenu: (element: HTMLElement) => void
  onMouseDown: (element: HTMLElement) => void
}

// A single clickable subtitle word. Purely presentational — the hover debounce,
// paused gate, selection, and save orchestration all live in SubtitleOverlayApp,
// which coordinates across words and the popover layer. Styling is Tailwind
// utilities adopted into the shadow root (zero `!important`); the yellow hover/
// selection tint matches the legacy `video.css` `rgba(255,255,0,0.35)`.
//
// When `selected`, the word paints NO background of its own — a single wrapper
// span around the whole selected run supplies one continuous block (see
// SubtitleOverlayApp). Only the hover affordance lives here.
export const Word = memo(function Word({
  word,
  sentence,
  selected,
  roundStart,
  roundEnd,
  onEnter,
  onLeave,
  onContextMenu,
  onMouseDown,
}: WordProps) {
  return (
    <span
      data-word={word}
      data-sentence={sentence}
      className={
        'cursor-pointer px-px transition-colors duration-150 select-none ' +
        (selected
          ? 'bg-[rgba(255,255,0,0.35)]' + (roundStart ? ' rounded-l-sm' : '') + (roundEnd ? ' rounded-r-sm' : '')
          : 'rounded-sm hover:bg-[rgba(255,255,0,0.35)]')
      }
      onMouseEnter={(e) => onEnter(e.currentTarget)}
      onMouseLeave={onLeave}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e.currentTarget)
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        onMouseDown(e.currentTarget)
      }}
    >
      {word}
    </span>
  )
})
