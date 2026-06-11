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
  // Part of a persistent saved highlight (a Flicktionary highlight row).
  // Rendered as an understated underline + tint, deliberately distinct from the
  // live-selection yellow; the live selection wins while both apply. Same
  // outer-corner rounding scheme as selection.
  saved?: boolean
  savedRoundStart?: boolean
  savedRoundEnd?: boolean
  // The pointer entered this word's box. `element` is the live span, used as the
  // floating-ui anchor and for the post-debounce "pointer still here" check.
  onEnter: (element: HTMLElement) => void
  onLeave: () => void
  onContextMenu: (element: HTMLElement) => void
  onMouseDown: (element: HTMLElement) => void
}

// Saved-highlight paint, shared with the inter-word filler spans in
// SubtitleOverlayApp so a multi-word saved span reads as one block.
export const SAVED_SPAN_CLASS =
  'bg-[rgba(94,234,212,0.16)] underline decoration-[rgba(94,234,212,0.85)] decoration-2 underline-offset-4'

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
  saved,
  savedRoundStart,
  savedRoundEnd,
  onEnter,
  onLeave,
  onContextMenu,
  onMouseDown,
}: WordProps) {
  const stateClass = selected
    ? 'bg-[rgba(255,255,0,0.35)]' + (roundStart ? ' rounded-l-sm' : '') + (roundEnd ? ' rounded-r-sm' : '')
    : saved
      ? SAVED_SPAN_CLASS +
        ' hover:bg-[rgba(255,255,0,0.35)]' +
        (savedRoundStart ? ' rounded-l-sm' : '') +
        (savedRoundEnd ? ' rounded-r-sm' : '')
      : 'rounded-sm hover:bg-[rgba(255,255,0,0.35)]'
  return (
    <span
      data-word={word}
      data-sentence={sentence}
      className={'cursor-pointer px-px transition-colors duration-150 select-none ' + stateClass}
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
