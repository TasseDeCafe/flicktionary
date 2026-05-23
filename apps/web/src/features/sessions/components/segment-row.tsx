import { Fragment, useMemo } from 'react'
import { stripSrtMarkupWithMap } from '@flicktionary/core/utils/srt-markup'
import { getWordRanges } from '@/lib/dom/word-segmenter'
import {
  buildWordHighlightSpans,
  type SegmentHighlightRange,
  type WordHighlightSpan,
} from '../utils/word-highlight-spans'

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hh = Math.floor(totalSeconds / 3600)
  const mm = Math.floor((totalSeconds % 3600) / 60)
  const ss = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

type Props = {
  id: string
  text: string
  startMs: number | null
  ranges?: SegmentHighlightRange[]
  targetLanguage: string
  flash?: boolean
}

export const SegmentRow = ({ id, text, startMs, ranges, targetLanguage, flash }: Props) => {
  const ts = useMemo(() => formatTimestamp(startMs), [startMs])
  // Strip SRT markup and remap incoming highlight ranges into display-text
  // coords — the coordinate system the rendered DOM, existing highlights, and
  // the new word offsets all live in (matching the old readCurrentSelection).
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

  // Group consecutive runs that share a highlight id, so each highlight renders
  // as ONE rounded/padded yellow container instead of one box per word + space.
  const groups = useMemo(() => {
    const wordRanges = getWordRanges(displayText, targetLanguage)
    const spans = buildWordHighlightSpans(displayText, displayRanges, wordRanges)
    const out: Array<{ highlightId: string | null; parts: WordHighlightSpan[] }> = []
    for (const s of spans) {
      const last = out[out.length - 1]
      if (last && last.highlightId === s.highlightId) last.parts.push(s)
      else out.push({ highlightId: s.highlightId, parts: [s] })
    }
    return out
  }, [displayText, displayRanges, targetLanguage])

  // A leaf text piece. `data-word-piece` lets the selection painter sweep a
  // continuous run (words + the whitespace between them); word pieces also
  // carry their offsets, with no horizontal padding so elementFromPoint
  // hit-tests against exact glyph bounds.
  const renderPiece = (part: WordHighlightSpan, key: React.Key) =>
    part.word != null ? (
      <span key={key} data-word-piece='' data-word-start={part.word[0]} data-word-end={part.word[1]}>
        {part.text}
      </span>
    ) : (
      <span key={key} data-word-piece=''>
        {part.text}
      </span>
    )

  return (
    <div className={'flex items-start gap-3 py-1 transition-colors duration-700' + (flash ? ' bg-yellow-100' : '')}>
      {ts && (
        <span className='text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums select-none'>{ts}</span>
      )}
      <span data-segment-id={id} data-word-owner={id} className='flex-1 text-lg md:text-base'>
        {groups.map((g, gi) =>
          g.highlightId != null ? (
            <span
              key={gi}
              data-highlight-id={g.highlightId}
              className='cursor-pointer rounded bg-yellow-200 px-0.5 hover:bg-yellow-300'
            >
              {g.parts.map((part, idx) => renderPiece(part, idx))}
            </span>
          ) : (
            <Fragment key={gi}>{g.parts.map((part, idx) => renderPiece(part, idx))}</Fragment>
          )
        )}
      </span>
    </div>
  )
}
