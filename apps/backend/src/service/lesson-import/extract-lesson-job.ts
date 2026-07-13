import { beginTx } from '../../transport/database/postgres-client'
import type { InsertBatchRowInput } from '../../transport/database/import-batches/import-batches-repository'
import type { HeadwordMatch } from '../../transport/database/user-lookups/user-lookups-repository'
import type { ExtractedLessonRow } from '../../transport/third-party/anthropic/passes/extract-lesson-pass'
import { MODEL_ENRICHMENT } from '../../transport/third-party/anthropic/anthropic-client'
import type { ProcessingDependencies } from '../processing/processing-dependencies'
import { splitLessonSections } from './split-lesson-sections'

// Pick the vocabulary row an extracted headword deduplicates onto: the
// sense-less row first (the canonical key for gloss saves), else the first
// match. Only kept terms (count > 0) participate — a count = 0 row is a
// pre-keep artifact, not vocabulary, so the import treats it as new (the
// enrich job's findOrCreate will reuse the same row anyway).
const pickDuplicate = (matches: HeadwordMatch[] | undefined): HeadwordMatch | null => {
  const kept = (matches ?? []).filter((m) => m.count > 0)
  return kept.find((m) => m.sense === '') ?? kept[0] ?? null
}

export const planActionForRow = (
  row: ExtractedLessonRow,
  duplicate: HeadwordMatch | null
): 'create' | 'add_facet' | 'lapse_and_add_facet' | 'skip' => {
  if (row.type === 'win' || row.type === 'noise') return 'skip'
  if (row.headword.trim() === '') return 'skip'
  if (!duplicate) return 'create'
  // A lesson error on a term whose production facet sits in steady-state
  // review IS a lapse signal — the implicit 'again' at confirm reschedules it.
  // Learning/relearning/warm-up terms are already being drilled; parked leeches
  // are applyTermRating no-ops — both still get the facet add only. The lapse
  // marker survives here even for parked terms so the confirm screen can show
  // provenance; the rating apply re-checks the live state.
  if (duplicate.productionEnabled && duplicate.productionSrsState === 'review' && !duplicate.productionParked) {
    return 'lapse_and_add_facet'
  }
  return 'add_facet'
}

// Worker handler for one extract_lesson job: run the extraction pass per
// lesson section, resolve duplicates against the user's vocabulary, compute
// per-row planned actions, and flip the batch to 'ready' atomically with the
// row swap (replaceRows makes a retried job idempotent). LLM failures throw —
// the worker retries with backoff, and the terminal-failure hook marks the
// batch 'failed' so the client's poll terminates.
export const extractLessonJob = async (
  params: { jobId: string; importBatchId: string; userId: string },
  deps: ProcessingDependencies
): Promise<void> => {
  const { importBatchId, userId } = params
  const batch = await deps.importBatchesRepository.findById(importBatchId)
  // Deleted (expired-draft sweep) or already past extraction — nothing to do.
  if (!batch || batch.status !== 'extracting') return

  const profile = batch.teacher_profile_id
    ? await deps.teacherProfilesRepository.findByIdForUser(batch.teacher_profile_id, userId)
    : null

  const sections = splitLessonSections(batch.raw_text)
  const extractedRows: Array<{ row: ExtractedLessonRow; lessonDate: string | null }> = []
  let formatProfile: string | null = null
  for (const section of sections) {
    const lesson = await deps.anthropicPasses.extractLessonPass({
      targetLanguage: batch.target_language,
      sectionMarkdown: section,
      teacherProfile: profile?.profile_text ?? null,
      model: MODEL_ENRICHMENT,
    })
    formatProfile = formatProfile ?? lesson.formatProfile
    for (const row of lesson.rows) {
      extractedRows.push({ row, lessonDate: lesson.lessonDate })
    }
  }

  const headwords = [
    ...new Set(
      extractedRows
        .filter(({ row }) => row.type !== 'win' && row.type !== 'noise' && row.headword.trim() !== '')
        .map(({ row }) => row.headword)
    ),
  ]
  const matches = await deps.userLookupsRepository.listByHeadwords({
    userId,
    targetLanguage: batch.target_language,
    headwords,
  })

  const rows: InsertBatchRowInput[] = extractedRows.map(({ row, lessonDate }, index) => {
    const duplicate = pickDuplicate(matches.get(row.headword.toLowerCase()))
    return {
      batchId: batch.id,
      rowIndex: index,
      payload: row as unknown as Record<string, unknown>,
      lessonDate,
      duplicateUserLookupId: duplicate?.id ?? null,
      duplicateFacets: duplicate
        ? {
            headword: duplicate.headword,
            sense: duplicate.sense,
            productionSrsState: duplicate.productionSrsState,
            productionEnabled: duplicate.productionEnabled,
            productionParked: duplicate.productionParked,
            enabledSkills: duplicate.enabledSkills,
          }
        : null,
      plannedAction: planActionForRow(row, duplicate),
    }
  })

  await beginTx(async (tx) => {
    await deps.importBatchesRepository.replaceRows({ batchId: batch.id, rows }, tx)
    await deps.importBatchesRepository.markReady({ batchId: batch.id, formatProfile }, tx)
  })
}
