import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { generateContextBlob } from '../../transport/third-party/anthropic/passes/generate-context-blob'
import { basicDataPass, HighlightInput } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { MODEL_ENRICHMENT } from '../../transport/third-party/anthropic/anthropic-client'
import { selectSurroundingSegments } from './select-surrounding-segments'
import { materializeBasicDataChunks } from './materialize-basic-data-chunks'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { recordPassTelemetry } from './telemetry'
import { getLanguageMode } from '../user-prefs/language-mode'
import type { ProcessingDependencies } from './processing-dependencies'

const CONTEXT_BLOB_SAMPLE_SIZE = 150

export type EnrichHighlightOutcome = 'enriched' | 'cancelled'

// Enrich exactly one user highlight into a pending card + user_lookups row, in
// the background, the moment it is committed during reading. Independent of
// every other highlight: user highlights bypass the discovery-only exclusion
// prefilter and sense-disambiguation tiebreaker, so no cross-highlight
// coordination is needed here.
//
// Returns 'cancelled' (a non-retryable terminal outcome) when the session or
// highlight no longer exists — the highlight was deleted mid-flight. The
// pre-materialize re-check, not the idempotent insert, is what closes the
// delete-during-enrichment race: we must never insert a card for a highlight
// the user already removed. Genuine failures throw, so the worker can retry.
export const enrichHighlight = async (
  params: { sessionId: string; highlightId: string; userId: string },
  deps: ProcessingDependencies
): Promise<EnrichHighlightOutcome> => {
  const { sessionId, highlightId, userId } = params
  const {
    contentSourcesRepository,
    textSegmentsRepository,
    studySessionsRepository,
    highlightsRepository,
    cardsRepository,
    userLookupsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    processingTelemetryRepository,
    wiktionaryEntriesRepository,
  } = deps

  const startedAt = Date.now()

  const session = await studySessionsRepository.findByIdForUser(sessionId, userId)
  if (!session) {
    logWithSentry({ message: 'enrichHighlight: session not found', params: { sessionId, userId } })
    return 'cancelled'
  }

  const highlight = await highlightsRepository.findById(highlightId)
  if (!highlight || highlight.study_session_id !== sessionId) {
    // Deleted (or never belonged here) before we started — nothing to enrich.
    return 'cancelled'
  }

  // Context blob: generate-and-persist on the first job for a session, read the
  // cached value on later jobs. Sampling the
  // opening slice avoids loading the whole track for long reads.
  let contextBlob = session.context_blob
  if (!contextBlob) {
    const contentSource = await contentSourcesRepository.findById(session.content_source_id)
    if (!contentSource) {
      logWithSentry({ message: 'enrichHighlight: content source not found', params: { sessionId } })
      return 'cancelled'
    }
    const sampleSegments = await textSegmentsRepository.listFirstByTrackId(
      session.text_track_id,
      CONTEXT_BLOB_SAMPLE_SIZE
    )
    contextBlob = await generateContextBlob({
      contentTitle: contentSource.title,
      contentLanguage: contentSource.language,
      contentType: contentSource.type,
      segmentSample: sampleSegments.map((s) => s.text).join('\n'),
    })
    await studySessionsRepository.updateContextBlob(sessionId, userId, contextBlob)
  }

  const [languagePrefs, window] = await Promise.all([
    getLanguageMode({
      userId,
      targetLanguage: session.target_language,
      snapshotNativeLanguage: session.native_language,
      usersRepository,
      targetLanguagePrefsRepository: userTargetLanguagePrefsRepository,
    }),
    selectSurroundingSegments(session.text_track_id, highlight.start_segment_id, textSegmentsRepository),
  ])
  const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language

  const highlightInput: HighlightInput = {
    highlightId: highlight.id,
    segmentId: highlight.start_segment_id,
    selectionText: highlight.selection_text,
    note: highlight.note,
    presetTags: highlight.preset_tags,
  }

  const chunks = await basicDataPass({
    nativeLanguage: languageModeNativeLanguage,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    movieContextBlob: contextBlob,
    segments: window.map((s) => ({ id: s.id, index: s.index, text: s.text })),
    highlights: [highlightInput],
    hideTranslationFields: languagePrefs.hideTranslationFields,
    allowL1Notes: languagePrefs.allowL1Notes,
    model: MODEL_ENRICHMENT,
  })

  // Re-check immediately before writing: if the user deleted the highlight while
  // the LLM call was in flight, abort as a non-retryable cancellation rather
  // than materialize a card for a row that no longer exists.
  const stillExists = await highlightsRepository.findById(highlightId)
  if (!stillExists || stillExists.study_session_id !== sessionId) {
    return 'cancelled'
  }

  // Only highlight rows belong here — defensive: discovery is disabled, but the
  // model could still emit a stray llm row.
  const highlightChunks = chunks.filter((c) => c.source === 'highlight')
  const segmentIdSet = new Set(window.map((s) => s.id))

  const { touchedLookups } = await materializeBasicDataChunks({
    sessionId,
    userId,
    targetLanguage: session.target_language,
    chunks: highlightChunks,
    newHighlights: [highlightInput],
    processedHighlightIds: new Set<string>(),
    segmentIdSet,
    hideTranslationFields: languagePrefs.hideTranslationFields,
    cardsRepository,
    userLookupsRepository,
  })

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

  await recordPassTelemetry(processingTelemetryRepository, {
    studySessionId: sessionId,
    passName: 'highlight_enrichment',
    durationMs: Date.now() - startedAt,
    payload: {
      highlightId,
      model: MODEL_ENRICHMENT,
      windowSize: window.length,
      chunkCount: highlightChunks.length,
    },
  })

  return 'enriched'
}
