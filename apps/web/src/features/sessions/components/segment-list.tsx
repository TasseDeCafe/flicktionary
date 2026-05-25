import type { SegmentGhostRange, SegmentHighlightRange } from '../utils/word-highlight-spans'
import { SegmentRow } from './segment-row'

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
