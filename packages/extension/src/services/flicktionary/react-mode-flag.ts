import type { IndexedSubtitleModel } from '@asbplayer-fork/common'

export interface ReactSubtitleEligibilityInput {
  subtitles: IndexedSubtitleModel[]
  wordClickEnabled: boolean
  // Bottom-overlay enablement as computed by SubtitleController from the
  // per-track alignment settings. (Top-overlay/dual handling is decided by the
  // controller's per-alignment mounts, not gated here.)
  shouldRenderBottomOverlay: boolean
}

// Strict, binding-level latch. The React + Shadow DOM + Tailwind overlay is the
// default for the text/word-click happy path on ANY site, including dual
// subtitles and multiple tracks; only image (PGS) / rich-text cues and the
// word-click-off case stay on the legacy DOM path. This predicate is the SOLE
// gate — evaluated at subtitle load and re-evaluated on settings-updated, never
// per-render — so non-eligible cues can never be diverted into the React path.
//
// Note: this gates RENDERING + hover gloss, which are site-agnostic. Word
// *saving* is still YouTube-only (the register/save backend contract is
// YouTube-shaped); off YouTube the overlay surfaces a "saving coming soon"
// disabled reason rather than failing silently — see Binding.
export const isReactSubtitleEligible = ({
  subtitles,
  wordClickEnabled,
  shouldRenderBottomOverlay,
}: ReactSubtitleEligibilityInput): boolean => {
  // Word-click is the whole interaction surface.
  if (!wordClickEnabled) return false

  // A bottom overlay must be enabled (top-only is left to legacy). Dual
  // top+bottom is fine — the controller mounts a host per active overlay.
  if (!shouldRenderBottomOverlay) return false

  // Something must be loaded to evaluate cue types against.
  if (!subtitles || subtitles.length === 0) return false

  // Every loaded cue must be plain text — no image (PGS) or rich-text cue.
  for (const subtitle of subtitles) {
    if (subtitle.textImage) return false
    if (subtitle.richText) return false
  }

  return true
}
