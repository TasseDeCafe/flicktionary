import { useId } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { getWordRanges } from '@/lib/dom/word-segmenter'
import { useWordSelection } from '@/lib/dom/use-word-selection'

export type AnnotationInput = {
  index: number
  headword: string
  sense: string
  surfaceForm: string
  charStart: number
  charEnd: number
  rated: boolean
  // Mirrors `annotation.deletedAt != null` from the server. Renders with
  // strikethrough so the user can tell at a glance the term is no longer in
  // their vocabulary; tap still opens the slim Restore-only RateSheet.
  deleted: boolean
}

// Plain-span selection that doesn't overlap any annotation. Used by the
// LookupSheet (peek + Save to vocabulary).
export type PlainSelection = {
  text: string
  // Inclusive/exclusive offsets into the body. Lets the caller render the
  // exact source surface and pass surrounding context to the gloss prompt.
  charStart: number
  charEnd: number
  // Snapshot of the selection's bounding box so the floating sheet can anchor
  // on desktop after the selection paint clears.
  rect: DOMRect
}

interface AnnotatedTextProps {
  body: string
  annotations: AnnotationInput[]
  targetLanguage: string
  // Element ref lets the parent anchor a floating sheet to the exact span
  // the user tapped (desktop popover positioning).
  onAnnotationClick: (index: number, element: HTMLElement) => void
  // Optional selection handler. When provided (and `enabled`), a single
  // tap/click selects a word and a press-and-drag extends a range; if the
  // resulting span falls entirely inside plain text (no annotation overlap),
  // the parent gets the selection and can open a sheet.
  onPlainSelection?: (selection: PlainSelection) => void
  // When false (e.g. the read-only previous-text block), the gesture hook is
  // not mounted and word tokenization is skipped — the paragraph renders as
  // flat plain-text spans + annotation buttons.
  enabled?: boolean
}

// Renders body with each annotation wrapped in a clickable span. We sort by
// charStart, then walk linearly: any overlapping/duplicate annotation is
// dropped (defensive — server-side already validated offsets and (headword,
// sense) but not overlap).
export const AnnotatedText = ({
  body,
  annotations,
  targetLanguage,
  onAnnotationClick,
  onPlainSelection,
  enabled = true,
}: AnnotatedTextProps) => {
  // Stable owner key for the word-span contract — `useId` is constant across
  // re-renders within a single mounted text.
  const ownerKey = useId()
  const sorted = [...annotations]
    .filter((a) => a.charStart >= 0 && a.charEnd > a.charStart && a.charEnd <= body.length)
    .sort((a, b) => a.charStart - b.charStart)

  // Drop overlaps: keep first.
  const nonOverlapping: AnnotationInput[] = []
  let cursor = 0
  for (const a of sorted) {
    if (a.charStart < cursor) continue
    nonOverlapping.push(a)
    cursor = a.charEnd
  }

  const segments: Array<
    { kind: 'plain'; text: string; offset: number } | { kind: 'annotation'; ann: AnnotationInput }
  > = []
  let pos = 0
  for (const ann of nonOverlapping) {
    if (ann.charStart > pos) {
      segments.push({ kind: 'plain', text: body.slice(pos, ann.charStart), offset: pos })
    }
    segments.push({ kind: 'annotation', ann })
    pos = ann.charEnd
  }
  if (pos < body.length) {
    segments.push({ kind: 'plain', text: body.slice(pos), offset: pos })
  }

  const { ref: wordSelectionRef, clearPaint } = useWordSelection({
    enabled,
    isBlockedTarget: (el) => el.closest('[data-kind="annotation"]') != null,
    enableEdgeAutoScroll: false,
    onSelect: ({ anchor, end, rect }) => {
      if (!onPlainSelection) return
      // Single owner (the paragraph), so offset order == document order.
      const charStart = Math.min(anchor.wordStart, end.wordStart)
      const charEnd = Math.max(anchor.wordEnd, end.wordEnd)
      if (charEnd <= charStart) {
        clearPaint()
        return
      }
      // Reject ranges that cross an annotation between two plain words. No
      // fallback or snap-to-edge — the user can re-try.
      for (const ann of nonOverlapping) {
        if (charStart < ann.charEnd && charEnd > ann.charStart) {
          clearPaint()
          return
        }
      }
      const text = body.slice(charStart, charEnd)
      if (text.trim().length === 0) {
        clearPaint()
        return
      }
      onPlainSelection({ text, charStart, charEnd, rect })
    },
  })

  // Renders a plain region either as selectable per-word spans (interactive
  // instance) or a single flat span (read-only previous-text block).
  const renderPlain = (text: string, offset: number, key: number) => {
    if (!enabled) {
      return <span key={key}>{text}</span>
    }
    const wordRanges = getWordRanges(text, targetLanguage)
    const out: React.ReactNode[] = []
    let cur = 0
    // `data-word-piece` lets the selection painter sweep a continuous band
    // across words and the whitespace between them (rather than one box per
    // word). Word pieces additionally carry body-absolute offsets, matching the
    // PlainSelection charStart/charEnd model, with no horizontal padding so
    // elementFromPoint hits exact glyphs.
    wordRanges.forEach(([s, e], wi) => {
      if (s > cur)
        out.push(
          <span key={`${key}-ws-${cur}`} data-word-piece=''>
            {text.slice(cur, s)}
          </span>
        )
      out.push(
        <span
          key={`${key}-w-${wi}`}
          data-word-piece=''
          data-word-start={offset + s}
          data-word-end={offset + e}
          className='cursor-pointer'
        >
          {text.slice(s, e)}
        </span>
      )
      cur = e
    })
    if (cur < text.length)
      out.push(
        <span key={`${key}-ws-${cur}`} data-word-piece=''>
          {text.slice(cur)}
        </span>
      )
    return <span key={key}>{out}</span>
  }

  return (
    <p
      ref={wordSelectionRef}
      data-word-owner={ownerKey}
      className={cn('text-lg leading-relaxed whitespace-pre-wrap md:text-base', enabled && 'touch-pan-y select-none')}
      style={enabled ? { WebkitTouchCallout: 'none' } : undefined}
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'plain') {
          return renderPlain(seg.text, seg.offset, i)
        }
        const ann = seg.ann
        return (
          // Use paint-only shadow for the visual cushion. Inline padding
          // changes text width and can reflow the paragraph when a word becomes
          // annotated.
          <button
            key={`${i}-${ann.index}`}
            type='button'
            data-kind='annotation'
            onClick={(e) => onAnnotationClick(ann.index, e.currentTarget)}
            className={cn(
              'cursor-pointer rounded-sm transition-[background-color,box-shadow]',
              ann.deleted
                ? 'text-gray-400 line-through decoration-gray-400 hover:bg-gray-100 hover:shadow-[0_0_0_0.125rem_var(--color-gray-100)]'
                : ann.rated
                  ? 'bg-gray-100 text-gray-500 underline decoration-dotted shadow-[0_0_0_0.125rem_var(--color-gray-100)]'
                  : 'bg-yellow-100 text-yellow-950 underline decoration-yellow-500 decoration-2 shadow-[0_0_0_0.125rem_var(--color-yellow-100)] hover:bg-yellow-200 hover:shadow-[0_0_0_0.125rem_var(--color-yellow-200)]'
            )}
          >
            {body.slice(ann.charStart, ann.charEnd)}
          </button>
        )
      })}
    </p>
  )
}
