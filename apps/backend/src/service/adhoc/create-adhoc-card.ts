import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { StudyFacetsRepositoryInterface } from '../../transport/database/study-facets/study-facets-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { basicDataPass, HighlightInput } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { isEnglishTargetLanguage } from '../../transport/third-party/anthropic/language-instructions'
import { materializeBasicDataChunks } from '../processing/materialize-basic-data-chunks'
import { runWiktionaryGrounding } from '../processing/wiktionary-grounding-runner'
import { getLanguageMode } from '../user-prefs/language-mode'
import {
  applyStudyIntent,
  generateStudyIntentFormData,
  StudyIntentFormTarget,
} from '../study-facets/apply-study-intent'
import { getOrCreateAdhocSession } from './get-or-create-adhoc-session'
import { StudyIntent } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export type CreateAdhocCardDependencies = {
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  processingTelemetryRepository: ProcessingTelemetryRepositoryInterface
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}

// Discriminated error codes the router maps to user-friendly messages.
export type CreateAdhocCardError = 'native_language_not_set' | 'cefr_not_set' | 'llm_failure' | 'card_not_inserted'

export class AdhocCardCreationError extends Error {
  constructor(
    public readonly code: CreateAdhocCardError,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'AdhocCardCreationError'
  }
}

export type CreateAdhocCardResult = {
  cardId: string
  sessionId: string
}

// Single-call ad-hoc card creation. Builds (or reuses) the synthetic per-user-
// per-language session, appends a fresh segment + highlight for this entry,
// runs basicDataPass in highlight-only mode (no chunk discovery, no dedup),
// materializes the resulting chunk via the shared helper, and runs Wiktionary
// grounding when the language has a kaikki dump.
//
// On any LLM/processing failure the synthetic segment + highlight rows we
// already inserted are harmless orphans (no card pointing at them); we don't
// attempt cleanup here. A future maintenance job can prune if it ever matters.
export const createAdhocCard = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  context: string | null
  studyIntent: StudyIntent | null
  deps: CreateAdhocCardDependencies
}): Promise<CreateAdhocCardResult> => {
  const { userId, targetLanguage, headword, context, studyIntent, deps } = params

  const languagePrefs = await getLanguageMode({
    userId,
    targetLanguage,
    usersRepository: deps.usersRepository,
    targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
  })
  if (!languagePrefs.nativeLanguage) {
    throw new AdhocCardCreationError('native_language_not_set')
  }

  const langPref = await deps.userTargetLanguagePrefsRepository.findForLanguage(userId, targetLanguage)
  if (!langPref) {
    throw new AdhocCardCreationError('cefr_not_set')
  }
  const cefrLevel = langPref.cefr_level

  const { session, track } = await getOrCreateAdhocSession({
    userId,
    targetLanguage,
    nativeLanguage: languagePrefs.nativeLanguage,
    cefrLevel,
    deps,
  })

  // Prefix the segment with the headword so the synthetic highlight's offsets
  // always land on a real substring even if the user's context never literally
  // contains the headword (or has different casing/inflection).
  const trimmedContext = context?.trim() ?? ''
  const segmentText = trimmedContext.length > 0 ? `${headword} — ${trimmedContext}` : headword

  const segment = await deps.textSegmentsRepository.appendSegmentAtomic({
    textTrackId: track.id,
    text: segmentText,
    startMs: null,
    endMs: null,
  })

  const highlight = await deps.highlightsRepository.insertHighlight({
    studySessionId: session.id,
    startSegmentId: segment.id,
    endSegmentId: segment.id,
    startOffset: 0,
    endOffset: headword.length,
    selectionText: headword,
    note: null,
    presetTags: [],
    // Provenance only: adhoc intent is applied inline below (no enrich job runs
    // for adhoc highlights); the applied_at stamp rides the same guard.
    studyIntent: studyIntent,
    fastGloss: null,
  })

  const highlightInput: HighlightInput = {
    highlightId: highlight.id,
    segmentId: segment.id,
    selectionText: headword,
  }

  // English IPA follows the user's dialect preference (GA vs RP) — the basic
  // data pass now generates grammar.ipa by default (grounding overwrites it
  // with Wiktionary's where available).
  const englishIpaDialect = isEnglishTargetLanguage(targetLanguage)
    ? await deps.usersRepository.getEnglishIpaDialect(userId)
    : undefined

  let chunks
  try {
    chunks = await basicDataPass({
      nativeLanguage: languagePrefs.nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob: session.context_blob ?? '',
      segments: [{ id: segment.id, index: segment.index, text: segment.text }],
      highlights: [highlightInput],
      hideTranslationFields: languagePrefs.hideTranslationFields,
      allowL1Notes: languagePrefs.allowL1Notes,
      englishIpaDialect,
    })
  } catch (e) {
    logCustomErrorMessageAndError(`createAdhocCard: basicDataPass failed for userId=${userId}`, e)
    throw new AdhocCardCreationError('llm_failure', e instanceof Error ? e.message : String(e))
  }

  const { touchedLookups, insertedCards } = await materializeBasicDataChunks({
    sessionId: session.id,
    userId,
    targetLanguage,
    chunks,
    newHighlights: [highlightInput],
    processedHighlightIds: new Set<string>(),
    segmentIdSet: new Set([segment.id]),
    hideTranslationFields: languagePrefs.hideTranslationFields,
    cardsRepository: deps.cardsRepository,
    userLookupsRepository: deps.userLookupsRepository,
  })

  if (KAIKKI_LANGUAGES.has(targetLanguage)) {
    await runWiktionaryGrounding({
      sessionId: session.id,
      userId,
      targetLanguage,
      touchedLookups,
      userLookupsRepository: deps.userLookupsRepository,
      wiktionaryEntriesRepository: deps.wiktionaryEntriesRepository,
      processingTelemetryRepository: deps.processingTelemetryRepository,
    })
  }

  // We passed exactly one highlight + one segment to basicDataPass, so
  // materializeBasicDataChunks always inserts at least one card (either from
  // the chunk loop or the highlight-fallback path). Any card pointing at the
  // highlight we just created is the one the user sees.
  const insertedCard = insertedCards.find((c) => c.highlight_id === highlight.id) ?? insertedCards[0]
  if (!insertedCard) {
    throw new AdhocCardCreationError('card_not_inserted', `no card created for highlight ${highlight.id}`)
  }

  // Apply any gloss-save study intent BEFORE the keep transition: the intent's
  // facet rows must already exist when applyKeepTransition runs, so its
  // ensureDefaultCitationFacetIfUnconfigured row-existence check honors the
  // full-set semantics (recognition unchecked => no recognition facet). Runs
  // after grounding so the pronunciation reconcile sees the grounded IPA.
  let intentApplied = false
  let intentFormTargets: StudyIntentFormTarget[] = []
  if (studyIntent) {
    const intentResult = await applyStudyIntent(
      {
        userLookupId: insertedCard.user_lookup_id,
        userId,
        surfaceForm: insertedCard.surface_form ?? headword,
        intent: studyIntent,
        appliedGuardHighlightId: highlight.id,
      },
      { userLookupsRepository: deps.userLookupsRepository, studyFacetsRepository: deps.studyFacetsRepository }
    )
    intentApplied = intentResult.applied
    intentFormTargets = intentResult.formFacetTargets
  }

  // Adhoc entries are an explicit user action ("add this word to my
  // vocabulary"), so they bypass triage: stamp the card as kept and apply
  // the lookup transition that materialize no longer does.
  await deps.cardsRepository.updateStatus(insertedCard.id, 'kept')
  await deps.userLookupsRepository.applyKeepTransition({
    userLookupId: insertedCard.user_lookup_id,
    cardId: insertedCard.id,
  })

  // Awaited deliberately (decided): the save is already an LLM-backed spinner
  // and navigates straight to the card — arriving at a ready form facet beats
  // racing a pending_data chip. Never throws; a failure leaves pending_data
  // with the term view's retry chip.
  if (intentApplied && intentFormTargets.length > 0) {
    await generateStudyIntentFormData(
      {
        userLookupId: insertedCard.user_lookup_id,
        userId,
        formFacetTargets: intentFormTargets,
        encounteredSentence: segment.text,
      },
      {
        userLookupsRepository: deps.userLookupsRepository,
        usersRepository: deps.usersRepository,
        userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
      }
    )
  }

  // Stamp the most-recent target language so the next adhoc-wizard open prefills it.
  void deps.usersRepository.setLastTargetLanguage(userId, targetLanguage).catch((e) => {
    logCustomErrorMessageAndError(`createAdhocCard: setLastTargetLanguage failed for userId=${userId}`, e)
  })

  return { cardId: insertedCard.id, sessionId: session.id }
}
