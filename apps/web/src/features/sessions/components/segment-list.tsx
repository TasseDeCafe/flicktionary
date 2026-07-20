import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
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
  // The reading-position divider, rendered below this row (only when the row
  // is in the visible list). `placing` styles the pending position the
  // placement mode is previewing in the sky tone of the selection paint;
  // `resumed` is the sitting-open resting boundary ("Resumed here"); `manual`
  // is a bookmark the reader placed this sitting ("Read up to here").
  readPositionSegmentId?: string | null
  readPositionVariant?: 'resumed' | 'manual' | 'placing'
  // The welcome-back offer, rendered below this row (after the divider when
  // both anchor to the same line).
  welcomeCardSegmentId?: string | null
  welcomeCard?: ReactNode
}

export const SegmentList = ({
  segments,
  rangesBySegmentId,
  ghostRangesBySegmentId,
  targetLanguage,
  flashSegmentId,
  readPositionSegmentId,
  readPositionVariant = 'resumed',
  welcomeCardSegmentId,
  welcomeCard,
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
          {readPositionSegmentId === s.id &&
            (readPositionVariant === 'placing' ? (
              <div className='border-t bg-sky-50 px-3 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-sky-700 uppercase dark:bg-sky-950 dark:text-sky-300'>
                {t`Read up to here`}
              </div>
            ) : (
              // The resting divider stays mounted for the whole sitting
              // (WhatsApp's unread-messages bar), so its copy must stay true
              // after the reader passes it: "Resumed here" for the
              // sitting-open boundary, "Read up to here" for a manual set
              // (nothing was resumed there). Quiet hairline treatment:
              // findable when scrolling back, invisible while reading past.
              <div className='flex items-center gap-2.5 py-1.5'>
                <span className='bg-border h-px flex-1' />
                <span className='text-muted-foreground text-[10px] font-semibold tracking-[0.09em] uppercase'>
                  {readPositionVariant === 'manual' ? t`Read up to here` : t`Resumed here`}
                </span>
                <span className='bg-border h-px flex-1' />
              </div>
            ))}
          {welcomeCardSegmentId === s.id && welcomeCard}
        </div>
      ))}
    </div>
  )
}
