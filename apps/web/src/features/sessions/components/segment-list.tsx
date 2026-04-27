import { SegmentRow } from './segment-row'

type Segment = {
  id: string
  text: string
  startMs: number | null
}

type Props = {
  segments: Segment[]
  highlightedSegmentIds?: Set<string>
}

export const SegmentList = ({ segments, highlightedSegmentIds }: Props) => {
  return (
    <div className='flex flex-col divide-y'>
      {segments.map((s) => (
        <SegmentRow
          key={s.id}
          id={s.id}
          text={s.text}
          startMs={s.startMs}
          isHighlighted={highlightedSegmentIds?.has(s.id)}
        />
      ))}
    </div>
  )
}
