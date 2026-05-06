import { rateChunk, type RateChunkDependencies } from './rate-chunk'

export type FinalizePracticeTextDependencies = RateChunkDependencies

export type FinalizePracticeTextResult =
  | { ok: true; implicitGoodCount: number }
  | { ok: false; reason: 'text_not_found' }

// Called when the user advances past a practice_text with the Next button.
// Every annotation that wasn't explicitly rated gets an implicit-good. Then
// mark the text done.
export const finalizePracticeText = async (
  practiceTextId: string,
  userId: string,
  deps: FinalizePracticeTextDependencies
): Promise<FinalizePracticeTextResult> => {
  const found = await deps.practiceTextsRepository.findByIdForUser(practiceTextId, userId)
  if (!found) return { ok: false, reason: 'text_not_found' }

  const annotations = Array.isArray(found.practiceText.annotations)
    ? (found.practiceText.annotations as Array<Record<string, unknown>>)
    : []
  const rated = await deps.practiceRatingsRepository.getRatedHeadwordSensesForText(practiceTextId)
  const ratedKeys = new Set(rated.map((r) => `${r.headword}::${r.sense}`))

  let implicitGoodCount = 0
  for (const ann of annotations) {
    const headword = String(ann.headword ?? '')
    const sense = typeof ann.sense === 'string' ? ann.sense : ''
    if (!headword) continue
    if (ratedKeys.has(`${headword}::${sense}`)) continue
    const result = await rateChunk(practiceTextId, userId, headword, sense, 'good', false, deps)
    if (result.ok) implicitGoodCount += 1
  }

  await deps.practiceTextsRepository.markDone(practiceTextId)

  return { ok: true, implicitGoodCount }
}
