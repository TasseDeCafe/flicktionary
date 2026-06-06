import { CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { BasicDataChunk, HighlightInput } from '../../transport/third-party/anthropic/passes/basic-data-pass'

export type TouchedLookupInfo = {
  headword: string
  llmPos: string | null
  alreadyGrounded: boolean
  grammarUserEdited: boolean
}

const WIKTIONARY_GROUNDED_GRAMMAR_KEYS = new Set([
  'pos',
  'display_form',
  'gender',
  'number_only',
  'is_indeclinable',
  'animacy',
  'aspect',
  'aspect_pair_headword',
  'is_reflexive',
  'ipa',
])

export const buildBasicDataGrammarPatch = (
  grammar: Record<string, unknown> | null | undefined,
  alreadyGrounded: boolean,
  grammarUserEdited: boolean
): Record<string, unknown> | null => {
  if (!grammar) return null
  if (grammarUserEdited) return null
  if (!alreadyGrounded) return grammar

  const patch = Object.fromEntries(
    Object.entries(grammar).filter(([key]) => !WIKTIONARY_GROUNDED_GRAMMAR_KEYS.has(key))
  )
  return Object.keys(patch).length > 0 ? patch : null
}

// Writes basic-data-pass output to the DB: upserts user_lookups, fills first-time
// content, and inserts cards in 'pending' status (or 'auto_rejected' for
// below-CEFR rows). Also covers the fallback path where the model dropped a
// highlight on the floor — every user highlight gets at least a stub card so
// nothing is silently lost.
//
// Returns the touched user_lookups map so the caller can drive wiktionary
// grounding without re-querying, plus the freshly-inserted card rows so
// callers (notably the adhoc-card flow) can reach the result without a
// secondary lookup.
export const materializeBasicDataChunks = async (params: {
  sessionId: string
  userId: string
  targetLanguage: string
  chunks: BasicDataChunk[]
  newHighlights: HighlightInput[]
  processedHighlightIds: Set<string>
  segmentIdSet: Set<string>
  hideTranslationFields?: boolean
  cardsRepository: CardsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}): Promise<{ touchedLookups: Map<string, TouchedLookupInfo>; insertedCards: DbCard[] }> => {
  const {
    sessionId,
    userId,
    targetLanguage,
    chunks,
    newHighlights,
    processedHighlightIds,
    segmentIdSet,
    hideTranslationFields = false,
    cardsRepository,
    userLookupsRepository,
  } = params

  const coveredHighlightIds = new Set<string>()
  const touchedLookups = new Map<string, TouchedLookupInfo>()
  const insertedCards: DbCard[] = []

  for (const chunk of chunks) {
    if (!segmentIdSet.has(chunk.segmentId)) continue

    if (chunk.source === 'highlight' && chunk.highlightId) {
      if (processedHighlightIds.has(chunk.highlightId)) continue
      coveredHighlightIds.add(chunk.highlightId)
    }

    const lookup = await userLookupsRepository.findOrCreate({
      userId,
      targetLanguage,
      headword: chunk.headword,
      sense: chunk.sense,
    })
    const alreadyGrounded = lookup.grounded_at !== null
    const grammarUserEdited = lookup.grammar_user_edited_at !== null
    const grammarPatch = buildBasicDataGrammarPatch(chunk.grammar, alreadyGrounded, grammarUserEdited)
    if (!touchedLookups.has(lookup.id)) {
      const llmPos = typeof chunk.grammar?.pos === 'string' ? (chunk.grammar.pos as string) : null
      touchedLookups.set(lookup.id, {
        headword: lookup.headword,
        llmPos,
        alreadyGrounded,
        grammarUserEdited,
      })
    }
    if (lookup.translation === null && lookup.definition === null) {
      // Translations-off is a generation pref only: skip the LLM-emitted
      // translation/native_example, but never clear the columns — a
      // manually-entered translation must survive reprocessing.
      await userLookupsRepository.updateContent({
        id: lookup.id,
        translation: hideTranslationFields ? null : chunk.translation,
        definition: chunk.definition,
        targetExample: chunk.targetExample,
        nativeExample: hideTranslationFields ? null : chunk.nativeExample,
        grammarPatch,
      })
    } else if (grammarPatch) {
      // Existing row already had content from an earlier session. Don't
      // touch the user's text edits, but still merge LLM-only grammar facts
      // the model emitted this round. Wiktionary-owned fields stay pinned
      // once the row has been grounded.
      await userLookupsRepository.updateContent({
        id: lookup.id,
        grammarPatch,
      })
    }

    const highlightId = chunk.source === 'highlight' ? (chunk.highlightId ?? null) : null
    const status = chunk.belowCefr ? 'auto_rejected' : 'pending'
    const insertedCard = highlightId
      ? await cardsRepository.insertCardForHighlightIdempotent({
          studySessionId: sessionId,
          highlightId,
          segmentId: chunk.segmentId,
          userLookupId: lookup.id,
          surfaceForm: chunk.surfaceForm,
          status,
        })
      : await cardsRepository.insertCard({
          studySessionId: sessionId,
          highlightId: null,
          segmentId: chunk.segmentId,
          userLookupId: lookup.id,
          surfaceForm: chunk.surfaceForm,
          status,
        })
    insertedCards.push(insertedCard)
  }

  // Fallback: if the model failed to emit a row for a highlight, insert a
  // minimal stub so the highlight isn't silently dropped. Headword falls
  // back to the raw selection text.
  for (const highlight of newHighlights) {
    if (coveredHighlightIds.has(highlight.highlightId)) continue
    const lookup = await userLookupsRepository.findOrCreate({
      userId,
      targetLanguage,
      headword: highlight.selectionText,
      sense: '',
    })
    if (!touchedLookups.has(lookup.id)) {
      touchedLookups.set(lookup.id, {
        headword: lookup.headword,
        llmPos: null,
        alreadyGrounded: lookup.grounded_at !== null,
        grammarUserEdited: lookup.grammar_user_edited_at !== null,
      })
    }
    const insertedCard = await cardsRepository.insertCardForHighlightIdempotent({
      studySessionId: sessionId,
      highlightId: highlight.highlightId,
      segmentId: highlight.segmentId,
      userLookupId: lookup.id,
      surfaceForm: highlight.selectionText,
      status: 'pending',
    })
    insertedCards.push(insertedCard)
  }

  return { touchedLookups, insertedCards }
}
