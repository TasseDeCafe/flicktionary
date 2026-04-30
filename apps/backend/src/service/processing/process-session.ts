import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { generateContextBlob } from '../../transport/third-party/anthropic/passes/generate-context-blob'
import { generateL1InterferenceNotes } from '../../transport/third-party/anthropic/passes/generate-l1-interference-notes'
import { difficultWordsPass, DifficultChunk } from '../../transport/third-party/anthropic/passes/difficult-words-pass'
import {
  fullExplorationPass,
  FullExploration,
} from '../../transport/third-party/anthropic/passes/full-exploration-pass'
import { CardFullExplorationJson } from '../../transport/database/cards/cards-repository'
import { selectSurroundingSegments, formatSurroundingSegments } from './select-surrounding-segments'

export type ProcessingDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
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
    l1InterferenceNotesRepository,
    userLookupsRepository,
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

    // Idempotency markers — let users add new highlights to an already-processed
    // session and re-run without duplicating work.
    const hasLlmSuggestedCards = existingCards.some((c) => c.highlight_id === null)
    const processedHighlightIds = new Set(
      existingCards.filter((c) => c.highlight_id !== null).map((c) => c.highlight_id as string)
    )

    if (!contentSource || !track || segments.length === 0) {
      await studySessionsRepository.markFailed(sessionId, userId)
      logWithSentry({
        message: 'processSession: missing prerequisites',
        params: { sessionId, hasContentSource: !!contentSource, hasTrack: !!track, segmentCount: segments.length },
      })
      return
    }

    // 1. Movie context blob — generate if missing.
    let contextBlob = session.context_blob
    if (!contextBlob) {
      const sample = segments
        .slice(0, CONTEXT_BLOB_SAMPLE_SIZE)
        .map((s) => s.text)
        .join('\n')
      contextBlob = await generateContextBlob({
        contentTitle: contentSource.title,
        contentLanguage: contentSource.language,
        segmentSample: sample,
      })
      await studySessionsRepository.updateContextBlob(sessionId, userId, contextBlob)
    }

    // 2. L1 interference notes — generate per (L1, target) pair, cached forever.
    let l1Row = await l1InterferenceNotesRepository.findByPair(session.native_language, session.target_language)
    if (!l1Row) {
      const notes = await generateL1InterferenceNotes({
        nativeLanguage: session.native_language,
        targetLanguage: session.target_language,
      })
      await l1InterferenceNotesRepository.upsertNotes(session.native_language, session.target_language, notes)
      l1Row = {
        l1_language: session.native_language,
        target_language: session.target_language,
        notes,
        created_at: '',
        updated_at: '',
      }
    }

    const baseMethodologyArgs = {
      nativeLanguage: session.native_language,
      targetLanguage: session.target_language,
      cefrLevel: session.cefr_level,
      movieContextBlob: contextBlob,
      l1InterferenceNotes: l1Row.notes,
    }

    // 3. Difficult-words pass — produces ~25 chunks, with belowCefr flagged for auto-rejection.
    const excludedHeadwordSenses = await userLookupsRepository.listHeadwordSensesForLanguage(
      userId,
      session.target_language
    )
    const segmentInputs = segments.map((s) => ({ id: s.id, index: s.index, text: s.text }))
    const segmentIdSet = new Set(segments.map((s) => s.id))

    let difficultChunks: DifficultChunk[] = []
    if (!hasLlmSuggestedCards) {
      try {
        difficultChunks = await difficultWordsPass({
          ...baseMethodologyArgs,
          segments: segmentInputs,
          excludedHeadwordSenses,
        })
      } catch (e) {
        logCustomErrorMessageAndError(`difficultWordsPass failed, sessionId = ${sessionId}`, e)
        await studySessionsRepository.appendProcessingWarning(
          sessionId,
          userId,
          `Difficult-words pass failed: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }

    for (const chunk of difficultChunks) {
      if (!segmentIdSet.has(chunk.segmentId)) {
        // The model occasionally invents IDs; skip rather than violate FK.
        continue
      }
      await cardsRepository.insertCard({
        studySessionId: sessionId,
        highlightId: null,
        segmentId: chunk.segmentId,
        headword: chunk.headword,
        sense: chunk.sense,
        surfaceForm: chunk.surfaceForm,
        fullExploration: {},
        status: chunk.belowCefr ? 'auto_rejected' : 'pending',
      })
    }

    // 4. Per-highlight full exploration pass — one model call per highlight, with ±10 surrounding segments.
    for (const highlight of highlights) {
      if (processedHighlightIds.has(highlight.id)) continue
      try {
        const surrounding = await selectSurroundingSegments(
          session.text_track_id,
          highlight.start_segment_id,
          textSegmentsRepository
        )
        const surroundingFormatted = formatSurroundingSegments(surrounding, highlight.start_segment_id)

        const exploration: FullExploration = await fullExplorationPass({
          ...baseMethodologyArgs,
          surfaceForm: highlight.selection_text,
          surroundingSegments: surroundingFormatted,
          userNote: highlight.note,
          presetTags: highlight.preset_tags,
        })

        await cardsRepository.insertCard({
          studySessionId: sessionId,
          highlightId: highlight.id,
          segmentId: highlight.start_segment_id,
          headword: exploration.headword || highlight.selection_text,
          sense: exploration.sense ?? '',
          surfaceForm: exploration.surface_form || highlight.selection_text,
          fullExploration: exploration as unknown as CardFullExplorationJson,
          status: 'pending',
        })
      } catch (e) {
        logCustomErrorMessageAndError(`fullExplorationPass failed, highlightId = ${highlight.id}`, e)
        await studySessionsRepository.appendProcessingWarning(
          sessionId,
          userId,
          `Full exploration failed for highlight "${highlight.selection_text}": ${
            e instanceof Error ? e.message : String(e)
          }`
        )
      }
    }

    await studySessionsRepository.markProcessed(sessionId, userId)
  } catch (e) {
    logWithSentry({ message: 'processSession: uncaught error', params: { sessionId, userId }, error: e })
    await studySessionsRepository.markFailed(sessionId, userId)
  }
}
