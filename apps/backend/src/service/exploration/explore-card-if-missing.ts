import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { enrichmentPass } from '../../transport/third-party/anthropic/passes/enrichment-pass'
import { selectSurroundingSegments, formatSurroundingSegments } from '../processing/select-surrounding-segments'

export type ExploreCardDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

export type ExploreCardOutcome = 'updated' | 'skipped' | 'failed'

const isExtrasEmpty = (extras: unknown): boolean => {
  if (!extras || typeof extras !== 'object') return true
  return Object.keys(extras as Record<string, unknown>).length === 0
}

// Idempotently runs the enrichment pass for one card. Skips when extras are
// already populated on the canonical user_lookups row (unless options.force).
// Persists content fields + extras_patch on user_lookups; surface_form on the
// card itself. Headword/sense renames propagate to all sibling cards via the
// canonical row — if the rename collides with an existing chunk we keep the
// original key and log a warning.
export const exploreCardIfMissing = async (
  cardId: string,
  userId: string,
  deps: ExploreCardDependencies,
  options: { force?: boolean } = {}
): Promise<ExploreCardOutcome> => {
  try {
    const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
    if (!card) return 'skipped'
    if (!options.force && !isExtrasEmpty(card.chunk.exploration_extras)) return 'skipped'

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
      surfaceForm: card.surface_form || card.chunk.headword,
      surroundingSegments: surroundingFormatted,
      userNote,
      presetTags,
    })

    // Surface form is per-card-instance — write directly on the card.
    if (enrichment.surface_form && enrichment.surface_form !== card.surface_form) {
      await deps.cardsRepository.updateFields(cardId, { surfaceForm: enrichment.surface_form })
    }

    // Content + extras live on the canonical chunk.
    await deps.userLookupsRepository.updateContent({
      id: card.user_lookup_id,
      translation: enrichment.translation,
      definition: enrichment.definition,
      targetExample: enrichment.target_example,
      nativeExample: enrichment.native_example,
      explorationExtrasPatch: enrichment.extras as Record<string, unknown>,
    })

    // Rename only if the LLM produced a different (headword, sense) and the
    // change doesn't collide with another chunk the user already owns.
    const enrichedHeadword = enrichment.headword || card.chunk.headword
    const enrichedSense = enrichment.sense ?? card.chunk.sense ?? ''
    if (enrichedHeadword !== card.chunk.headword || enrichedSense !== card.chunk.sense) {
      const result = await deps.userLookupsRepository.renameKey({
        id: card.user_lookup_id,
        headword: enrichedHeadword,
        sense: enrichedSense,
      })
      if (!result.ok) {
        logWithSentry({
          message: 'exploreCardIfMissing: rename collision, keeping original key',
          params: {
            cardId,
            userLookupId: card.user_lookup_id,
            fromHeadword: card.chunk.headword,
            fromSense: card.chunk.sense,
            toHeadword: enrichedHeadword,
            toSense: enrichedSense,
          },
        })
      }
    }

    return 'updated'
  } catch (e) {
    logCustomErrorMessageAndError(`exploreCardIfMissing failed, cardId = ${cardId}`, e)
    try {
      const card = await deps.cardsRepository.findById(cardId)
      if (card) {
        await deps.studySessionsRepository.appendProcessingWarning(
          card.study_session_id,
          userId,
          `On-demand exploration failed for card "${card.surface_form || card.chunk.headword}": ${
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
