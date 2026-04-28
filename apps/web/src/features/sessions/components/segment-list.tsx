import { SegmentRow, SegmentHighlightRange } from './segment-row'

type Segment = {
  id: string
  text: string
  startMs: number | null
}

type Props = {
  segments: Segment[]
  rangesBySegmentId?: Map<string, SegmentHighlightRange[]>
}

export const SegmentList = ({ segments, rangesBySegmentId }: Props) => {
  return (
    <div className='flex flex-col divide-y'>
      {segments.map((s) => (
        <SegmentRow key={s.id} id={s.id} text={s.text} startMs={s.startMs} ranges={rangesBySegmentId?.get(s.id)} />
      ))}
    </div>
  )
}
