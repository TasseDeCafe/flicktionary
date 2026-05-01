import { useMemo } from 'react'
import { stripSrtMarkupWithMap } from '@flicktionary/core/utils/srt-markup'

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hh = Math.floor(totalSeconds / 3600)
  const mm = Math.floor((totalSeconds % 3600) / 60)
  const ss = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

export type SegmentHighlightRange = {
  highlightId: string
  start: number
  end: number
}

type Props = {
  id: string
  text: string
  startMs: number | null
  ranges?: SegmentHighlightRange[]
  flash?: boolean
}

type SpanPart = { text: string; highlightId: string | null }

// Splits the segment text into a sequence of consecutive runs, each tagged with
// either a highlight id or null. Runs of overlapping highlights collapse to the
// last id (last write wins), which is fine for the rare overlap case.
const buildSpans = (text: string, ranges: SegmentHighlightRange[]): SpanPart[] => {
  if (ranges.length === 0) return [{ text, highlightId: null }]
  const len = text.length
  const marks: (string | null)[] = new Array(len).fill(null)
  for (const r of ranges) {
    const s = Math.max(0, Math.min(len, r.start))
    const e = Math.max(0, Math.min(len, r.end))
    for (let i = s; i < e; i++) marks[i] = r.highlightId
  }
  const parts: SpanPart[] = []
  let i = 0
  while (i < len) {
    const cur = marks[i]
    let j = i + 1
    while (j < len && marks[j] === cur) j++
    parts.push({ text: text.slice(i, j), highlightId: cur })
    i = j
  }
  return parts
}

export const SegmentRow = ({ id, text, startMs, ranges, flash }: Props) => {
  const ts = useMemo(() => formatTimestamp(startMs), [startMs])
  const { displayText, displayRanges } = useMemo(() => {
    const { stripped, map } = stripSrtMarkupWithMap(text)
    if (stripped === text) return { displayText: text, displayRanges: ranges ?? [] }
    const remapped = (ranges ?? []).map((r) => ({
      highlightId: r.highlightId,
      start: map[Math.max(0, Math.min(text.length, r.start))]!,
      end: map[Math.max(0, Math.min(text.length, r.end))]!,
    }))
    return { displayText: stripped, displayRanges: remapped }
  }, [text, ranges])
  const spans = useMemo(() => buildSpans(displayText, displayRanges), [displayText, displayRanges])

  return (
    <div className={'flex items-start gap-3 py-1 transition-colors duration-700' + (flash ? ' bg-yellow-100' : '')}>
      <span className='text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums select-none'>{ts}</span>
      <span data-segment-id={id} className='flex-1'>
        {spans.map((part, idx) =>
          part.highlightId ? (
            <span
              key={idx}
              data-highlight-id={part.highlightId}
              className='cursor-pointer rounded bg-yellow-200 px-0.5 hover:bg-yellow-300'
            >
              {part.text}
            </span>
          ) : (
            <span key={idx}>{part.text}</span>
          )
        )}
      </span>
    </div>
  )
}
