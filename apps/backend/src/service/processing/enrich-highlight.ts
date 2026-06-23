import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { StudyIntentSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { applyStudyIntent, generateStudyIntentFormData } from '../study-facets/apply-study-intent'
import { ensureSessionContextBlob } from './ensure-session-context-blob'
import { basicDataPass, HighlightInput } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { isEnglishTargetLanguage } from '../../transport/third-party/anthropic/language-instructions'
import { MODEL_ENRICHMENT } from '../../transport/third-party/anthropic/anthropic-client'
import { selectSurroundingSegments } from './select-surrounding-segments'
import { materializeBasicDataChunks } from './materialize-basic-data-chunks'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { recordPassTelemetry } from './telemetry'
import { getLanguageMode } from '../user-prefs/language-mode'
import type { ProcessingDependencies } from './processing-dependencies'

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
    studyFacetsRepository,
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
  // cached value on later jobs (shared with chat + on-demand exploration).
  const contextBlob = await ensureSessionContextBlob(session, userId, {
    contentSourcesRepository,
    textSegmentsRepository,
    studySessionsRepository,
  })
  if (!contextBlob) {
    logWithSentry({ message: 'enrichHighlight: content source not found', params: { sessionId } })
    return 'cancelled'
  }

  const [languagePrefs, window] = await Promise.all([
    getLanguageMode({
      userId,
      targetLanguage: session.target_language,
      snapshotNativeLanguage: session.native_language,
      usersRepository,
      targetLanguagePrefsRepository: userTargetLanguagePrefsRepository,
    }),
    selectSurroundingSegments(
      session.text_track_id,
      highlight.start_segment_id,
      textSegmentsRepository,
      undefined,
      highlight.end_segment_id
    ),
  ])
  const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language

  const highlightInput: HighlightInput = {
    highlightId: highlight.id,
    segmentId: highlight.start_segment_id,
    selectionText: highlight.selection_text,
  }

  // English IPA follows the user's dialect preference (GA vs RP) — the basic
  // data pass now generates grammar.ipa by default (grounding overwrites it
  // with Wiktionary's where available).
  const englishIpaDialect = isEnglishTargetLanguage(session.target_language)
    ? await usersRepository.getEnglishIpaDialect(userId)
    : undefined

  const chunks = await basicDataPass({
    nativeLanguage: languageModeNativeLanguage,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    movieContextBlob: contextBlob,
    segments: window.map((s) => ({ id: s.id, index: s.index, text: s.text })),
    highlights: [highlightInput],
    hideTranslationFields: languagePrefs.hideTranslationFields,
    allowL1Notes: languagePrefs.allowL1Notes,
    englishIpaDialect,
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

  const { touchedLookups, insertedCards } = await materializeBasicDataChunks({
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

  // Apply any gloss-save study intent now that the term exists — and after
  // grounding, because the pronunciation reconcile inside applyStudyIntent
  // needs the grounded grammar.ipa. The applied_at guard is stamped atomically
  // with the facet writes (a job retry/re-enqueue no-ops), and form-data
  // generation failures leave the facet pending_data (the term view's retry
  // chip takes over) without failing the job — a thrown error would only
  // trigger a retry the guard skips anyway.
  if (stillExists.study_intent && !stillExists.study_intent_applied_at) {
    const parsedIntent = StudyIntentSchema.safeParse(stillExists.study_intent)
    const intentCard = insertedCards.find((c) => c.highlight_id === highlightId)
    if (parsedIntent.success && intentCard) {
      // Re-load grounded grammar via findByIdForUser inside applyStudyIntent;
      // the surface form is the card's (the highlight's literal selection on
      // the stub-fallback path, where they're equal anyway).
      const { applied, formFacetTargets } = await applyStudyIntent(
        {
          userLookupId: intentCard.user_lookup_id,
          userId,
          surfaceForm: intentCard.surface_form ?? stillExists.selection_text,
          intent: parsedIntent.data,
          appliedGuardHighlightId: highlightId,
        },
        { userLookupsRepository, studyFacetsRepository }
      )
      if (applied) {
        await generateStudyIntentFormData(
          {
            userLookupId: intentCard.user_lookup_id,
            userId,
            formFacetTargets,
            encounteredSentence: window.find((s) => s.id === stillExists.start_segment_id)?.text ?? null,
          },
          { userLookupsRepository, usersRepository, userTargetLanguagePrefsRepository }
        )
      }
    } else if (!parsedIntent.success) {
      logWithSentry({
        message: 'enrichHighlight: unparseable study_intent, skipping',
        params: { highlightId },
      })
    }
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
