import { selectionOverlapsRanges, type SentenceRange } from './sentence-pieces'

// One selectable text region inside a GlossableArea, addressed by its
// data-word-owner key. sourceText and contextText are deliberately separate:
// the emitted offsets index sourceText (an option label, say), while the gloss
// prompt and the adhoc save want the richer contextText (the stem sentence).
export type GlossOwner = {
  sourceText: string
  contextText: string
  // Selections overlapping any of these are rejected outright. The cloze blank
  // must ALWAYS be here: the served sentence physically contains the hidden
  // answer at that span, so a drag sweeping across it would surface the answer
  // in the sheet title.
  rejectedRanges: SentenceRange[]
}

type SelectionEndpoint = { ownerKey: string; wordStart: number; wordEnd: number }

export type ResolvedGlossSelection = {
  text: string
  charStart: number
  charEnd: number
  contextText: string
}

// Maps a word-selection gesture to a gloss request, or null when the gesture
// must be rejected (caller clears the selection paint). Handles reverse drags
// (anchor after end) by normalizing the endpoints.
export const resolveGlossSelection = (args: {
  anchor: SelectionEndpoint
  end: SelectionEndpoint
  owners: Record<string, GlossOwner>
}): ResolvedGlossSelection | null => {
  const { anchor, end, owners } = args
  if (anchor.ownerKey !== end.ownerKey) return null
  const owner = owners[anchor.ownerKey]
  if (!owner) return null
  const charStart = Math.min(anchor.wordStart, end.wordStart)
  const charEnd = Math.max(anchor.wordEnd, end.wordEnd)
  if (charEnd <= charStart) return null
  if (selectionOverlapsRanges({ charStart, charEnd }, owner.rejectedRanges)) return null
  const text = owner.sourceText.slice(charStart, charEnd)
  if (text.trim().length === 0) return null
  return { text, charStart, charEnd, contextText: owner.contextText }
}
