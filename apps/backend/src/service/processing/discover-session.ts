import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { generateContextBlob } from '../../transport/third-party/anthropic/passes/generate-context-blob'
import { basicDataPass, BasicDataChunk } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import {
  CandidateForDisambiguation,
  DisambiguationResult,
  senseDisambiguationPass,
} from '../../transport/third-party/anthropic/passes/sense-disambiguation-pass'
import { resolveRegconfig } from '../../transport/database/text-segments/text-segments-repository'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { recordPassTelemetry } from './telemetry'
import { materializeBasicDataChunks } from './materialize-basic-data-chunks'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { getLanguageMode } from '../user-prefs/language-mode'

export type ProcessingDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  processingTelemetryRepository: ProcessingTelemetryRepositoryInterface
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}

const CONTEXT_BLOB_SAMPLE_SIZE = 150

// Discovery-only background job: scan the whole text once and surface ~20-40
// LLM-suggested terms at/above the learner's CEFR level. The complementary job
// — enriching each user highlight into a card — is handled per-highlight by
// enrichHighlight, never here. This function therefore ALWAYS passes
// `highlights: []` and drops any stray source='highlight' rows the model emits,
// so it can never produce a duplicate highlight card alongside the worker.
//
// It does NOT mutate study_sessions.status: enrichment/discovery state lives in
// processing_jobs now, not on the session. Genuine failures throw so the worker
// can record them on the job and retry; soft sub-pass failures are recorded as
// processing warnings on the session, as before.
export const discoverSession = async (
  sessionId: string,
  userId: string,
  deps: ProcessingDependencies
): Promise<void> => {
  const {
    contentSourcesRepository,
    textTracksRepository,
    textSegmentsRepository,
    studySessionsRepository,
    cardsRepository,
    userLookupsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    processingTelemetryRepository,
    wiktionaryEntriesRepository,
  } = deps

  const session = await studySessionsRepository.findByIdForUser(sessionId, userId)
  if (!session) {
    logWithSentry({ message: 'discoverSession: session not found', params: { sessionId, userId } })
    return
  }

  // Preserve the LLM-suggestions gate: if the user has discovery turned off,
  // this job is a no-op. (The enqueue path also guards this, this is defence.)
  const llmHighlightsEnabled = await usersRepository.getLlmHighlightsEnabled(userId)
  if (!llmHighlightsEnabled) return

  const [contentSource, track, segments, existingCards] = await Promise.all([
    contentSourcesRepository.findById(session.content_source_id),
    textTracksRepository.findById(session.text_track_id),
    textSegmentsRepository.listByTrackId(session.text_track_id),
    cardsRepository.listBySessionId(sessionId),
  ])

  if (!contentSource || !track || segments.length === 0) {
    logWithSentry({
      message: 'discoverSession: missing prerequisites',
      params: { sessionId, hasContentSource: !!contentSource, hasTrack: !!track, segmentCount: segments.length },
    })
    return
  }

  // Idempotent: discovery already ran for this session (LLM-suggested cards have
  // a NULL highlight_id). Nothing to do.
  const hasLlmSuggestedCards = existingCards.some((c) => c.highlight_id === null)
  if (hasLlmSuggestedCards) return

  // 1. Source context blob — generate if missing (shared cache with enrichHighlight).
  let contextBlob = session.context_blob
  if (!contextBlob) {
    const sample = segments
      .slice(0, CONTEXT_BLOB_SAMPLE_SIZE)
      .map((s) => s.text)
      .join('\n')
    contextBlob = await generateContextBlob({
      contentTitle: contentSource.title,
      contentLanguage: contentSource.language,
      contentType: contentSource.type,
      segmentSample: sample,
    })
    await studySessionsRepository.updateContextBlob(sessionId, userId, contextBlob)
  }

  const languagePrefs = await getLanguageMode({
    userId,
    targetLanguage: session.target_language,
    snapshotNativeLanguage: session.native_language,
    usersRepository,
    targetLanguagePrefsRepository: userTargetLanguagePrefsRepository,
  })
  const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language

  // Source-relevant pre-filter: only feed the LLM exclusions whose headword
  // plausibly appears in this session's source. Bounded by source size (a few
  // hundred typical), not user vocab size. Telemetry captures the prune ratio.
  const prefilterStartedAt = Date.now()
  const { headwordSenses: excludedHeadwordSenses, totalVocabSize } =
    await userLookupsRepository.listHeadwordSensesRelevantToTrack({
      userId,
      targetLanguage: session.target_language,
      textTrackId: session.text_track_id,
    })
  await recordPassTelemetry(processingTelemetryRepository, {
    studySessionId: sessionId,
    passName: 'exclusion_prefilter',
    durationMs: Date.now() - prefilterStartedAt,
    payload: {
      totalVocabSize,
      filteredSize: excludedHeadwordSenses.length,
      regconfig: resolveRegconfig(session.target_language),
      headwordSampleKept: excludedHeadwordSenses.slice(0, 20).map((e) => e.headword),
    },
  })

  const segmentInputs = segments.map((s) => ({ id: s.id, index: s.index, text: s.text }))
  const segmentIdSet = new Set(segments.map((s) => s.id))

  let chunks: BasicDataChunk[] = []
  try {
    chunks = await basicDataPass({
      nativeLanguage: languageModeNativeLanguage,
      targetLanguage: session.target_language,
      cefrLevel: session.cefr_level,
      movieContextBlob: contextBlob,
      segments: segmentInputs,
      highlights: [],
      excludedHeadwordSenses,
      llmDiscoveryEnabled: true,
      hideTranslationFields: languagePrefs.hideTranslationFields,
      allowL1Notes: languagePrefs.allowL1Notes,
    })
  } catch (e) {
    logCustomErrorMessageAndError(`basicDataPass (discovery) failed, sessionId = ${sessionId}`, e)
    await studySessionsRepository.appendProcessingWarning(
      sessionId,
      userId,
      `Discovery pass failed: ${e instanceof Error ? e.message : String(e)}`
    )
    throw e
  }

  // Discovery only: drop any source='highlight' rows entirely. Highlight cards
  // are owned by enrichHighlight; this job must never create one.
  const llmChunks = chunks.filter((c) => c.source === 'llm')

  // Sense-disambiguation tiebreaker (Haiku): the pre-filter is heuristic guidance
  // to Opus, not a correctness gate. Run a cheap second LLM call only on
  // LLM-discovered candidates whose headword plausibly collides with an existing
  // user_lookups headword — Haiku decides which are duplicates vs genuinely new
  // senses. Below-CEFR rows land as auto_rejected and bypass to save Haiku tokens.
  const dedupedChunks = await applySenseDisambiguationTiebreaker({
    sessionId,
    userId,
    targetLanguage: session.target_language,
    chunks: llmChunks,
    userLookupsRepository,
    studySessionsRepository,
    processingTelemetryRepository,
  })

  const { touchedLookups } = await materializeBasicDataChunks({
    sessionId,
    userId,
    targetLanguage: session.target_language,
    chunks: dedupedChunks,
    newHighlights: [],
    processedHighlightIds: new Set<string>(),
    segmentIdSet,
    hideTranslationFields: languagePrefs.hideTranslationFields,
    cardsRepository,
    userLookupsRepository,
  })

  // Wiktionary grounding: for each unique user_lookups row we just touched in a
  // kaikki-enabled language, merge structured grammar fields on top of the LLM's.
  // Best-effort — never fail the whole pipeline.
  if (KAIKKI_LANGUAGES.has(session.target_language)) {
    await runWiktionaryGrounding({
      sessionId,
      userId,
      targetLanguage: session.target_language,
      touchedLookups,
      userLookupsRepository,
      wiktionaryEntriesRepository,
      processingTelemetryRepository,
    })
  }
}

// One retry on transient failure (network blip, malformed Haiku response).
// On unrecoverable failure: log, warn, fall through keeping all candidates —
// better to surface a few duplicates at triage than silently drop genuinely
// new senses.
const applySenseDisambiguationTiebreaker = async (params: {
  sessionId: string
  userId: string
  targetLanguage: string
  chunks: BasicDataChunk[]
  userLookupsRepository: UserLookupsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  processingTelemetryRepository: ProcessingTelemetryRepositoryInterface
}): Promise<BasicDataChunk[]> => {
  const { chunks, userLookupsRepository, studySessionsRepository, processingTelemetryRepository } = params
  const startedAt = Date.now()

  const eligibleForTiebreak = chunks.filter((c) => c.source === 'llm' && !c.belowCefr)
  if (eligibleForTiebreak.length === 0) return chunks

  const existingByCandidateHeadword = await userLookupsRepository.findPotentialExistingSensesByHeadwords({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    headwords: eligibleForTiebreak.map((c) => c.headword),
  })
  if (existingByCandidateHeadword.size === 0) {
    await recordPassTelemetry(processingTelemetryRepository, {
      studySessionId: params.sessionId,
      passName: 'disambiguation',
      durationMs: Date.now() - startedAt,
      payload: { skipped: true, reason: 'no_collisions', candidateCount: eligibleForTiebreak.length },
    })
    return chunks
  }

  const candidateById = new Map<string, BasicDataChunk>()
  const candidates: CandidateForDisambiguation[] = []
  eligibleForTiebreak.forEach((chunk, index) => {
    const existing = existingByCandidateHeadword.get(chunk.headword.toLowerCase())
    if (!existing || existing.length === 0) return
    const candidateId = `c${index}`
    candidateById.set(candidateId, chunk)
    candidates.push({
      candidateId,
      headword: chunk.headword,
      candidateSense: chunk.sense,
      candidateDefinition: chunk.definition,
      existingSenses: existing,
    })
  })

  if (candidates.length === 0) {
    await recordPassTelemetry(processingTelemetryRepository, {
      studySessionId: params.sessionId,
      passName: 'disambiguation',
      durationMs: Date.now() - startedAt,
      payload: { skipped: true, reason: 'no_collisions', candidateCount: eligibleForTiebreak.length },
    })
    return chunks
  }

  let decisions: DisambiguationResult[] | null = null
  let lastError: unknown = null
  let attempts = 0
  for (let i = 0; i < 2 && decisions === null; i++) {
    attempts++
    try {
      decisions = await senseDisambiguationPass({ targetLanguage: params.targetLanguage, candidates })
    } catch (e) {
      lastError = e
    }
  }

  if (decisions === null) {
    logCustomErrorMessageAndError(`senseDisambiguationPass failed, sessionId = ${params.sessionId}`, lastError)
    await studySessionsRepository.appendProcessingWarning(
      params.sessionId,
      params.userId,
      `Sense-disambiguation pass failed (kept all candidates): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    )
    await recordPassTelemetry(processingTelemetryRepository, {
      studySessionId: params.sessionId,
      passName: 'disambiguation',
      durationMs: Date.now() - startedAt,
      payload: {
        attempts,
        failed: true,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        candidateCount: candidates.length,
      },
    })
    return chunks
  }

  const allowedMatchedSensesByCandidateId = new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      new Set(candidate.existingSenses.map((existingSense) => existingSense.sense)),
    ])
  )
  const acceptedDuplicateDecisions = decisions.filter((decision) => {
    if (!decision.isDuplicate || decision.matchedExistingSense === null) return false
    return allowedMatchedSensesByCandidateId.get(decision.candidateId)?.has(decision.matchedExistingSense) ?? false
  })
  const rejectedDuplicateDecisions = decisions.filter(
    (decision) =>
      decision.isDuplicate &&
      !acceptedDuplicateDecisions.some((accepted) => accepted.candidateId === decision.candidateId)
  )
  const duplicateIds = new Set(acceptedDuplicateDecisions.map((d) => d.candidateId))
  const droppedChunkRefs = new Set<BasicDataChunk>()
  for (const [candidateId, chunk] of candidateById.entries()) {
    if (duplicateIds.has(candidateId)) droppedChunkRefs.add(chunk)
  }
  const survivors = chunks.filter((c) => !droppedChunkRefs.has(c))

  await recordPassTelemetry(processingTelemetryRepository, {
    studySessionId: params.sessionId,
    passName: 'disambiguation',
    durationMs: Date.now() - startedAt,
    payload: {
      attempts,
      candidates: candidates.map((c) => ({
        id: c.candidateId,
        headword: c.headword,
        candidateSense: c.candidateSense,
        candidateDefinition: c.candidateDefinition,
        existingSenses: c.existingSenses,
      })),
      decisions: decisions.map((d) => ({
        candidateId: d.candidateId,
        isDuplicate: d.isDuplicate,
        matchedExistingSense: d.matchedExistingSense,
      })),
      rejectedDuplicateDecisions: rejectedDuplicateDecisions.map((d) => ({
        candidateId: d.candidateId,
        matchedExistingSense: d.matchedExistingSense,
        reason: 'matched_existing_sense_not_in_candidate_existing_senses',
      })),
      droppedCount: droppedChunkRefs.size,
    },
  })

  return survivors
}
