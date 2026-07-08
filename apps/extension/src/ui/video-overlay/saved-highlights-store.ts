import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { SavedHighlightDto } from '@asbplayer-fork/common'
import { projectHighlightSlice } from '@flicktionary/core/utils/project-highlight-slice'

// The overlay's saved-highlight state, one store per OverlayBody mount
// (pattern: overlay-interaction-store). Rendering subscribes to `highlights`
// to repaint saved spans; the imperative handlers (save/delete/note) mutate
// through the setters so optimistic updates land without a reload.
export interface SavedHighlightsState {
  // Session id the highlights belong to — needed by the saved-mode popover's
  // delete/note/gloss calls. Null while unloaded or signed out / no session.
  sessionId: string | null
  // The session's server-detected subtitle language — the overlay's tokenizer
  // locale. Null while unknown (unloaded / signed out / no session yet).
  targetLanguage: string | null
  highlights: SavedHighlightDto[]
  // True once a load attempt settled (success OR signed-out/no-session empty).
  // Gates re-load scheduling, not rendering (an empty list paints nothing).
  loaded: boolean

  setAll: (sessionId: string | null, highlights: ReadonlyArray<SavedHighlightDto>, targetLanguage?: string) => void
  // `sessionId`/`targetLanguage` (when known) backfill a store that loaded
  // before the video's first save created the session — required for the
  // saved-mode popover to open on the just-saved span (and for the tokenizer
  // locale to land without a reload).
  add: (highlight: SavedHighlightDto, sessionId?: string, targetLanguage?: string) => void
  remove: (highlightId: string) => void
  patchNote: (highlightId: string, note: string | null, presetTags: string[]) => void
  // A note-only stub was upgraded into a full study card (highlights.saveWord):
  // flip noteOnly off and record the intent so the open popover morphs into the
  // normal saved state without a reload.
  patchWordSaved: (highlightId: string, studyIntent: SavedHighlightDto['studyIntent']) => void
  reset: () => void
}

export type SavedHighlightsStore = StoreApi<SavedHighlightsState>

export function createSavedHighlightsStore(): SavedHighlightsStore {
  return createStore<SavedHighlightsState>((set) => ({
    sessionId: null,
    targetLanguage: null,
    highlights: [],
    loaded: false,

    setAll: (sessionId, highlights, targetLanguage) =>
      set({ sessionId, targetLanguage: targetLanguage ?? null, highlights: [...highlights], loaded: true }),
    add: (highlight, sessionId, targetLanguage) =>
      set((state) => ({
        sessionId: sessionId ?? state.sessionId,
        targetLanguage: targetLanguage ?? state.targetLanguage,
        // Replace-by-id keeps a re-save (or an optimistic add racing a reload)
        // from painting the same span twice.
        highlights: [...state.highlights.filter((h) => h.id !== highlight.id), highlight],
      })),
    remove: (highlightId) => set((state) => ({ highlights: state.highlights.filter((h) => h.id !== highlightId) })),
    patchNote: (highlightId, note, presetTags) =>
      set((state) => ({
        highlights: state.highlights.map((h) => (h.id === highlightId ? { ...h, note, presetTags } : h)),
      })),
    patchWordSaved: (highlightId, studyIntent) =>
      set((state) => ({
        highlights: state.highlights.map((h) => (h.id === highlightId ? { ...h, noteOnly: false, studyIntent } : h)),
      })),
    reset: () => set({ sessionId: null, targetLanguage: null, highlights: [], loaded: false }),
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
    const isStart = lineIndex === h.startSegmentIndex
    const isEnd = lineIndex === h.endSegmentIndex
    const relation = isStart && isEnd ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'middle'
    const slice = projectHighlightSlice({
      relation,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      lineLength: lineLen,
      clamp: true,
    })
    if (slice) out.push({ highlightId: h.id, ...slice })
  }
  return out
}
