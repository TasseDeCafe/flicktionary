import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { generateContextBlob } from '../../transport/third-party/anthropic/passes/generate-context-blob'
import { generateL1InterferenceNotes } from '../../transport/third-party/anthropic/passes/generate-l1-interference-notes'
import {
  basicDataPass,
  BasicDataChunk,
  HighlightInput,
} from '../../transport/third-party/anthropic/passes/basic-data-pass'

export type ProcessingDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
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
    usersRepository,
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
      const excludedHeadwordSenses = await userLookupsRepository.listHeadwordSensesForLanguage(
        userId,
        session.target_language
      )
      const segmentInputs = segments.map((s) => ({ id: s.id, index: s.index, text: s.text }))
      const segmentIdSet = new Set(segments.map((s) => s.id))

      let chunks: BasicDataChunk[] = []
      try {
        chunks = await basicDataPass({
          nativeLanguage: session.native_language,
          targetLanguage: session.target_language,
          cefrLevel: session.cefr_level,
          movieContextBlob: contextBlob,
          l1InterferenceNotes: l1Row.notes,
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

      // Track which highlights we've created cards for, so we can fall back to
      // a minimal stub for any highlight the model dropped on the floor.
      const coveredHighlightIds = new Set<string>()

      for (const chunk of filteredChunks) {
        if (!segmentIdSet.has(chunk.segmentId)) continue

        if (chunk.source === 'highlight' && chunk.highlightId) {
          if (processedHighlightIds.has(chunk.highlightId)) continue
          coveredHighlightIds.add(chunk.highlightId)
        }

        await cardsRepository.insertCard({
          studySessionId: sessionId,
          highlightId: chunk.source === 'highlight' ? (chunk.highlightId ?? null) : null,
          segmentId: chunk.segmentId,
          headword: chunk.headword,
          sense: chunk.sense,
          surfaceForm: chunk.surfaceForm,
          translation: chunk.translation,
          definition: chunk.definition,
          targetExample: chunk.targetExample,
          nativeExample: chunk.nativeExample,
          explorationExtras: {},
          status: chunk.source === 'highlight' ? 'kept' : chunk.belowCefr ? 'auto_rejected' : 'pending',
        })
      }

      // Fallback: if the model failed to emit a row for a highlight, insert a
      // minimal stub so the highlight isn't silently dropped.
      for (const highlight of newHighlights) {
        if (coveredHighlightIds.has(highlight.highlightId)) continue
        await cardsRepository.insertCard({
          studySessionId: sessionId,
          highlightId: highlight.highlightId,
          segmentId: highlight.segmentId,
          headword: highlight.selectionText,
          sense: '',
          surfaceForm: highlight.selectionText,
          translation: null,
          definition: null,
          targetExample: null,
          nativeExample: null,
          explorationExtras: {},
          status: 'kept',
        })
      }
    }

    await studySessionsRepository.markProcessed(sessionId, userId)
  } catch (e) {
    logWithSentry({ message: 'processSession: uncaught error', params: { sessionId, userId }, error: e })
    await studySessionsRepository.markFailed(sessionId, userId)
  }
}
