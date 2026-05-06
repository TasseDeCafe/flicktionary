import { Fragment } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

export type AnnotationInput = {
  index: number
  headword: string
  sense: string
  surfaceForm: string
  charStart: number
  charEnd: number
  rated: boolean
}

interface AnnotatedTextProps {
  body: string
  annotations: AnnotationInput[]
  onAnnotationClick: (index: number) => void
}

// Renders body with each annotation wrapped in a clickable span. We sort by
// charStart, then walk linearly: any overlapping/duplicate annotation is
// dropped (defensive — server-side already validated offsets and (headword,
// sense) but not overlap).
export const AnnotatedText = ({ body, annotations, onAnnotationClick }: AnnotatedTextProps) => {
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

  const segments: Array<{ kind: 'plain'; text: string } | { kind: 'annotation'; ann: AnnotationInput }> = []
  let pos = 0
  for (const ann of nonOverlapping) {
    if (ann.charStart > pos) {
      segments.push({ kind: 'plain', text: body.slice(pos, ann.charStart) })
    }
    segments.push({ kind: 'annotation', ann })
    pos = ann.charEnd
  }
  if (pos < body.length) {
    segments.push({ kind: 'plain', text: body.slice(pos) })
  }

  return (
    <p className='text-base leading-relaxed whitespace-pre-wrap'>
      {segments.map((seg, i) => {
        if (seg.kind === 'plain') {
          return <Fragment key={i}>{seg.text}</Fragment>
        }
        const ann = seg.ann
        return (
          <button
            key={`${i}-${ann.index}`}
            type='button'
            onClick={() => onAnnotationClick(ann.index)}
            className={cn(
              'cursor-pointer rounded-sm px-0.5 transition-colors',
              ann.rated
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
