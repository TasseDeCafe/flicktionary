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
  // Rendered with the web reader's saved-yellow treatment, distinct from the
  // live-selection sky; the live selection wins while both apply. Same
  // outer-corner rounding scheme as selection.
  saved?: boolean
  savedRoundStart?: boolean
  savedRoundEnd?: boolean
  // The pointer entered this word's box. `element` is the live span, used as the
  // FloatingSheet anchor and for the post-debounce "pointer still here" check.
  onEnter: (element: HTMLElement) => void
  onLeave: () => void
  onContextMenu: (element: HTMLElement) => void
  onMouseDown: (element: HTMLElement) => void
}

// Saved-highlight paint, shared with the inter-word filler spans in
// SubtitleOverlayApp so a multi-word saved span reads as one block. Matches the
// web reader's dark-mode committed highlight (yellow wash + yellow glyphs) —
// written as explicit colors, not `dark:` variants, because the subtitle shadow
// tree has no `.dark` ancestor. No shadow-ring cushion here: the web draws it
// on ONE span per highlight, but these are per-token spans, and overlapping
// translucent rings double-darken at every word boundary.
export const SAVED_SPAN_CLASS = 'bg-yellow-400/20 text-yellow-200'

// Live-selection paint (web parity: the reader's dark-mode word-selection wash),
// shared with the whole-run wrapper span in SubtitleOverlayApp.
export const SELECTION_SPAN_CLASS = 'bg-sky-400/25'

// A single clickable subtitle word. Purely presentational — the hover debounce,
// paused gate, selection, and save orchestration all live in SubtitleOverlayApp,
// which coordinates across words and the popover layer. Styling is Tailwind
// utilities adopted into the shadow root (zero `!important`). Color semantics
// match the web reader: sky = transient selection, yellow = saved highlight,
// and the hover affordance is a neutral white wash (it means "glossable", a
// state the click-driven web doesn't need to paint).
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
    ? SELECTION_SPAN_CLASS + (roundStart ? ' rounded-l-sm' : '') + (roundEnd ? ' rounded-r-sm' : '')
    : saved
      ? SAVED_SPAN_CLASS +
        ' hover:bg-yellow-400/30' +
        (savedRoundStart ? ' rounded-l-sm' : '') +
        (savedRoundEnd ? ' rounded-r-sm' : '')
      : 'rounded-sm hover:bg-white/20'
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
