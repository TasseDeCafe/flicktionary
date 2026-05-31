import { memo } from 'react'

export interface WordProps {
  word: string
  sentence: string
  selected: boolean
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
export const Word = memo(function Word({
  word,
  sentence,
  selected,
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
        'cursor-pointer rounded-sm px-px transition-colors duration-150 select-none ' +
        (selected ? 'bg-[rgba(255,255,0,0.35)]' : 'hover:bg-[rgba(255,255,0,0.35)]')
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
