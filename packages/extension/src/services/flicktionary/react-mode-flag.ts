import type { IndexedSubtitleModel } from '@asbplayer-fork/common'
import { isYoutubeWatchPage } from './youtube-context'

export interface ReactSubtitleEligibilityInput {
  subtitles: IndexedSubtitleModel[]
  wordClickEnabled: boolean
  // Bottom/top overlay enablement as computed by SubtitleController from the
  // per-track alignment settings.
  shouldRenderBottomOverlay: boolean
  shouldRenderTopOverlay: boolean
}

// Strict, binding-level latch. The React + Shadow DOM + Tailwind overlay is the
// default for the YouTube bottom/plain-text/word-click happy path; every other
// case (image/rich/dual/top cues, non-YouTube, word-click off) stays fully on
// the legacy DOM path. This predicate is the SOLE gate — evaluated at subtitle
// load and re-evaluated on settings-updated, never per-render — so non-eligible
// cues can never be diverted into the React path.
export const isReactSubtitleEligible = ({
  subtitles,
  wordClickEnabled,
  shouldRenderBottomOverlay,
  shouldRenderTopOverlay,
}: ReactSubtitleEligibilityInput): boolean => {
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
