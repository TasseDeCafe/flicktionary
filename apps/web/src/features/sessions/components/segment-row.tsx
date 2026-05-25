import { Fragment, useMemo } from 'react'
import { stripSrtMarkupWithMap } from '@flicktionary/core/utils/srt-markup'
import { getWordRanges } from '@/lib/dom/word-segmenter'
import {
  buildWordHighlightSpans,
  type SegmentGhostRange,
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
  ghostRanges?: SegmentGhostRange[]
  targetLanguage: string
  flash?: boolean
}

export const SegmentRow = ({ id, text, startMs, ranges, ghostRanges, targetLanguage, flash }: Props) => {
  const ts = useMemo(() => formatTimestamp(startMs), [startMs])
  // Strip SRT markup and remap incoming highlight + ghost ranges into display-text
  // coords — the coordinate system the rendered DOM, existing highlights, ghost
  // candidates, and the new word offsets all live in.
  const { displayText, displayRanges, displayGhostRanges } = useMemo(() => {
    const { stripped, map } = stripSrtMarkupWithMap(text)
    if (stripped === text) {
      return { displayText: text, displayRanges: ranges ?? [], displayGhostRanges: ghostRanges ?? [] }
    }
    const remap = (n: number) => map[Math.max(0, Math.min(text.length, n))]!
    const remapped = (ranges ?? []).map((r) => ({
      highlightId: r.highlightId,
      start: remap(r.start),
      end: remap(r.end),
    }))
    const remappedGhosts = (ghostRanges ?? []).map((g) => ({
      ghostId: g.ghostId,
      start: remap(g.start),
      end: remap(g.end),
    }))
    return { displayText: stripped, displayRanges: remapped, displayGhostRanges: remappedGhosts }
  }, [text, ranges, ghostRanges])

  // Group consecutive runs that share a (highlight, ghost) pair, so each highlight
  // renders as ONE rounded/padded yellow container and each ghost as ONE outline.
  const groups = useMemo(() => {
    const wordRanges = getWordRanges(displayText, targetLanguage)
    const spans = buildWordHighlightSpans(displayText, displayRanges, wordRanges, displayGhostRanges)
    const out: Array<{ highlightId: string | null; ghostId: string | null; parts: WordHighlightSpan[] }> = []
    for (const s of spans) {
      const last = out[out.length - 1]
      if (last && last.highlightId === s.highlightId && last.ghostId === s.ghostId) last.parts.push(s)
      else out.push({ highlightId: s.highlightId, ghostId: s.ghostId, parts: [s] })
    }
    return out
  }, [displayText, displayRanges, displayGhostRanges, targetLanguage])

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
        {groups.map((g, gi) => {
          // Use paint-only shadow for the visual cushion. Inline padding changes
          // text width and can reflow the subtitle line.
          if (g.highlightId != null) {
            // Committed highlight wins on overlap — render the fill, not the outline.
            return (
              <span
                key={gi}
                data-highlight-id={g.highlightId}
                className='cursor-pointer rounded bg-yellow-200 shadow-[0_0_0_0.125rem_var(--color-yellow-200)] hover:bg-yellow-300 hover:shadow-[0_0_0_0.125rem_var(--color-yellow-300)]'
              >
                {g.parts.map((part, idx) => renderPiece(part, idx))}
              </span>
            )
          }
          if (g.ghostId != null) {
            // Passive ghost underline: a low-key "worth learning" nudge, no fill and
            // no click handler. data-ghost-id (NOT data-highlight-id) keeps it from
            // blocking the word-selection gesture — the user opts in via normal
            // selection. Underline (not an outline box) so it stands out less than a
            // committed highlight while still being visible.
            return (
              <span
                key={gi}
                data-ghost-id={g.ghostId}
                className='underline decoration-yellow-400 decoration-2 underline-offset-2'
              >
                {g.parts.map((part, idx) => renderPiece(part, idx))}
              </span>
            )
          }
          return <Fragment key={gi}>{g.parts.map((part, idx) => renderPiece(part, idx))}</Fragment>
        })}
      </span>
    </div>
  )
}
