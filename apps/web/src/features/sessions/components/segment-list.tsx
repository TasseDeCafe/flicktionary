import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
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
  // The "read up to here" bookmark divider, rendered below this row (only when
  // the row is in the visible list). `placing` styles the pending position the
  // placement mode is previewing in the sky tone of the selection paint.
  readPositionSegmentId?: string | null
  readPositionVariant?: 'set' | 'placing'
}

export const SegmentList = ({
  segments,
  rangesBySegmentId,
  ghostRangesBySegmentId,
  targetLanguage,
  flashSegmentId,
  readPositionSegmentId,
  readPositionVariant = 'set',
}: Props) => {
  const { t } = useLingui()
  return (
    <div className='flex flex-col divide-y'>
      {segments.map((s) => (
        <div key={s.id} className='flex flex-col'>
          <SegmentRow
            id={s.id}
            text={s.text}
            startMs={s.startMs}
            ranges={rangesBySegmentId?.get(s.id)}
            ghostRanges={ghostRangesBySegmentId?.get(s.id)}
            targetLanguage={targetLanguage}
            flash={flashSegmentId === s.id}
          />
          {readPositionSegmentId === s.id && (
            <div
              className={cn(
                'border-t px-3 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase',
                readPositionVariant === 'placing'
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                  : 'bg-muted/40 text-muted-foreground'
              )}
            >
              {t`Read up to here`}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
