import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import { enrichmentPass } from '../../transport/third-party/anthropic/passes/enrichment-pass'
import { selectSurroundingSegments, formatSurroundingSegments } from '../processing/select-surrounding-segments'

export type ExploreCardDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
}

export type ExploreCardOutcome = 'updated' | 'skipped' | 'failed'

const isExtrasEmpty = (extras: unknown): boolean => {
  if (!extras || typeof extras !== 'object') return true
  return Object.keys(extras as Record<string, unknown>).length === 0
}

// Idempotently runs the enrichment pass for one card. Skips when extras are
// already populated (unless options.force is true). Persists basic columns +
// extras_patch in a single repository call. Caller decides fire-and-forget vs await.
export const exploreCardIfMissing = async (
  cardId: string,
  userId: string,
  deps: ExploreCardDependencies,
  options: { force?: boolean } = {}
): Promise<ExploreCardOutcome> => {
  try {
    const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
    if (!card) return 'skipped'
    if (!options.force && !isExtrasEmpty(card.exploration_extras)) return 'skipped'

    const session = await deps.studySessionsRepository.findByIdForUser(card.study_session_id, userId)
    if (!session || !session.context_blob) return 'skipped'

    const l1 = await deps.l1InterferenceNotesRepository.findByPair(session.native_language, session.target_language)
    if (!l1) return 'skipped'

    const surrounding = await selectSurroundingSegments(
      session.text_track_id,
      card.segment_id,
      deps.textSegmentsRepository
    )
    const surroundingFormatted = formatSurroundingSegments(surrounding, card.segment_id)

    let userNote: string | null = null
    let presetTags: string[] = []
    if (card.highlight_id) {
      const highlight = await deps.highlightsRepository.findById(card.highlight_id)
      if (highlight) {
        userNote = highlight.note
        presetTags = highlight.preset_tags ?? []
      }
    }

    const enrichment = await enrichmentPass({
      nativeLanguage: session.native_language,
      targetLanguage: session.target_language,
      cefrLevel: session.cefr_level,
      movieContextBlob: session.context_blob,
      l1InterferenceNotes: l1.notes,
      surfaceForm: card.surface_form || card.headword,
      surroundingSegments: surroundingFormatted,
      userNote,
      presetTags,
    })

    await deps.cardsRepository.updateFields(cardId, {
      headword: enrichment.headword || card.headword,
      sense: enrichment.sense ?? card.sense ?? '',
      surfaceForm: enrichment.surface_form || card.surface_form,
      translation: enrichment.translation,
      definition: enrichment.definition,
      targetExample: enrichment.target_example,
      nativeExample: enrichment.native_example,
      extrasPatch: enrichment.extras,
    })
    return 'updated'
  } catch (e) {
    logCustomErrorMessageAndError(`exploreCardIfMissing failed, cardId = ${cardId}`, e)
    try {
      const card = await deps.cardsRepository.findById(cardId)
      if (card) {
        await deps.studySessionsRepository.appendProcessingWarning(
          card.study_session_id,
          userId,
          `On-demand exploration failed for card "${card.surface_form || card.headword}": ${
            e instanceof Error ? e.message : String(e)
          }`
        )
      }
    } catch (warnErr) {
      logWithSentry({ message: 'exploreCardIfMissing: failed to append warning', error: warnErr })
    }
    return 'failed'
  }
}
