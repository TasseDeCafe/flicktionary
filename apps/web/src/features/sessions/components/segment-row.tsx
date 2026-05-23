import { useMemo } from 'react'
import { stripSrtMarkupWithMap } from '@flicktionary/core/utils/srt-markup'
import { getWordRanges } from '@/lib/dom/word-segmenter'

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
  targetLanguage: string
  flash?: boolean
}

// A rendered run of text, tagged with both the highlight it belongs to (if any)
// and the enclosing word's offsets (if any). A run carries `word` when it is
// part of a word-like segment, so a tap anywhere in it selects the whole word —
// even when a highlight boundary splits one word into two adjacent runs that
// share the same `word`.
export type WordHighlightSpan = {
  text: string
  highlightId: string | null
  // [start, end) of the enclosing word in display-text coords, or null for
  // whitespace / punctuation (which is not selectable).
  word: [number, number] | null
}

// Splits `displayText` at the union of highlight boundaries and word
// boundaries, so each produced run lies entirely within at most one highlight
// and at most one word. Consecutive characters that share the same
// (highlightId, word) collapse into a single run. Overlapping highlights
// collapse to the last id (last write wins), matching the previous behavior.
export const buildWordHighlightSpans = (
  displayText: string,
  ranges: SegmentHighlightRange[],
  wordRanges: ReadonlyArray<readonly [number, number]>
): WordHighlightSpan[] => {
  const len = displayText.length
  if (len === 0) return []

  const marks: (string | null)[] = new Array(len).fill(null)
  for (const r of ranges) {
    const s = Math.max(0, Math.min(len, r.start))
    const e = Math.max(0, Math.min(len, r.end))
    for (let i = s; i < e; i++) marks[i] = r.highlightId
  }

  // Per-character word index (-1 = not part of a word). Segmenter ranges are
  // disjoint, so a character belongs to at most one word.
  const wordIdx: number[] = new Array(len).fill(-1)
  wordRanges.forEach(([s, e], idx) => {
    const lo = Math.max(0, Math.min(len, s))
    const hi = Math.max(0, Math.min(len, e))
    for (let i = lo; i < hi; i++) wordIdx[i] = idx
  })

  const spans: WordHighlightSpan[] = []
  let i = 0
  while (i < len) {
    const curMark = marks[i]
    const curWord = wordIdx[i]
    let j = i + 1
    while (j < len && marks[j] === curMark && wordIdx[j] === curWord) j++
    spans.push({
      text: displayText.slice(i, j),
      highlightId: curMark,
      word: curWord >= 0 ? [wordRanges[curWord]![0], wordRanges[curWord]![1]] : null,
    })
    i = j
  }
  return spans
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

  const spans = useMemo(() => {
    const wordRanges = getWordRanges(displayText, targetLanguage)
    return buildWordHighlightSpans(displayText, displayRanges, wordRanges)
  }, [displayText, displayRanges, targetLanguage])

  return (
    <div className={'flex items-start gap-3 py-1 transition-colors duration-700' + (flash ? ' bg-yellow-100' : '')}>
      {ts && (
        <span className='text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums select-none'>{ts}</span>
      )}
      <span data-segment-id={id} data-word-owner={id} className='flex-1 text-lg md:text-base'>
        {spans.map((part, idx) => {
          // Word offsets are written without horizontal padding so
          // elementFromPoint hit-tests against exact glyph bounds.
          const wordAttrs =
            part.word != null ? { 'data-word-start': part.word[0], 'data-word-end': part.word[1] } : undefined
          if (part.highlightId) {
            return (
              <span
                key={idx}
                data-highlight-id={part.highlightId}
                {...wordAttrs}
                className='cursor-pointer rounded bg-yellow-200 px-0.5 hover:bg-yellow-300'
              >
                {part.text}
              </span>
            )
          }
          if (part.word != null) {
            return (
              <span key={idx} {...wordAttrs} className='cursor-pointer'>
                {part.text}
              </span>
            )
          }
          return <span key={idx}>{part.text}</span>
        })}
      </span>
    </div>
  )
}
