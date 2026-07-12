import { useState, type ReactNode } from 'react'
import { useWordSelection } from '@/lib/dom/use-word-selection'
import { resolveGlossSelection, type GlossOwner } from '../utils/resolve-gloss-selection'
import { LookupSheet } from './lookup-sheet'
import type { PlainSelection } from './annotated-text'

// Select-to-gloss wrapper for exercise content. Owns the word-selection
// gesture over its children (SelectableSentence instances keyed into `owners`)
// and mounts the LookupSheet the resolved selection opens. Each mounted
// exercise gets its own instance — the exercise remounts per item, taking the
// sheet and paint state with it.
interface GlossableAreaProps {
  targetLanguage: string
  enabled?: boolean
  // Keyed by data-word-owner. Gating lives here: pre-answer blocked spans and
  // the cloze blank belong in each owner's rejectedRanges.
  owners: Record<string, GlossOwner>
  // Parents fold this into their hotkey `enabled` flags so number/skip keys
  // stay inert under an open gloss sheet.
  onOpenChange?: (open: boolean) => void
  // Applied to the wrapper div — pass the parent's layout classes (e.g. the
  // exercise body's flex column) so wrapping doesn't collapse its spacing.
  className?: string
  children: ReactNode
}

export const GlossableArea = ({
  targetLanguage,
  enabled = true,
  owners,
  onOpenChange,
  className,
  children,
}: GlossableAreaProps) => {
  const [selection, setSelection] = useState<PlainSelection | null>(null)
  const [contextText, setContextText] = useState('')
  const [open, setOpen] = useState(false)

  const setOpenAndReport = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  const { ref, clearPaint } = useWordSelection({
    enabled,
    isBlockedTarget: () => false,
    enableEdgeAutoScroll: false,
    onSelect: ({ anchor, end, rect }) => {
      const resolved = resolveGlossSelection({ anchor, end, owners })
      // Rejected gestures (cross-owner drags, blocked/blank overlap, empty
      // slices) clear their own paint — it persists past pointerup otherwise.
      if (!resolved) {
        clearPaint()
        return
      }
      setSelection({ text: resolved.text, charStart: resolved.charStart, charEnd: resolved.charEnd, rect })
      setContextText(resolved.contextText)
      setOpenAndReport(true)
    },
  })

  return (
    <>
      <div ref={ref} className={className}>
        {children}
      </div>
      <LookupSheet
        open={open}
        selection={selection}
        contextText={contextText}
        targetLanguage={targetLanguage}
        // Tapping another word swaps the sheet's content in place instead of
        // dismiss-then-reopen (the reader's gesture feel).
        ignoreOutsidePointerDownSelector='[data-word-piece]'
        onClose={() => {
          setOpenAndReport(false)
          clearPaint()
        }}
      />
    </>
  )
}
