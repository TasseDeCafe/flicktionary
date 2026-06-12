// Single source of truth for projecting a multi-line highlight onto one line:
//   single line:  [startOffset, endOffset]
//   start line:   [startOffset, lineLength]
//   middle lines: [0, lineLength]
//   end line:     [0, endOffset]
// Both renderers (extension buildLineRanges, web buildSegmentRanges) call this
// so the formulas can't drift between platforms. The clamp asymmetry is
// intentional: the extension clamps to the cue text and drops inverted ranges
// (tolerating legacy offsets that drifted from its renderer's text), while the
// web passes offsets through verbatim.

export type HighlightLineRelation = 'single' | 'start' | 'middle' | 'end'

export interface HighlightLineSlice {
  start: number
  end: number
}

interface ProjectArgs {
  relation: HighlightLineRelation
  startOffset: number
  endOffset: number
  // Unread for an unclamped 'single'/'end' projection — callers without the
  // line text in hand may pass 0 there.
  lineLength: number
}

// Overloads: an unclamped projection always yields a slice; a clamped one may
// drop it (null) when the offsets clamp to an empty/inverted range.
type ProjectHighlightSlice = {
  (args: ProjectArgs & { clamp: false }): HighlightLineSlice
  (args: ProjectArgs & { clamp: true }): HighlightLineSlice | null
}

const project = ({
  relation,
  startOffset,
  endOffset,
  lineLength,
  clamp,
}: ProjectArgs & { clamp: boolean }): HighlightLineSlice | null => {
  const rawStart = relation === 'single' || relation === 'start' ? startOffset : 0
  const rawEnd = relation === 'single' || relation === 'end' ? endOffset : lineLength
  if (!clamp) return { start: rawStart, end: rawEnd }
  const start = Math.max(0, Math.min(rawStart, lineLength))
  const end = Math.max(0, Math.min(rawEnd, lineLength))
  if (end <= start) return null
  return { start, end }
}

export const projectHighlightSlice = project as ProjectHighlightSlice
