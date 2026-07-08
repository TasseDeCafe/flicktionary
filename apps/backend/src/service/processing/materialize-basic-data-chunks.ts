import type postgres from 'postgres'
import { CardsRepositoryInterface, CardStatus, DbCard } from '../../transport/database/cards/cards-repository'
import {
  DbUserLookup,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { BasicDataChunk, HighlightInput } from '../../transport/third-party/anthropic/passes/basic-data-pass'

// The single definition of an "empty card": the canonical user_lookup (deduped
// per (user, target_language, headword='selectionText', sense='')) plus the
// idempotent highlight-backed card in 'needs_data'. Shared by the basic-data
// fallback loop (a highlight the model dropped) and the note-only save lane
// (which deliberately skips the basic-data pass entirely). Both repo methods
// accept the optional executor so the note-only lane can run the whole insert
// atomically inside one transaction.
export const insertStubCardForHighlight = async (
  params: {
    sessionId: string
    userId: string
    targetLanguage: string
    highlightId: string
    segmentId: string
    selectionText: string
    status?: CardStatus
  },
  deps: { cardsRepository: CardsRepositoryInterface; userLookupsRepository: UserLookupsRepositoryInterface },
  executor?: postgres.Sql
): Promise<{ lookup: DbUserLookup; card: DbCard }> => {
  const lookup = await deps.userLookupsRepository.findOrCreate(
    {
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      headword: params.selectionText,
      sense: '',
    },
    executor
  )
  const card = await deps.cardsRepository.insertCardForHighlightIdempotent(
    {
      studySessionId: params.sessionId,
      highlightId: params.highlightId,
      segmentId: params.segmentId,
      userLookupId: lookup.id,
      surfaceForm: params.selectionText,
      status: params.status ?? 'needs_data',
    },
    executor
  )
  return { lookup, card }
}

export type TouchedLookupInfo = {
  headword: string
  llmPos: string | null
  alreadyGrounded: boolean
  // False on rows grounded before the grounding_patch column existed; the
  // grounding runner re-grounds those to backfill the provenance snapshot.
  hasGroundingPatch: boolean
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
  // German grounded keys. notable_forms is intentionally excluded — German
  // grounding never writes principal parts, so they stay LLM-owned.
  'plural',
  'genitive',
  'is_weak_noun',
  'is_separable',
  'auxiliary',
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
// content, and inserts cards in 'needs_data' status (they auto-keep once basic
// data lands). Also covers the fallback path where the model dropped a highlight
// on the floor — every user highlight gets at least a stub card so nothing is
// silently lost. User highlights always produce a card (they bypass the CEFR
// floor), so there is no below-CEFR auto-reject here.
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
        hasGroundingPatch: lookup.grounding_patch != null,
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
        zipf: chunk.zipf,
      })
    } else if (grammarPatch || chunk.zipf != null) {
      // Existing row already had content from an earlier session. Don't
      // touch the user's text edits, but still merge LLM-only grammar facts
      // the model emitted this round. Wiktionary-owned fields stay pinned
      // once the row has been grounded. The zipf estimate rides along here
      // too — this branch is the only update path for rows that already have
      // content, so without it pre-existing terms would never receive one.
      await userLookupsRepository.updateContent({
        id: lookup.id,
        grammarPatch,
        zipf: chunk.zipf,
      })
    }

    const highlightId = chunk.source === 'highlight' ? (chunk.highlightId ?? null) : null
    // User highlights bypass the CEFR floor — always a real card that auto-keeps
    // once basic data lands. `belowCefr` is still parsed for telemetry but never
    // maps to a card status.
    const status: CardStatus = 'needs_data'
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
    const { lookup, card } = await insertStubCardForHighlight(
      {
        sessionId,
        userId,
        targetLanguage,
        highlightId: highlight.highlightId,
        segmentId: highlight.segmentId,
        selectionText: highlight.selectionText,
      },
      { cardsRepository, userLookupsRepository }
    )
    if (!touchedLookups.has(lookup.id)) {
      touchedLookups.set(lookup.id, {
        headword: lookup.headword,
        llmPos: null,
        alreadyGrounded: lookup.grounded_at !== null,
        hasGroundingPatch: lookup.grounding_patch != null,
        grammarUserEdited: lookup.grammar_user_edited_at !== null,
      })
    }
    insertedCards.push(card)
  }

  return { touchedLookups, insertedCards }
}
