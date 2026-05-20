import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { basicDataPass, HighlightInput } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { KAIKKI_ENABLED_LANGUAGES } from '../wiktionary-grounding'
import { materializeBasicDataChunks } from '../processing/materialize-basic-data-chunks'
import { runWiktionaryGrounding } from '../processing/wiktionary-grounding-runner'
import { getEffectiveNativeLanguage } from '../user-prefs/effective-native-language'
import { getOrCreateAdhocSession } from './get-or-create-adhoc-session'

export type CreateAdhocCardDependencies = {
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
  deps: CreateAdhocCardDependencies
}): Promise<CreateAdhocCardResult> => {
  const { userId, targetLanguage, headword, context, deps } = params

  const languagePrefs = await getEffectiveNativeLanguage({
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
  })

  const highlightInput: HighlightInput = {
    highlightId: highlight.id,
    segmentId: segment.id,
    selectionText: headword,
    note: null,
    presetTags: [],
  }

  let chunks
  try {
    chunks = await basicDataPass({
      nativeLanguage: languagePrefs.nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob: session.context_blob ?? '',
      segments: [{ id: segment.id, index: segment.index, text: segment.text }],
      highlights: [highlightInput],
      excludedHeadwordSenses: [],
      llmDiscoveryEnabled: false,
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
    cardsRepository: deps.cardsRepository,
    userLookupsRepository: deps.userLookupsRepository,
  })

  if (KAIKKI_ENABLED_LANGUAGES.has(targetLanguage)) {
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

  // Stamp the most-recent target language so the next adhoc-wizard open prefills it.
  void deps.usersRepository.setLastTargetLanguage(userId, targetLanguage).catch((e) => {
    logCustomErrorMessageAndError(`createAdhocCard: setLastTargetLanguage failed for userId=${userId}`, e)
  })

  return { cardId: insertedCard.id, sessionId: session.id }
}
