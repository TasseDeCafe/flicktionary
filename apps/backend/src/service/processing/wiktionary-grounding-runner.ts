import { logCustomErrorMessageAndError } from '../../transport/error-monitoring/error-monitoring'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { groundChunk } from '../wiktionary-grounding'
import { recordPassTelemetry } from './telemetry'
import { TouchedLookupInfo } from './materialize-basic-data-chunks'

// For each unique user_lookups row touched by this run, look up the matching
// kaikki entry and merge its structured grammar fields into the row's grammar
// JSONB. Already-grounded rows are skipped (idempotent reprocess) UNLESS they
// predate the grounding_patch snapshot column, in which case they re-ground to
// backfill it; per-row failures are swallowed and counted - grounding is
// supplementary, never load-bearing.
export const runWiktionaryGrounding = async (params: {
  sessionId: string
  userId: string
  targetLanguage: string
  touchedLookups: Map<string, TouchedLookupInfo>
  userLookupsRepository: UserLookupsRepositoryInterface
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
  processingTelemetryRepository: ProcessingTelemetryRepositoryInterface
}): Promise<void> => {
  const startedAt = Date.now()
  let attempted = 0
  let grounded = 0
  let alreadyGrounded = 0
  let backfilled = 0
  let userEdited = 0
  let missed = 0
  let failed = 0

  // Run lookups + UPDATEs concurrently. The lookup chain is read-only and the
  // UPDATEs target distinct rows, so postgres.js's connection pool can
  // pipeline them without contention. The `alreadyGrounded` flag is taken
  // from the in-memory lookup we already had in the chunk loop, so no extra
  // SELECT is needed.
  await Promise.all(
    Array.from(params.touchedLookups.entries()).map(async ([lookupId, info]) => {
      // userEdited must short-circuit BEFORE the backfill branch below — a
      // user-edited grounded row must never have its grammar re-overwritten
      // by kaikki on reprocess.
      if (info.grammarUserEdited) {
        userEdited++
        return
      }
      // Rows grounded before the grounding_patch column existed fall through
      // and re-ground: same kaikki values re-applied (idempotent), but the
      // patch snapshot gets captured so per-field provenance works.
      if (info.alreadyGrounded && info.hasGroundingPatch) {
        alreadyGrounded++
        return
      }
      attempted++
      try {
        const result = await groundChunk({
          targetLanguage: params.targetLanguage,
          headword: info.headword,
          pos: info.llmPos,
          wiktionaryEntriesRepository: params.wiktionaryEntriesRepository,
        })
        if (!result) {
          missed++
          return
        }
        // TODO: This could be parallelized with a batch update.
        await params.userLookupsRepository.applyGroundingPatch({ id: lookupId, grammarPatch: result.patch })
        grounded++
        if (info.alreadyGrounded) backfilled++
      } catch (e) {
        failed++
        logCustomErrorMessageAndError(
          `wiktionary grounding failed for headword=${info.headword}, sessionId=${params.sessionId}`,
          e
        )
      }
    })
  )

  await recordPassTelemetry(params.processingTelemetryRepository, {
    studySessionId: params.sessionId,
    passName: 'wiktionary_grounding',
    durationMs: Date.now() - startedAt,
    payload: {
      targetLanguage: params.targetLanguage,
      uniqueLookups: params.touchedLookups.size,
      attempted,
      grounded,
      alreadyGrounded,
      backfilled,
      userEdited,
      missed,
      failed,
    },
  })
}
