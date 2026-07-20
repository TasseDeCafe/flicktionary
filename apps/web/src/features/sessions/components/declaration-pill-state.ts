// The footer's declaration pill is the single entry point to the merged
// checkpoint + mark-known sheet, so its state must be derived from BOTH
// systems: the mark-known sweep (known_lemmas, needs an available difficulty
// profile) and checkpoint reviews (saved vocabulary, needs only a Kaikki
// language). The two gates are independent — a zero markable-word count says
// nothing about waiting checkpoint credits, and profile-less (pending/failed,
// adhoc/lesson) sessions still checkpoint.

export type DeclarationPillState =
  // Markable read words exist — the pill shows the animated word count.
  | { kind: 'sweep'; count: number }
  // No sweepable words to offer, but a checkpoint press would credit reviews
  // or surface backlog claims — the pill switches to checkpoint mode so the
  // affordance never disappears behind a 0 word count.
  | { kind: 'checkpoint'; pendingCount: number }
  // Every read word is already marked — quiet non-interactive label.
  | { kind: 'allKnown' }
  // Nothing to declare right now — non-interactive placeholder that keeps the
  // footer row's layout stable.
  | { kind: 'dimmed' }
  // Neither system can ever apply to this session.
  | { kind: 'hidden' }

// The pill deliberately does NOT stand down while the welcome-back card is on
// screen: the count is cumulative, so the two surfaces AGREE (both say "N
// unmarked read words") — an ambient meter matching an inline offer reads as
// consistency, whereas a zeroed pill next to the card's real number reads as
// a contradiction.
export const deriveDeclarationPillState = ({
  markKnownSupported,
  hasSweepableSpan,
  sweepPreviewStatus,
  markableLemmaCount,
  sessionMarkedCount,
  checkpointSupported,
  checkpointSpanNonEmpty,
  checkpointPendingCount,
  checkpointBacklogCount,
}: {
  markKnownSupported: boolean
  // Some read span exists to sweep — partial OR read-to-end (the caller feeds
  // the whole-text preview in the latter case, so the pill and the close-out
  // card agree instead of the pill zeroing out at the end).
  hasSweepableSpan: boolean
  // null while the active preview hasn't produced data yet.
  sweepPreviewStatus: 'ready' | 'pending' | 'failed' | 'unsupported' | null
  markableLemmaCount: number
  sessionMarkedCount: number
  checkpointSupported: boolean
  checkpointSpanNonEmpty: boolean
  checkpointPendingCount: number
  checkpointBacklogCount: number
}): DeclarationPillState => {
  const sweepReady = markKnownSupported && hasSweepableSpan && sweepPreviewStatus === 'ready'
  const sweepCount = sweepReady ? markableLemmaCount : 0
  const checkpointAvailable =
    checkpointSupported && checkpointSpanNonEmpty && checkpointPendingCount + checkpointBacklogCount > 0

  if (sweepCount > 0) return { kind: 'sweep', count: sweepCount }
  if (checkpointAvailable) return { kind: 'checkpoint', pendingCount: checkpointPendingCount }
  if (sweepReady && markableLemmaCount === 0 && sessionMarkedCount > 0) {
    return { kind: 'allKnown' }
  }
  if (!markKnownSupported && !checkpointSupported) return { kind: 'hidden' }
  return { kind: 'dimmed' }
}
