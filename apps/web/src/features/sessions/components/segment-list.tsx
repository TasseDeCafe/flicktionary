import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type { SegmentGhostRange, SegmentHighlightRange } from '../utils/word-highlight-spans'
import { SegmentRow } from './segment-row'

// Varied widths so the placeholder reads as lines of subtitle text rather than a
// stack of identical bars. Literal classes so Tailwind keeps them at build time.
const SEGMENT_SKELETON_WIDTHS = [
  'w-3/4',
  'w-1/2',
  'w-5/6',
  'w-2/3',
  'w-1/3',
  'w-4/5',
  'w-1/2',
  'w-3/5',
  'w-11/12',
  'w-2/5',
  'w-3/4',
  'w-1/2',
]

// Mirrors SegmentRow: a right-aligned timestamp slot + the subtitle line, inside
// the same `divide-y` column the real list uses.
export const SegmentListSkeleton = () => (
  <div className='flex flex-col divide-y'>
    {SEGMENT_SKELETON_WIDTHS.map((width, i) => (
      <div key={i} className='flex items-start gap-3 py-2'>
        <Skeleton className='h-4 w-9 shrink-0' />
        <Skeleton className={`h-5 ${width}`} />
      </div>
    ))}
  </div>
)

type Segment = {
  id: string
  text: string
  startMs: number | null
}

type Props = {
  segments: Segment[]
  rangesBySegmentId?: Map<string, SegmentHighlightRange[]>
  ghostRangesBySegmentId?: Map<string, SegmentGhostRange[]>
  targetLanguage: string
  flashSegmentId?: string | null
}

export const SegmentList = ({
  segments,
  rangesBySegmentId,
  ghostRangesBySegmentId,
  targetLanguage,
  flashSegmentId,
}: Props) => {
  return (
    <div className='flex flex-col divide-y'>
      {segments.map((s) => (
        <SegmentRow
          key={s.id}
          id={s.id}
          text={s.text}
          startMs={s.startMs}
          ranges={rangesBySegmentId?.get(s.id)}
          ghostRanges={ghostRangesBySegmentId?.get(s.id)}
          targetLanguage={targetLanguage}
          flash={flashSegmentId === s.id}
        />
      ))}
    </div>
  )
}
