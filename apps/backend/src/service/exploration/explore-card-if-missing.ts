import { logWithSentry, logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { deepEqualNormalized } from '@flicktionary/core/utils/deep-equal-normalized'
import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { enrichmentPass } from '../../transport/third-party/anthropic/passes/enrichment-pass'
import { sanitizeGrammarIpa } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { isEnglishTargetLanguage } from '../../transport/third-party/anthropic/language-instructions'
import { selectSurroundingSegments, formatSurroundingSegments } from '../processing/select-surrounding-segments'
import { getLanguageMode } from '../user-prefs/language-mode'
import {
  sanitizeExplorationExtrasForLanguageMode,
  sanitizeTextFieldsForLanguageMode,
} from '../user-prefs/language-output-guards'

export type ExploreCardDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
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

    const surrounding = await selectSurroundingSegments(
      session.text_track_id,
      card.segment_id,
      deps.textSegmentsRepository
    )
    const surroundingFormatted = formatSurroundingSegments(surrounding, card.segment_id)

    const languagePrefs = await getLanguageMode({
      userId,
      targetLanguage: session.target_language,
      snapshotNativeLanguage: session.native_language,
      usersRepository: deps.usersRepository,
      targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    })
    const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language

    // English explorations follow the user's IPA dialect preference (GA vs RP):
    // it steers extras.ipa and which variety counts as the default vs a regionalism.
    const englishIpaDialect = isEnglishTargetLanguage(session.target_language)
      ? await deps.usersRepository.getEnglishIpaDialect(userId)
      : undefined

    const enrichment = await enrichmentPass({
      nativeLanguage: languageModeNativeLanguage,
      targetLanguage: session.target_language,
      cefrLevel: session.cefr_level,
      movieContextBlob: session.context_blob,
      surfaceForm: card.surface_form || card.chunk.headword,
      surroundingSegments: surroundingFormatted,
      hideTranslationFields: languagePrefs.hideTranslationFields,
      allowL1Notes: languagePrefs.allowL1Notes,
      englishIpaDialect,
    })
    const sanitizedText = sanitizeTextFieldsForLanguageMode(
      {
        translation: enrichment.translation,
        nativeExample: enrichment.native_example,
      },
      languagePrefs
    )
    const sanitizedExtras = sanitizeExplorationExtrasForLanguageMode(
      enrichment.extras as Record<string, unknown>,
      languagePrefs
    )

    // Surface form is per-card-instance — write directly on the card.
    if (enrichment.surface_form && enrichment.surface_form !== card.surface_form) {
      await deps.cardsRepository.updateFields(cardId, { surfaceForm: enrichment.surface_form })
    }

    // Pronunciation moved from extras.ipa to grammar.ipa — drop a legacy
    // extras.ipa defensively (the schema no longer asks for it, but the model
    // may still emit one and a stale value would shadow the grammar bag).
    if (sanitizedExtras) delete sanitizedExtras.ipa

    const grammarPatch = sanitizeGrammarIpa({ ...enrichment.grammar })
    // Exploration fills grammar.ipa only when the stored bag has nothing
    // displayable AND it isn't Wiktionary-grounded AND the user hasn't edited
    // the grammar — never overwrite a grounded or hand-fixed transcription.
    const existingGrammar = (card.chunk.grammar ?? {}) as Record<string, unknown>
    const canPatchIpa =
      !hasDisplayableIpa((existingGrammar.ipa ?? null) as IpaBagShape | null, session.target_language) &&
      (!card.chunk.grounded_at || !deepEqualNormalized(existingGrammar.ipa, card.chunk.grounding_patch?.ipa)) &&
      !card.chunk.grammar_user_edited_at
    if (!canPatchIpa) delete grammarPatch.ipa

    // Content + extras + grammar live on the canonical chunk. When translations
    // are disabled the sanitized fields are null, and updateContent's COALESCE
    // semantics preserve whatever is stored — so a manually-entered translation
    // survives enrichment instead of being scrubbed.
    await deps.userLookupsRepository.updateContent({
      id: card.user_lookup_id,
      translation: sanitizedText.translation,
      definition: enrichment.definition,
      targetExample: enrichment.target_example,
      nativeExample: sanitizedText.nativeExample,
      explorationExtrasPatch: sanitizedExtras,
      grammarPatch: Object.keys(grammarPatch).length > 0 ? grammarPatch : null,
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
