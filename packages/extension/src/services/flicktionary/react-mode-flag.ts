import type { IndexedSubtitleModel } from '@asbplayer-fork/common'
import { isYoutubeWatchPage } from './youtube-context'

// Build-time flag for the React + Shadow DOM + Tailwind video-overlay PoC
// (Option A). A module-level `const`, deliberately NOT an `AsbplayerSettings`
// field: persisting it would trip the export/import unknown-key validation
// trap (validateSettings throws on keys it doesn't know). Mirrors
// services/build-flags.ts.
//
// Default OFF — flip to true only for local YouTube testing. When false, the
// host is never mounted and every video stays fully on the legacy DOM path.
export const REACT_SUBTITLE_OVERLAY_ENABLED = true

export interface ReactSubtitleEligibilityInput {
  subtitles: IndexedSubtitleModel[]
  wordClickEnabled: boolean
  // Bottom/top overlay enablement as computed by SubtitleController from the
  // per-track alignment settings.
  shouldRenderBottomOverlay: boolean
  shouldRenderTopOverlay: boolean
}

// Strict, binding-level latch (plan #6). React mode is eligible ONLY when ALL
// hold; otherwise the video stays fully legacy. Evaluated at subtitle load and
// re-evaluated on settings-updated — never per-render — so image/rich/dual/top
// cues can never be diverted into the React path.
export const isReactSubtitleEligible = ({
  subtitles,
  wordClickEnabled,
  shouldRenderBottomOverlay,
  shouldRenderTopOverlay,
}: ReactSubtitleEligibilityInput): boolean => {
  if (!REACT_SUBTITLE_OVERLAY_ENABLED) return false

  // YouTube watch page only.
  if (!isYoutubeWatchPage()) return false

  // Word-click is the PoC's whole interaction surface.
  if (!wordClickEnabled) return false

  // Bottom overlay enabled AND top overlay disabled (no dual-subtitle).
  if (!shouldRenderBottomOverlay || shouldRenderTopOverlay) return false

  // Something must be loaded to evaluate cue types against.
  if (!subtitles || subtitles.length === 0) return false

  // A single bottom track.
  const tracks = new Set(subtitles.map((s) => s.track ?? 0))
  if (tracks.size > 1) return false

  // Every loaded cue must be plain text — no image (PGS) or rich-text cue.
  for (const subtitle of subtitles) {
    if (subtitle.textImage) return false
    if (subtitle.richText) return false
  }

  return true
}
