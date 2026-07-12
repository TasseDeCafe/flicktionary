// Pure piece-builder behind SelectableSentence: turns a sentence + word ranges
// into renderable pieces following the use-word-selection span contract (word
// pieces carry offsets; plain pieces are unselectable filler). Kept free of
// React/DOM so the blank/blocked semantics are unit-testable.

export type SentenceRange = { start: number; end: number }

export type SentencePiece =
  // Selectable word: rendered with data-word-start/end offsets.
  | { kind: 'word'; text: string; start: number; end: number }
  // Unselectable text (whitespace, punctuation, or a blocked word). Offsets
  // kept for range-based styling (e.g. the term underline).
  | { kind: 'plain'; text: string; start: number; end: number }
  // The cloze gap. The source text inside the blank range is the hidden
  // answer — it is dropped entirely, never rendered.
  | { kind: 'blank' }

const intersects = (start: number, end: number, range: SentenceRange) => start < range.end && range.start < end

export const buildSentencePieces = (args: {
  text: string
  wordRanges: ReadonlyArray<readonly [number, number]>
  // Cloze gap: text[start..end) renders as one ______ piece.
  blank?: SentenceRange | null
  // Words intersecting any of these render as plain (unselectable) pieces.
  blockedRanges?: SentenceRange[]
}): SentencePiece[] => {
  const { text, wordRanges } = args
  const blank = args.blank ?? null
  const blockedRanges = args.blockedRanges ?? []
  const pieces: SentencePiece[] = []
  let blankEmitted = false

  const pushPlain = (from: number, to: number) => {
    if (to > from) pieces.push({ kind: 'plain', text: text.slice(from, to), start: from, end: to })
  }

  // Emit an unselectable run, dropping any part inside the blank (replaced by
  // the single blank piece the first time the run crosses it).
  const pushNonWord = (from: number, to: number) => {
    if (blank && intersects(from, to, blank)) {
      pushPlain(from, Math.min(to, blank.start))
      if (!blankEmitted) {
        pieces.push({ kind: 'blank' })
        blankEmitted = true
      }
      pushPlain(Math.max(from, blank.end), to)
      return
    }
    pushPlain(from, to)
  }

  let cur = 0
  for (const [start, end] of wordRanges) {
    if (end <= start) continue
    if (start > cur) pushNonWord(cur, start)
    const unselectable =
      (blank !== null && intersects(start, end, blank)) || blockedRanges.some((r) => intersects(start, end, r))
    if (unselectable) {
      pushNonWord(start, end)
    } else {
      pieces.push({ kind: 'word', text: text.slice(start, end), start, end })
    }
    cur = Math.max(cur, end)
  }
  if (cur < text.length) pushNonWord(cur, text.length)

  return pieces
}

// [start, end) overlap — a selection merely touching a range boundary is fine.
export const selectionOverlapsRanges = (
  selection: { charStart: number; charEnd: number },
  ranges: SentenceRange[]
): boolean => ranges.some((r) => selection.charStart < r.end && r.start < selection.charEnd)
