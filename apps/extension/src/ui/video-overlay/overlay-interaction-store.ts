import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

// Active drag/click selection within a single line, by word ordinal.
export interface SelectionState {
  lineIndex: number
  anchorOrdinal: number
  headOrdinal: number
}

// The overlay's pointer-interaction state, replacing the old quartet of refs
// (`selectionRef`/`selectingRef`/`hoveredRef`/`signedInRef`) and their
// dual-write helpers: the imperative handlers (debounce timers, window
// mouseup, save handlers) read `store.getState()` — always live, no stale
// closures — while rendering subscribes via selectors to `selection` and
// `signedIn` ONLY (`hovered`/`selecting` are getState-only, so pointer churn
// costs no re-renders).
//
// Generic over the hovered-word shape, which belongs to the component's
// tokenization model. Created per OverlayBody mount — one per video overlay.
export interface OverlayInteractionState<H> {
  selection: SelectionState | null
  // Whether a drag-selection is in progress (mousedown on a word, not yet
  // released).
  selecting: boolean
  // The word currently under the pointer (null when over nothing). Used so the
  // window `mouseup` handler can open the chunk gloss on the word the pointer
  // already sits on — `mouseenter` won't re-fire there after a drag-release.
  hovered: H | null
  // Whether the user is paired ("signed in") with Flicktionary. Defaults true
  // to avoid flashing a Sign in button before the (fast, local) read resolves.
  signedIn: boolean

  setSelection: (selection: SelectionState | null) => void
  setSelecting: (selecting: boolean) => void
  setHovered: (hovered: H | null) => void
  setSignedIn: (signedIn: boolean) => void
  clearSelection: () => void
}

export type OverlayInteractionStore<H> = StoreApi<OverlayInteractionState<H>>

export function createOverlayInteractionStore<H>(): OverlayInteractionStore<H> {
  return createStore<OverlayInteractionState<H>>((set) => ({
    selection: null,
    selecting: false,
    hovered: null,
    signedIn: true,

    setSelection: (selection) => set({ selection }),
    setSelecting: (selecting) => set({ selecting }),
    setHovered: (hovered) => set({ hovered }),
    setSignedIn: (signedIn) => set({ signedIn }),
    clearSelection: () => set({ selecting: false, selection: null }),
  }))
}
