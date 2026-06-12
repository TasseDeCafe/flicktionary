import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { SavedHighlightDto } from '@asbplayer-fork/common'

// The overlay's saved-highlight state, one store per OverlayBody mount
// (pattern: overlay-interaction-store). Rendering subscribes to `highlights`
// to repaint saved spans; the imperative handlers (save/delete/note) mutate
// through the setters so optimistic updates land without a reload.
export interface SavedHighlightsState {
  // Session id the highlights belong to — needed by the saved-mode popover's
  // delete/note/gloss calls. Null while unloaded or signed out / no session.
  sessionId: string | null
  highlights: SavedHighlightDto[]
  // True once a load attempt settled (success OR signed-out/no-session empty).
  // Gates re-load scheduling, not rendering (an empty list paints nothing).
  loaded: boolean

  setAll: (sessionId: string | null, highlights: ReadonlyArray<SavedHighlightDto>) => void
  // `sessionId` (when known) backfills a store that loaded before the video's
  // first save created the session — required for the saved-mode popover to
  // open on the just-saved span.
  add: (highlight: SavedHighlightDto, sessionId?: string) => void
  remove: (highlightId: string) => void
  patchNote: (highlightId: string, note: string | null, presetTags: string[]) => void
  reset: () => void
}

export type SavedHighlightsStore = StoreApi<SavedHighlightsState>

export function createSavedHighlightsStore(): SavedHighlightsStore {
  return createStore<SavedHighlightsState>((set) => ({
    sessionId: null,
    highlights: [],
    loaded: false,

    setAll: (sessionId, highlights) => set({ sessionId, highlights: [...highlights], loaded: true }),
    add: (highlight, sessionId) =>
      set((state) => ({
        sessionId: sessionId ?? state.sessionId,
        // Replace-by-id keeps a re-save (or an optimistic add racing a reload)
        // from painting the same span twice.
        highlights: [...state.highlights.filter((h) => h.id !== highlight.id), highlight],
      })),
    remove: (highlightId) => set((state) => ({ highlights: state.highlights.filter((h) => h.id !== highlightId) })),
    patchNote: (highlightId, note, presetTags) =>
      set((state) => ({
        highlights: state.highlights.map((h) => (h.id === highlightId ? { ...h, note, presetTags } : h)),
      })),
    reset: () => set({ sessionId: null, highlights: [], loaded: false }),
  }))
}

// One painted range on a subtitle line, in the line's char coordinates.
export interface SavedLineRange {
  highlightId: string
  start: number
  end: number
}

// Per-line projection of saved highlights — the index-coordinate twin of the
// web reader's buildSegmentRanges. A highlight spanning multiple cues paints:
//   start cue:   [startOffset, lineLen]
//   middle cues: [0, lineLen]
//   end cue:     [0, endOffset]
// Single-cue highlights collapse to [startOffset, endOffset]. Offsets are
// clamped to the cue's length so a web-created highlight whose offsets drift
// from this renderer's text (tokenizer/normalization differences) still paints
// instead of producing inverted/out-of-range spans.
export const buildLineRanges = (
  highlights: ReadonlyArray<SavedHighlightDto>,
  lineIndex: number,
  lineLen: number
): SavedLineRange[] => {
  const out: SavedLineRange[] = []
  for (const h of highlights) {
    if (lineIndex < h.startSegmentIndex || lineIndex > h.endSegmentIndex) continue
    const rawStart = lineIndex === h.startSegmentIndex ? h.startOffset : 0
    const rawEnd = lineIndex === h.endSegmentIndex ? h.endOffset : lineLen
    const start = Math.max(0, Math.min(rawStart, lineLen))
    const end = Math.max(0, Math.min(rawEnd, lineLen))
    if (end <= start) continue
    out.push({ highlightId: h.id, start, end })
  }
  return out
}
