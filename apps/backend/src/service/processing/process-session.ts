import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { generateContextBlob } from '../../transport/third-party/anthropic/passes/generate-context-blob'
import {
  basicDataPass,
  BasicDataChunk,
  HighlightInput,
} from '../../transport/third-party/anthropic/passes/basic-data-pass'
import {
  CandidateForDisambiguation,
  DisambiguationResult,
  senseDisambiguationPass,
} from '../../transport/third-party/anthropic/passes/sense-disambiguation-pass'
import { resolveRegconfig } from '../../transport/database/text-segments/text-segments-repository'
import { recordPassTelemetry } from './telemetry'

export type ProcessingDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  processingTelemetryRepository: ProcessingTelemetryRepositoryInterface
}

const CONTEXT_BLOB_SAMPLE_SIZE = 150

export const processSession = async (
  sessionId: string,
  userId: string,
  deps: ProcessingDependencies
): Promise<void> => {
  const {
    contentSourcesRepository,
    textTracksRepository,
    textSegmentsRepository,
    studySessionsRepository,
    highlightsRepository,
    cardsRepository,
    userLookupsRepository,
    usersRepository,
    processingTelemetryRepository,
  } = deps

  try {
    const session = await studySessionsRepository.findByIdForUser(sessionId, userId)
    if (!session) {
      logWithSentry({ message: 'processSession: session not found', params: { sessionId, userId } })
      return
    }

    const [contentSource, track, segments, highlights, existingCards] = await Promise.all([
      contentSourcesRepository.findById(session.content_source_id),
      textTracksRepository.findById(session.text_track_id),
      textSegmentsRepository.listByTrackId(session.text_track_id),
      highlightsRepository.listBySessionId(sessionId),
      cardsRepository.listBySessionId(sessionId),
    ])

    if (!contentSource || !track || segments.length === 0) {
      await studySessionsRepository.markFailed(sessionId, userId)
      logWithSentry({
        message: 'processSession: missing prerequisites',
        params: { sessionId, hasContentSource: !!contentSource, hasTrack: !!track, segmentCount: segments.length },
      })
      return
    }

    // Idempotency markers — let users add new highlights to an already-processed
    // session and re-run without duplicating work. The basic-data pass is a
    // no-op when LLM-suggested cards already exist AND every highlight has a card.
    const hasLlmSuggestedCards = existingCards.some((c) => c.highlight_id === null)
    const processedHighlightIds = new Set(
      existingCards.filter((c) => c.highlight_id !== null).map((c) => c.highlight_id as string)
    )
    const allHighlightsCovered = highlights.every((h) => processedHighlightIds.has(h.id))
    const skipBasicDataPass = hasLlmSuggestedCards && allHighlightsCovered

    // 1. Source context blob — generate if missing.
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

    const llmHighlightsEnabled = await usersRepository.getLlmHighlightsEnabled(userId)

    // When LLM discovery is off, the only point of running the pass is to
    // populate basic data for any new user highlight. With no new highlights
    // and no need to discover, there's nothing to do.
    const newHighlights: HighlightInput[] = highlights
      .filter((h) => !processedHighlightIds.has(h.id))
      .map((h) => ({
        highlightId: h.id,
        segmentId: h.start_segment_id,
        selectionText: h.selection_text,
        note: h.note,
        presetTags: h.preset_tags,
      }))

    const llmDiscoveryWanted = llmHighlightsEnabled && !hasLlmSuggestedCards
    const shouldCallPass = !skipBasicDataPass && (llmDiscoveryWanted || newHighlights.length > 0)

    if (shouldCallPass) {
      // Source-relevant pre-filter: only feed the LLM exclusions whose
      // headword plausibly appears in this session's source. Bounded by
      // source size (a few hundred typical), not user vocab size. Telemetry
      // captures the prune ratio for monitoring.
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
          nativeLanguage: session.native_language,
          targetLanguage: session.target_language,
          cefrLevel: session.cefr_level,
          movieContextBlob: contextBlob,
          segments: segmentInputs,
          highlights: newHighlights,
          excludedHeadwordSenses,
          llmDiscoveryEnabled: llmDiscoveryWanted,
        })
      } catch (e) {
        logCustomErrorMessageAndError(`basicDataPass failed, sessionId = ${sessionId}`, e)
        await studySessionsRepository.appendProcessingWarning(
          sessionId,
          userId,
          `Basic-data pass failed: ${e instanceof Error ? e.message : String(e)}`
        )
      }

      // Drop LLM-source rows on re-process (already-have-LLM-cards case) or
      // when the user has turned off LLM discovery entirely.
      const filteredChunks =
        hasLlmSuggestedCards || !llmHighlightsEnabled ? chunks.filter((c) => c.source === 'highlight') : chunks

      // Sense-disambiguation tiebreaker (Haiku): the pre-filter is heuristic
      // guidance to Opus, not a correctness gate. After the pass returns, run
      // a cheap second LLM call only on LLM-discovered candidates whose
      // headword collides (case-insensitive) with an existing user_lookups
      // headword — Haiku decides which are duplicates of an existing sense
      // vs genuinely new senses worth keeping. Highlights and below-CEFR rows
      // bypass: highlights always pass through per spec; below-CEFR land as
      // auto_rejected and shouldn't burn Haiku tokens.
      const dedupedChunks = await applySenseDisambiguationTiebreaker({
        sessionId,
        userId,
        targetLanguage: session.target_language,
        chunks: filteredChunks,
        userLookupsRepository,
        studySessionsRepository,
        processingTelemetryRepository,
      })

      // Track which highlights we've created cards for, so we can fall back to
      // a minimal stub for any highlight the model dropped on the floor.
      const coveredHighlightIds = new Set<string>()

      for (const chunk of dedupedChunks) {
        if (!segmentIdSet.has(chunk.segmentId)) continue

        if (chunk.source === 'highlight' && chunk.highlightId) {
          if (processedHighlightIds.has(chunk.highlightId)) continue
          coveredHighlightIds.add(chunk.highlightId)
        }

        // Ensure the canonical vocabulary row exists, then fill in content
        // only when no prior content is set. This preserves user edits and
        // keeps the first-seen translation/definition stable across sessions.
        const lookup = await userLookupsRepository.findOrCreate({
          userId,
          targetLanguage: session.target_language,
          headword: chunk.headword,
          sense: chunk.sense,
        })
        if (lookup.translation === null && lookup.definition === null) {
          await userLookupsRepository.updateContent({
            id: lookup.id,
            translation: chunk.translation,
            definition: chunk.definition,
            targetExample: chunk.targetExample,
            nativeExample: chunk.nativeExample,
            grammarPatch: chunk.grammar ?? null,
          })
        } else if (chunk.grammar) {
          // Existing row already had content from an earlier session. Don't
          // touch the user's text edits, but still merge any grammar facts
          // the model emitted this round — they're additive.
          await userLookupsRepository.updateContent({
            id: lookup.id,
            grammarPatch: chunk.grammar,
          })
        }

        const insertedCard = await cardsRepository.insertCard({
          studySessionId: sessionId,
          highlightId: chunk.source === 'highlight' ? (chunk.highlightId ?? null) : null,
          segmentId: chunk.segmentId,
          userLookupId: lookup.id,
          surfaceForm: chunk.surfaceForm,
          status: chunk.source === 'highlight' ? 'kept' : chunk.belowCefr ? 'auto_rejected' : 'pending',
        })
        if (insertedCard.status === 'kept') {
          await userLookupsRepository.applyKeepTransition({
            userLookupId: lookup.id,
            cardId: insertedCard.id,
          })
        }
      }

      // Fallback: if the model failed to emit a row for a highlight, insert a
      // minimal stub so the highlight isn't silently dropped. Headword falls
      // back to the raw selection text.
      for (const highlight of newHighlights) {
        if (coveredHighlightIds.has(highlight.highlightId)) continue
        const lookup = await userLookupsRepository.findOrCreate({
          userId,
          targetLanguage: session.target_language,
          headword: highlight.selectionText,
          sense: '',
        })
        const insertedCard = await cardsRepository.insertCard({
          studySessionId: sessionId,
          highlightId: highlight.highlightId,
          segmentId: highlight.segmentId,
          userLookupId: lookup.id,
          surfaceForm: highlight.selectionText,
          status: 'kept',
        })
        await userLookupsRepository.applyKeepTransition({
          userLookupId: lookup.id,
          cardId: insertedCard.id,
        })
      }
    }

    await studySessionsRepository.markProcessed(sessionId, userId)
  } catch (e) {
    logWithSentry({ message: 'processSession: uncaught error', params: { sessionId, userId }, error: e })
    await studySessionsRepository.markFailed(sessionId, userId)
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

  const existingByHeadword = await userLookupsRepository.findExistingSensesByHeadwords({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    headwords: eligibleForTiebreak.map((c) => c.headword),
  })
  if (existingByHeadword.size === 0) {
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
    const existing = existingByHeadword.get(chunk.headword.toLowerCase())
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

  const duplicateIds = new Set(decisions.filter((d) => d.isDuplicate).map((d) => d.candidateId))
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
      droppedCount: droppedChunkRefs.size,
    },
  })

  return survivors
}
