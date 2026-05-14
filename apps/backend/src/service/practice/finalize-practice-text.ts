import { rateChunk, type RateChunkDependencies, withPracticeTextMutationLock } from './rate-chunk'

export type FinalizePracticeTextDependencies = RateChunkDependencies

export type FinalizePracticeTextResult =
  | { ok: true; implicitGoodCount: number; alreadyFinalized: boolean }
  | { ok: false; reason: 'text_not_found' }

// Called when the user advances past a practice_text with the Next button.
// Atomic finalize gate (CC-C): claimFinalize flips status from 'ready'/'reading'
// to 'done' and returns the post-update row only for the caller that won. A
// second concurrent call gets null back and short-circuits, so the
// implicit-rating insert never double-applies FSRS.
export const finalizePracticeText = async (
  practiceTextId: string,
  userId: string,
  deps: FinalizePracticeTextDependencies
): Promise<FinalizePracticeTextResult> => {
  return await withPracticeTextMutationLock(practiceTextId, () =>
    finalizePracticeTextUnlocked(practiceTextId, userId, deps)
  )
}

const finalizePracticeTextUnlocked = async (
  practiceTextId: string,
  userId: string,
  deps: FinalizePracticeTextDependencies
): Promise<FinalizePracticeTextResult> => {
  const found = await deps.practiceTextsRepository.findByIdForUser(practiceTextId, userId)
  if (!found) return { ok: false, reason: 'text_not_found' }

  const claimed = await deps.practiceTextsRepository.claimFinalize(practiceTextId)
  if (!claimed) {
    // Another caller already finalized this text. Don't reapply FSRS.
    return { ok: true, implicitGoodCount: 0, alreadyFinalized: true }
  }

  const annotations = Array.isArray(claimed.annotations) ? (claimed.annotations as Array<Record<string, unknown>>) : []
  const rated = await deps.practiceRatingsRepository.getRatedHeadwordSensesForText(practiceTextId)
  const ratedKeys = new Set(rated.map((r) => `${r.headword}::${r.sense}`))

  let implicitGoodCount = 0
  for (const ann of annotations) {
    const headword = String(ann.headword ?? '')
    const sense = typeof ann.sense === 'string' ? ann.sense : ''
    const key = `${headword}::${sense}`
    if (!headword) continue
    if (ratedKeys.has(key)) continue
    // Bypass status guard since we already own the finalize transition; the
    // text is now 'done' but implicit ratings still need to land.
    const result = await rateChunk(practiceTextId, userId, headword, sense, 'good', false, deps, {
      bypassStatusGuard: true,
    })
    if (result.ok) {
      ratedKeys.add(key)
      implicitGoodCount += 1
    }
  }

  return { ok: true, implicitGoodCount, alreadyFinalized: false }
}
