import { useRef } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { findMarkedAncestor, offsetWithinAncestor } from '@/lib/dom/text-selection'

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
  // on desktop after the browser selection clears.
  rect: DOMRect
}

interface AnnotatedTextProps {
  body: string
  annotations: AnnotationInput[]
  // Element ref lets the parent anchor a floating sheet to the exact span
  // the user tapped (desktop popover positioning).
  onAnnotationClick: (index: number, element: HTMLElement) => void
  // Optional selection handler. When provided, mouseup/touchend on the body
  // computes the selected range; if it falls entirely inside plain text (no
  // annotation overlap), the parent gets the selection and can open a sheet.
  onPlainSelection?: (selection: PlainSelection) => void
}

// Renders body with each annotation wrapped in a clickable span. We sort by
// charStart, then walk linearly: any overlapping/duplicate annotation is
// dropped (defensive — server-side already validated offsets and (headword,
// sense) but not overlap).
export const AnnotatedText = ({ body, annotations, onAnnotationClick, onPlainSelection }: AnnotatedTextProps) => {
  const containerRef = useRef<HTMLParagraphElement | null>(null)
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

  // Resolves the current Window selection to a (charStart, charEnd) span in
  // `body`. Each rendered child is tagged `data-kind="plain"` or
  // `data-kind="annotation"` with `data-offset=<bodyOffset>`. Using the same
  // primitives as `readCurrentSelection` (in features/sessions): find the
  // nearest marked ancestor for each Range endpoint, then add its base
  // offset to a Range-based local offset. Selections that start/end inside
  // an annotation, or that straddle one, are disqualified — the rate sheet
  // owns annotation taps.
  //
  // The 30ms timeout + clear-on-success mirrors `session-view.tsx`: iOS
  // Safari hasn't finalized the selection by the time touchend fires, and
  // the lingering selection paint underneath the modal makes the highlight
  // band look much wider than what we actually captured.
  const handleSelectionEnd = () => {
    if (!onPlainSelection) return
    setTimeout(() => {
      const container = containerRef.current
      if (!container) return
      const selection = typeof window !== 'undefined' ? window.getSelection() : null
      if (!selection || selection.isCollapsed) return
      if (selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return

      const isPlainMarker = (el: HTMLElement) => el.dataset.kind === 'plain' && el.dataset.offset != null
      const isAnnotationMarker = (el: HTMLElement) => el.dataset.kind === 'annotation'

      // Reject endpoints that fall inside an annotation span before checking
      // for a plain ancestor — annotations live as descendants of `container`
      // and `findMarkedAncestor` would otherwise just walk past them.
      if (
        findMarkedAncestor(range.startContainer, isAnnotationMarker) ||
        findMarkedAncestor(range.endContainer, isAnnotationMarker)
      ) {
        return
      }

      const startPlain = findMarkedAncestor(range.startContainer, isPlainMarker)
      const endPlain = findMarkedAncestor(range.endContainer, isPlainMarker)
      if (!startPlain || !endPlain) return

      const startBase = Number(startPlain.dataset.offset)
      const endBase = Number(endPlain.dataset.offset)
      if (!Number.isFinite(startBase) || !Number.isFinite(endBase)) return

      const startOffset = startBase + offsetWithinAncestor(startPlain, range.startContainer, range.startOffset)
      const endOffset = endBase + offsetWithinAncestor(endPlain, range.endContainer, range.endOffset)
      const charStart = Math.min(startOffset, endOffset)
      const charEnd = Math.max(startOffset, endOffset)
      if (charEnd <= charStart) return

      // Final safety net: the range may span across an annotation between two
      // plain spans even when both endpoints landed in plain text.
      for (const ann of nonOverlapping) {
        if (charStart < ann.charEnd && charEnd > ann.charStart) return
      }

      const text = body.slice(charStart, charEnd).trim()
      if (text.length === 0) return
      onPlainSelection({ text, charStart, charEnd, rect: range.getBoundingClientRect() })
      // Mirror session-view: drop the browser selection once we've captured
      // it so the underlying paint doesn't linger behind the sheet.
      selection.removeAllRanges()
    }, 30)
  }

  return (
    <p
      ref={containerRef}
      className='text-base leading-relaxed whitespace-pre-wrap'
      onMouseUp={handleSelectionEnd}
      onTouchEnd={handleSelectionEnd}
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'plain') {
          return (
            <span key={i} data-kind='plain' data-offset={seg.offset}>
              {seg.text}
            </span>
          )
        }
        const ann = seg.ann
        return (
          <button
            key={`${i}-${ann.index}`}
            type='button'
            data-kind='annotation'
            data-offset={ann.charStart}
            onClick={(e) => onAnnotationClick(ann.index, e.currentTarget)}
            className={cn(
              'cursor-pointer rounded-sm px-0.5 transition-colors',
              ann.deleted
                ? 'text-gray-400 line-through decoration-gray-400 hover:bg-gray-100'
                : ann.rated
                  ? 'bg-gray-100 text-gray-500 underline decoration-dotted'
                  : 'bg-yellow-100 text-yellow-950 underline decoration-yellow-500 decoration-2 hover:bg-yellow-200'
            )}
          >
            {body.slice(ann.charStart, ann.charEnd)}
          </button>
        )
      })}
    </p>
  )
}
